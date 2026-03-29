import { update } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import { sparqlEscapeString, sparqlEscapeUri, sparqlEscapeDateTime, uuid } from 'mu';
import { JOB, GRAPHS } from '../config';
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

export async function createJob(reportUris: [string] | [],  requestHeaders: any, isBundleJob = false, shouldRegenerateConcerns = false) {
  const jobUuid = uuid();
  const jobUri = `${JOB.RDF_RESOURCE_BASE}${jobUuid}`;
  jobRequestHeaders[jobUuid] = requestHeaders; // TODO: find a better way
  const now = new Date();
  console.log(`Creating job with uri ${sparqlEscapeUri(jobUri)} for ${reportUris.length} reports`);
  const reportsObject = (reportUris || []).map((reportUri) => (
    `${sparqlEscapeUri(reportUri)}`
  )).join(', ');
  let classes = `cogs:Job, ${sparqlEscapeUri(JOB.RDF_TYPE)}`;
  if (isBundleJob) {
    classes += `, ${sparqlEscapeUri(JOB.BUNDLE_RDF_TYPE)}`;
  }

  await update(`
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX adms: <http://www.w3.org/ns/adms#>
  PREFIX tl: <http://mu.semte.ch/vocabularies/typed-literals/>
  PREFIX cogs: <http://vocab.deri.ie/cogs#>

  INSERT DATA {
    GRAPH ${sparqlEscapeUri(JOB.GRAPH)} {
        ${sparqlEscapeUri(jobUri)} a ${classes} ;
               mu:uuid ${sparqlEscapeString(jobUuid)} ;
               prov:used ${reportsObject} ;
               adms:status ${sparqlEscapeUri(JOB.STATUSES.SCHEDULED)} ;
               dct:created ${sparqlEscapeDateTime(now)} ;
               ext:shouldRegenerateConcerns ${shouldRegenerateConcerns ? '"true"^^tl:boolean' : '"false"^^tl:boolean'} .
    }
  }`);

  return {
    id: jobUuid,
    uri: jobUri,
    status: JOB.STATUSES.SCHEDULED,
    created: now
  };
}

async function getReportIds(job) {
  // TODO we pass kanselarij graph twice, jobs don't have there own graph but we act like they might?
  const result = await querySudo(`
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX schema: <http://schema.org/>
  PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>

  SELECT DISTINCT ?report ?reportId
  WHERE {
    GRAPH ${sparqlEscapeUri(JOB.GRAPH)} { ${sparqlEscapeUri(job.uri)} prov:used ?report }
    GRAPH ${sparqlEscapeUri(GRAPHS.KANSELARIJ)} {
      ?report mu:uuid ?reportId .
      ?report dct:title ?reportName .
      ?report besluitvorming:beschrijft ?decisionActivity .
      ?treatment besluitvorming:heeftBeslissing ?decisionActivity .
      ?treatment dct:subject ?agendaitem .
      ?agendaitem dct:type ?agendaitemType .
    }
    GRAPH ${sparqlEscapeUri(GRAPHS.PUBLIC)} { ?agendaitemType schema:position ?typeOrder }
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
    GRAPH ${sparqlEscapeUri(JOB.GRAPH)} {
      VALUES ?status {
        ${sparqlEscapeUri(JOB.STATUSES.SCHEDULED)}
      }
      ?uri a ${sparqlEscapeUri(JOB.RDF_TYPE)} ;
           mu:uuid ?id ;
           dct:created ?created ;
           adms:status ?status .
      OPTIONAL { ?uri ext:shouldRegenerateConcerns ?shouldRegenerateConcerns . }
      OPTIONAL { ?uri a ${sparqlEscapeUri(JOB.BUNDLE_RDF_TYPE)} BIND(true AS ?hasBundleClass) }
      BIND(BOUND(?hasBundleClass) AS ?isBundleJob)
      FILTER NOT EXISTS {
        ?anyBusyJob a ${sparqlEscapeUri(JOB.RDF_TYPE)} ;
           adms:status ${sparqlEscapeUri(JOB.STATUSES.BUSY)} .
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
  PREFIX prov: <http://www.w3.org/ns/prov#>

  SELECT ?uri ?status ?created ?timeStarted ?timeEnded
  WHERE {
    GRAPH ${sparqlEscapeUri(JOB.GRAPH)} {
      ?uri a ${sparqlEscapeUri(JOB.RDF_TYPE)} ;
           mu:uuid ${sparqlEscapeString(jobId)} ;
           dct:created ?created .
      OPTIONAL { ?uri prov:startedAtTime ?timeStarted . }
      OPTIONAL { ?uri prov:endedAtTime ?timeEnded . }
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
      timeStarted: bindings[0]['timeStarted']?.value,
      timeEnded: bindings[0]['timeEnded']?.value,
    };
    job['reportIds'] = await getReportIds(job);
    return job;
  } else {
    return null;
  }
}


async function executeJob(job) {
  try {
    await updateJobStatus(job.uri, JOB.STATUSES.BUSY);

    const viaJob = true;
    if (job.isBundleJob) {
      await generateReportBundle(job.reportIds, jobRequestHeaders[job.id], viaJob);
    } else {
      for (const reportId of job.reportIds) {
        await generateReport(reportId, jobRequestHeaders[job.id], job.shouldRegenerateConcerns, viaJob);
      }
    }

    await updateJobStatus(job.uri, JOB.STATUSES.SUCCESS);
    delete jobRequestHeaders[job.id];
    console.log('**************************************');
    console.log(`Successfully finished job <${job.uri}>`);
    console.log('**************************************');
  } catch (e) {
    console.log(
      `Execution of job <${job.uri}> failed: ${e}`
    );
    console.trace(e);
    await updateJobStatus(job.uri, JOB.STATUSES.FAILED);
  }
}

export async function cleanupOngoingJobs() {
  const now = new Date();
  await updateSudo(`
  PREFIX adms: <http://www.w3.org/ns/adms#>
  PREFIX prov: <http://www.w3.org/ns/prov#>

  DELETE {
    GRAPH ${sparqlEscapeUri(JOB.GRAPH)} {
      ?uri adms:status ${sparqlEscapeUri(JOB.STATUSES.BUSY)} .
      ?uri prov:endedAtTime ?endTime .
    } }
  INSERT {
    GRAPH ${sparqlEscapeUri(JOB.GRAPH)} {
      ?uri adms:status ${sparqlEscapeUri(JOB.STATUSES.FAILED)} .
      ?uri prov:endedAtTime ${sparqlEscapeDateTime(now)}
    } }
  WHERE {
    GRAPH ${sparqlEscapeUri(JOB.GRAPH)} {
      ?uri a ${sparqlEscapeUri(JOB.RDF_TYPE)} ;
           adms:status ${sparqlEscapeUri(JOB.STATUSES.BUSY)} .
      OPTIONAL { ?uri prov:endedAtTime ?endTime }
    }}`);
}

async function updateJobStatus(uri: string, status: string, errorMessage: string = '') {
  const time = new Date();
  let timePred;
  if (status === JOB.STATUSES.SUCCESS || status === JOB.STATUSES.FAILED) { // final statusses
    timePred = 'http://www.w3.org/ns/prov#endedAtTime';
  } else {
    timePred = 'http://www.w3.org/ns/prov#startedAtTime';
  }
  const escapedUri = sparqlEscapeUri(uri);
  const queryString = `
  PREFIX adms: <http://www.w3.org/ns/adms#>
  PREFIX schema: <http://schema.org/>

  DELETE {
    GRAPH ${sparqlEscapeUri(JOB.GRAPH)} {
      ${escapedUri} adms:status ?status ;
          ${sparqlEscapeUri(timePred)} ?time .
    }
  }
  INSERT {
    GRAPH ${sparqlEscapeUri(JOB.GRAPH)} {
      ${escapedUri} adms:status ${sparqlEscapeUri(status)} ;
          ${
            errorMessage
              ? `schema:error ${sparqlEscapeString(errorMessage)} ;`
              : ""
          }
          ${sparqlEscapeUri(timePred)} ${sparqlEscapeDateTime(time)} .
    }
  }
  WHERE {
    GRAPH ${sparqlEscapeUri(JOB.GRAPH)} {
      ${escapedUri} a ${sparqlEscapeUri(JOB.RDF_TYPE)} .
      OPTIONAL { ${escapedUri} adms:status ?status }
      OPTIONAL { ${escapedUri} ${sparqlEscapeUri(timePred)} ?time }
    }
  }`;
  await updateSudo(queryString);
}
