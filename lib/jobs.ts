import { query, update } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import { sparqlEscapeString, sparqlEscapeUri, sparqlEscapeDateTime, sparqlEscapeInt, uuid } from 'mu';
import config from '../config';

import { generateReport } from "./report-generation";

// NOTE: this is a crutch, as generateReport needs the headers, but we can't store them
const jobRequestHeaders = {};

export class JobManager {
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

export async function createJob(reportUris, requestHeaders) {
  const jobUuid = uuid();
  const jobUri = `http://data.kaleidos.vlaanderen.be/report-generation-jobs/${jobUuid}`;
  jobRequestHeaders[jobUuid] = requestHeaders; // TODO: find a better way
  const now = new Date();
  console.log(`Creating job with uri ${sparqlEscapeUri(jobUri)} for ${reportUris.length} reports`);
  const reportsObject = (reportUris || []).map((reportUri) => (
    `${sparqlEscapeUri(reportUri)}`
  )).join(', ');

  await update(`
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX adms: <http://www.w3.org/ns/adms#>

  INSERT DATA {
    GRAPH <${config.job.graph}> {
        ${sparqlEscapeUri(jobUri)} a ext:ReportGenerationJob ;
               mu:uuid ${sparqlEscapeString(jobUuid)} ;
               prov:used ${reportsObject} ;
               adms:status ${sparqlEscapeUri(config.job.statuses.scheduled)} ;
               dct:created ${sparqlEscapeDateTime(now)} ;
               dct:modified ${sparqlEscapeDateTime(now)} .
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
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX adms: <http://www.w3.org/ns/adms#>

  SELECT ?report ?reportId
  WHERE {
    GRAPH <${config.job.graph}> {
      ${sparqlEscapeUri(job.uri)} prov:used ?report .
      ?report mu:uuid ?reportId .
    }
  }`);
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

  SELECT ?uri ?id ?status
  WHERE {
    GRAPH <${config.job.graph}> {
      VALUES ?status {
        ${sparqlEscapeUri(config.job.statuses.scheduled)}
      }
      ?uri a ext:ReportGenerationJob ;
           mu:uuid ?id ;
           dct:created ?created ;
           adms:status ?status .
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
    };
    job.reportIds = await getReportIds(job);
    return job;
  } else {
    return null;
  }
}

export async function getJob(jobId) {
  const result = await querySudo(`
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX adms: <http://www.w3.org/ns/adms#>

  SELECT ?uri ?id ?status ?created ?modified
  WHERE {
    GRAPH <${config.job.graph}> {
      ?uri a ext:ReportGenerationJob ;
           mu:uuid ${sparqlEscapeString(jobId)} ;
           dct:created ?created ;
           dct:modified ?modified ;
           adms:status ?status .
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
    job.reportIds = await getReportIds(job);
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
    GRAPH <${config.job.graph}> {
        ${sparqlEscapeUri(uri)} dct:modified ?modified ;
             adms:status ?status.
    }
  }

  ;

  INSERT DATA {
    GRAPH <${config.job.graph}> {
        ${sparqlEscapeUri(uri)} dct:modified ${sparqlEscapeDateTime(new Date())};
             adms:status ${sparqlEscapeUri(status)}.
    }
  }`);
}

async function executeJob(job) {
  try {
    await updateJobStatus(job.uri, config.job.statuses.ongoing);
    for (const reportId of job.reportIds) {
      const fileMeta = await generateReport(reportId,
        jobRequestHeaders[job.id],
        true);
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
