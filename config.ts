const RESOURCE_BASE = 'http://mu.semte.ch/services/decision-report-generation';
const STORAGE_PATH = `/share`;
const STORAGE_URI = `share://`;
const job = {
    statuses: {
      scheduled: 'http://data.kaleidos.vlaanderen.be/report-generation-job-statuses/scheduled',
      ongoing: 'http://data.kaleidos.vlaanderen.be/report-generation-job-statuses/ongoing',
      success: 'http://data.kaleidos.vlaanderen.be/report-generation-job-statuses/success',
      failure: 'http://data.kaleidos.vlaanderen.be/report-generation-job-statuses/failure'
    },
    graph: 'http://mu.semte.ch/graphs/organizations/kanselarij'
}
const kanselarij = {
  graph: 'http://mu.semte.ch/graphs/organizations/kanselarij'
}

export default {
  RESOURCE_BASE,
  STORAGE_PATH,
  STORAGE_URI,
  job,
  kanselarij,
};
