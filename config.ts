function isTruthy(value) {
  return [true, "true", 1, "1", "yes", "Y", "on"].includes(value);
}

const FILE_RESOURCE_BASE = 'http://themis.vlaanderen.be/id/bestand/';
const STORAGE_PATH = `/share`;
const STORAGE_URI = `share://`;
const graph = {
  kanselarij: 'http://mu.semte.ch/graphs/organizations/kanselarij',
  public: 'http://mu.semte.ch/graphs/public'
}
const job = {
    statuses: {
      scheduled: 'http://data.kaleidos.vlaanderen.be/report-generation-job-statuses/scheduled',
      ongoing: 'http://data.kaleidos.vlaanderen.be/report-generation-job-statuses/ongoing',
      success: 'http://data.kaleidos.vlaanderen.be/report-generation-job-statuses/success',
      failure: 'http://data.kaleidos.vlaanderen.be/report-generation-job-statuses/failure'
    },
    graph: graph.kanselarij,
}

const signFlows = {
  graph: 'http://mu.semte.ch/graphs/system/signing',
  statuses: {
    marked: 'http://themis.vlaanderen.be/id/handtekenstatus/f6a60072-0537-11ee-bb35-ee395168dcf7'
  }
}

const ENABLE_DEBUG_WRITE_GENERATED_HTML = isTruthy(
  process.env.ENABLE_DEBUG_WRITE_GENERATED_HTML
);

export default {
  FILE_RESOURCE_BASE,
  STORAGE_PATH,
  STORAGE_URI,
  graph,
  job,
  signFlows,
  ENABLE_DEBUG_WRITE_GENERATED_HTML
};
