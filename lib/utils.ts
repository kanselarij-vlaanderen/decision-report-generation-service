import { sparqlEscapeUri } from "mu";

export function weekdayName(date: Date) {
  return [
    "zondag",
    "maandag",
    "dinsdag",
    "woensdag",
    "donderdag",
    "vrijdag",
    "zaterdag",
  ][date.getDay()];
}

export function monthName(date: Date) {
  return [
    "januari",
    "februari",
    "maart",
    "april",
    "mei",
    "juni",
    "juli",
    "augustus",
    "september",
    "oktober",
    "november",
    "december"
  ][date.getMonth()]
}

export function formatDate(date: Date) {
  return `${weekdayName(date)} ${date.getDate()} ${monthName(date)} ${date.getFullYear()}`
}

export function addLeadingZeros(number: number, length: number): string {
  return String(number).padStart(length, "0");
}

export function capitalizeFirstLetter(string: string): string {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export function invert(dictionary) {
  return Object.entries(dictionary).reduce((acc, [key, value]) => {
    acc[value] = key;
    return acc;
  }, {});
}

const prefixes = {
  adms: "http://www.w3.org/ns/adms#",
  besluitvorming: "https://data.vlaanderen.be/ns/besluitvorming#",
  dbpedia: "http://dbpedia.org/ontology/",
  dct: "http://purl.org/dc/terms/",
  dossier: "https://data.vlaanderen.be/ns/dossier#",
  ext: "http://mu.semte.ch/vocabularies/ext/",
  mandaat: "http://data.vlaanderen.be/ns/mandaat#",
  mu: "http://mu.semte.ch/vocabularies/core/",
  nfo: "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#",
  nie: "http://www.semanticdesktop.org/ontologies/2007/01/19/nie#",
  nmo: "http://www.semanticdesktop.org/ontologies/2007/03/22/nmo#",
  org: "http://www.w3.org/ns/org#",
  parl: "http://mu.semte.ch/vocabularies/ext/parlement/",
  pav: "http://purl.org/pav/",
  prov: "http://www.w3.org/ns/prov#",
  schema: "http://schema.org/",
  sign: "http://mu.semte.ch/vocabularies/ext/handtekenen/",
  skos: "http://www.w3.org/2004/02/skos/core#",
  xsd: "http://www.w3.org/2001/XMLSchema#"
};

const prefixHeaderLines = Object.fromEntries(
  Object.entries(prefixes).map(([key, value]) => [
    key,
    `PREFIX ${key}: ${sparqlEscapeUri(value)}`,
  ])
);

export { prefixHeaderLines };