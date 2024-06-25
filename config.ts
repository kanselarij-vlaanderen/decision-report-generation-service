function isTruthy(value) {
  return [true, "true", 1, "1", "yes", "Y", "on"].includes(value);
}

const PIECE_RESOURCE_BASE = 'http://themis.vlaanderen.be/id/stuk/';
const DOCUMENT_CONTAINER_RESOURCE_BASE = 'http://themis.vlaanderen.be/id/serie/';
const FILE_RESOURCE_BASE = 'http://themis.vlaanderen.be/id/bestand/';

const VERTROUWELIJK = 'http://themis.vlaanderen.be/id/concept/toegangsniveau/9692ba4f-f59b-422b-9402-fcbd30a46d17';
const INTERN_OVERHEID = 'http://themis.vlaanderen.be/id/concept/toegangsniveau/634f438e-0d62-4ae4-923a-b63460f6bc46';
const BESLISSINGSFICHE_TYPE = 'http://themis.vlaanderen.be/id/concept/document-type/e807feec-1958-46cf-a558-3379b5add49e';

const STORAGE_PATH = `/share`;
const STORAGE_URI = `share://`;
const graph = {
  kanselarij: 'http://mu.semte.ch/graphs/organizations/kanselarij',
  public: 'http://mu.semte.ch/graphs/public'
}
const job = {
    statuses: {
      scheduled: 'http://vocab.deri.ie/cogs#Scheduled',
      ongoing: 'http://vocab.deri.ie/cogs#Running',
      success: 'http://vocab.deri.ie/cogs#Success',
      failure: 'http://vocab.deri.ie/cogs#Fail'
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
  PIECE_RESOURCE_BASE,
  DOCUMENT_CONTAINER_RESOURCE_BASE,
  FILE_RESOURCE_BASE,
  VERTROUWELIJK,
  INTERN_OVERHEID,
  BESLISSINGSFICHE_TYPE,
  STORAGE_PATH,
  STORAGE_URI,
  graph,
  job,
  signFlows,
  ENABLE_DEBUG_WRITE_GENERATED_HTML
};
