import { update } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import { sparqlEscapeString, sparqlEscapeUri, sparqlEscapeDateTime, uuid } from 'mu';
import config from '../config';
import { generateReport } from "./report-generation";
import { generateReportBundle } from './bundle-generation';

// NOTE: this is a crutch, as generateReport needs the headers, but we can't store them
const jobRequestHeaders = {};

export class JobManager {
  isExecuting: Boolean;

  constructor() {
    this.isExecuting = false;
  }

  async run() {
    if (this.isExecuting) {
      return;
    }

    let hasRun = false;
    try {
      this.isExecuting = true;
      const job = await getNextScheduledJob();
      if (job) {
        console.debug(`Found next scheduled job <${job.uri}>, executing...`);
        await executeJob(job);
        hasRun = true;
      } else {
        console.debug('No job found in current execution of JobManager#run');
      }
    } catch (error) {
      console.log(`Unexpected error was raised during execution of job: ${error}`);
      console.trace(error);
    } finally {
      this.isExecuting = false;
      if (hasRun) {
        // If we found a scheduled job this run, re-trigger in case there's more
        // Otherwise we just wait until we get triggered by the poll-rate
        this.run();
      }
    }
  }
}

export async function createJob(reportUris: [string] | [],  requestHeaders, isBundleJob = false, shouldRegenerateConcerns = false) {
  const jobUuid = uuid();
  const jobUri = `http://data.kaleidos.vlaanderen.be/report-generation-jobs/${jobUuid}`;
  jobRequestHeaders[jobUuid] = requestHeaders; // TODO: find a better way
  const now = new Date();
  console.log(`Creating job with uri ${sparqlEscapeUri(jobUri)} for ${reportUris.length} reports`);
  const reportsObject = (reportUris || []).map((reportUri) => (
    `${sparqlEscapeUri(reportUri)}`
  )).join(', ');
  let classes = 'ext:ReportGenerationJob';
  if (isBundleJob) {
    classes += ', ext:ReportBundleGenerationJob';
  }

  await update(`
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX adms: <http://www.w3.org/ns/adms#>
  PREFIX tl: <http://mu.semte.ch/vocabularies/typed-literals/>

  INSERT DATA {
    GRAPH ${sparqlEscapeUri(config.job.graph)} {
        ${sparqlEscapeUri(jobUri)} a ${classes} ;
               mu:uuid ${sparqlEscapeString(jobUuid)} ;
               prov:used ${reportsObject} ;
               adms:status ${sparqlEscapeUri(config.job.statuses.scheduled)} ;
               dct:created ${sparqlEscapeDateTime(now)} ;
               dct:modified ${sparqlEscapeDateTime(now)} ;
               ext:shouldRegenerateConcerns ${shouldRegenerateConcerns ? '"true"^^tl:boolean' : '"false"^^tl:boolean'} .
    }
  }`);

  return {
    id: jobUuid,
    uri: jobUri,
    status: config.job.statuses.scheduled,
    created: now,
    modified: now
  };
}

async function getReportIds(job) {
  const result = await querySudo(`
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX schema: <http://schema.org/>
  PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>

  SELECT DISTINCT ?report ?reportId
  WHERE {
    GRAPH ${sparqlEscapeUri(config.job.graph)} { ${sparqlEscapeUri(job.uri)} prov:used ?report }
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?report mu:uuid ?reportId .
      ?report dct:title ?reportName .
      ?report besluitvorming:beschrijft ?decisionActivity .
      ?treatment besluitvorming:heeftBeslissing ?decisionActivity .
      ?treatment dct:subject ?agendaitem .
      ?agendaitem dct:type ?agendaitemType .
    }
    GRAPH ${sparqlEscapeUri(config.graph.public)} { ?agendaitemType schema:position ?typeOrder }
  } ORDER BY ?typeOrder ?reportName`);
  const bindings = result.results.bindings;
  if (bindings.length > 0) {
    return bindings.map((binding) => binding['reportId'].value);
  } else {
    return [];
  }
}

async function getNextScheduledJob() {
  const result = await querySudo(`
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX adms: <http://www.w3.org/ns/adms#>

  SELECT ?uri ?id ?status ?isBundleJob ?shouldRegenerateConcerns
  WHERE {
    GRAPH ${sparqlEscapeUri(config.job.graph)} {
      VALUES ?status {
        ${sparqlEscapeUri(config.job.statuses.scheduled)}
      }
      ?uri a ext:ReportGenerationJob ;
           mu:uuid ?id ;
           dct:created ?created ;
           adms:status ?status .
      OPTIONAL { ?uri ext:shouldRegenerateConcerns ?shouldRegenerateConcerns . }
      OPTIONAL { ?uri a ext:ReportBundleGenerationJob BIND(true AS ?hasBundleClass) }
      BIND(BOUND(?hasBundleClass) AS ?isBundleJob)
      FILTER NOT EXISTS {
        ?job a ext:ReportGenerationJob ;
           adms:status ${sparqlEscapeUri(config.job.statuses.ongoing)} .
      }
    }
  } ORDER BY ASC(?created) LIMIT 1`);

  const bindings = result.results.bindings;
  if (bindings.length === 1) {
    let job = {
      id: bindings[0]['id'].value,
      uri: bindings[0]['uri'].value,
      status: bindings[0]['status'].value,
      isBundleJob: bindings[0]['isBundleJob'].value === '1',
      shouldRegenerateConcerns: bindings[0]['shouldRegenerateConcerns'].value === 'true',
    };
    job['reportIds'] = await getReportIds(job);
    return job;
  } else {
    return null;
  }
}

export async function getJob(jobId) {
  // there may be a split second where the job is not found when the status/modified is being updated
  const result = await querySudo(`
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX adms: <http://www.w3.org/ns/adms#>

  SELECT ?uri ?status ?created ?modified
  WHERE {
    GRAPH ${sparqlEscapeUri(config.job.graph)} {
      ?uri a ext:ReportGenerationJob ;
           mu:uuid ${sparqlEscapeString(jobId)} ;
           dct:created ?created .
      OPTIONAL { ?uri dct:modified ?modified . }
      OPTIONAL { ?uri adms:status ?status . }
    }
  } ORDER BY ASC(?created) LIMIT 1`);

  const bindings = result.results.bindings;
  if (bindings.length === 1) {
    let job = {
      id: jobId,
      uri: bindings[0]['uri']?.value,
      status: bindings[0]['status']?.value,
      created: bindings[0]['created']?.value,
      modified: bindings[0]['modified']?.value,
    };
    job['reportIds'] = await getReportIds(job);
    return job;
  } else {
    return null;
  }
}

async function updateJobStatus(uri, status) {
  await updateSudo(`
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX adms: <http://www.w3.org/ns/adms#>

  DELETE WHERE {
    GRAPH ${sparqlEscapeUri(config.job.graph)} {
        ${sparqlEscapeUri(uri)} dct:modified ?modified ;
             adms:status ?status.
    }
  }

  ;

  INSERT DATA {
    GRAPH ${sparqlEscapeUri(config.job.graph)} {
        ${sparqlEscapeUri(uri)} dct:modified ${sparqlEscapeDateTime(new Date())};
             adms:status ${sparqlEscapeUri(status)}.
    }
  }`);
}

async function executeJob(job) {
  try {
    await updateJobStatus(job.uri, config.job.statuses.ongoing);

    const viaJob = true;
    if (job.isBundleJob) {
      await generateReportBundle(job.reportIds, jobRequestHeaders[job.id], viaJob);
    } else {
      for (const reportId of job.reportIds) {
        await generateReport(reportId, jobRequestHeaders[job.id], job.shouldRegenerateConcerns, viaJob);
      }
    }

    await updateJobStatus(job.uri, config.job.statuses.success);
    delete jobRequestHeaders[job.id];
    console.log('**************************************');
    console.log(`Successfully finished job <${job.uri}>`);
    console.log('**************************************');
  } catch (e) {
    console.log(
      `Execution of job <${job.uri}> failed: ${e}`
    );
    console.trace(e);
    await updateJobStatus(job.uri, config.job.statuses.failure);
  }
}

export async function cleanupOngoingJobs() {
  await updateSudo(`
  PREFIX adms: <http://www.w3.org/ns/adms#>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

  DELETE {
    GRAPH ${sparqlEscapeUri(config.job.graph)} {
      ?uri adms:status ${sparqlEscapeUri(config.job.statuses.ongoing)} .
    } }
  INSERT {
    GRAPH ${sparqlEscapeUri(config.job.graph)} {
      ?uri adms:status ${sparqlEscapeUri(config.job.statuses.failure)} .
    } }
  WHERE {
    GRAPH ${sparqlEscapeUri(config.job.graph)} {
      ?uri a ext:ReportGenerationJob ;
           adms:status ${sparqlEscapeUri(config.job.statuses.ongoing)} .
    }}`);
}
