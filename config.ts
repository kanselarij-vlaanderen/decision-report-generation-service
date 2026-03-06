function isTruthy(value) {
  return [true, "true", 1, "1", "yes", "Y", "on"].includes(value);
}

const REPORT_CRON_PATTERN = process.env.REPORT_CRON_PATTERN || "0 * * * * *";

const RESOURCE_BASES = {
  PIECE: 'http://themis.vlaanderen.be/id/stuk/',
  DOCUMENT_CONTAINER: 'http://themis.vlaanderen.be/id/serie/',
  FILE: 'http://themis.vlaanderen.be/id/bestand/',
}

const STORAGE_PATH = `/share`;
const STORAGE_URI = `share://`;
const GRAPHS = {
  KANSELARIJ: 'http://mu.semte.ch/graphs/organizations/kanselarij',
  PUBLIC: 'http://mu.semte.ch/graphs/public',
  SIGNING: 'http://mu.semte.ch/graphs/system/signing',
}

const JOB = {
  STATUSES: {
    SCHEDULED: "http://redpencil.data.gift/id/concept/JobStatus/scheduled",
    BUSY: "http://redpencil.data.gift/id/concept/JobStatus/busy",
    SUCCESS: "http://redpencil.data.gift/id/concept/JobStatus/success",
    FAILED: "http://redpencil.data.gift/id/concept/JobStatus/failed",
  },
  RDF_TYPE: "http://mu.semte.ch/vocabularies/ext/ReportGenerationJob",
  BUNDLE_RDF_TYPE: "http://mu.semte.ch/vocabularies/ext/ReportBundleGenerationJob",
  RDF_RESOURCE_BASE: "http://data.kaleidos.vlaanderen.be/report-generation-jobs/",
  JSONAPI_JOB_TYPE: "report-generation-jobs", // needed for a JSONAPI compliant response
  GRAPH: GRAPHS.KANSELARIJ,
}

const ENABLE_DEBUG_WRITE_GENERATED_HTML = isTruthy(
  process.env.ENABLE_DEBUG_WRITE_GENERATED_HTML
);

export {
  REPORT_CRON_PATTERN,
  RESOURCE_BASES,
  STORAGE_PATH,
  STORAGE_URI,
  GRAPHS,
  ENABLE_DEBUG_WRITE_GENERATED_HTML,
  JOB
};
