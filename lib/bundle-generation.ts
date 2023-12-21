import {
  query,
  update,
  sparqlEscapeString,
  sparqlEscapeUri,
  sparqlEscapeDateTime,
  uuid,
} from "mu";
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import fs from 'fs';
import { PDFDocument } from "pdf-lib";
import config from "../config";
import { deleteFile, retrieveContext, storePdf, File } from "./report-generation";
import { FileMeta, } from "./file";

export async function getReportsForMeeting(
  meetingId: string,
): Promise<[string] | []> {
  const queryString = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX schema: <http://schema.org/>
  PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
  
  
  SELECT DISTINCT ?report WHERE {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?meeting mu:uuid ${sparqlEscapeString(meetingId)} .
      ?meeting a besluit:Vergaderactiviteit .
      ?agenda besluitvorming:isAgendaVoor ?meeting .
      ?agenda dct:hasPart ?agendaitem .
      ?decisionActivity ^besluitvorming:heeftBeslissing/dct:subject ?agendaitem .
      ?report besluitvorming:beschrijft ?decisionActivity .
      ?report besluitvorming:vertrouwelijkheidsniveau ${sparqlEscapeUri(config.INTERN_OVERHEID)} .
  
      FILTER NOT EXISTS { ?nextAgenda prov:wasRevisionOf ?agenda }
    }
  }`;
  const queryResult = await query(queryString);
  const bindings = queryResult.results.bindings;
  if (bindings.length === 0) {
    return [];
  } else {
    const reporturis = bindings.map((binding) => (
      binding.report.value
    ))
    return reporturis;
  }
}

async function getOldBundleFile(
  meetingId: string,
  viaJob: boolean,
): Promise<File | null> {
  const queryString = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
  PREFIX dct: <http://purl.org/dc/terms/>

  SELECT DISTINCT ?fileId WHERE {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?meeting mu:uuid ${sparqlEscapeString(meetingId)} .
      ?meeting a besluit:Vergaderactiviteit .
      ?meeting ext:numberRepresentation ?numberRepresentation .
      ?meeting ext:zittingDocumentversie ?piece .
      BIND(CONCAT(?numberRepresentation, " - ALLE BESLISSINGEN") AS ?pieceName)
      ?piece dct:title ?pieceName .
      ?piece prov:value ?file .
      ?file a nfo:FileDataObject .
      ?file mu:uuid ?fileId .
    }
  }`;
  let queryResult;
  if (viaJob) {
    queryResult = await querySudo(queryString);
  } else {
    queryResult = await query(queryString);
  }
  if (queryResult.results?.bindings?.length) {
    const result = queryResult.results.bindings[0];
    return { id: result.fileId.value };
  }
  return null;
}

async function getReportFiles(
  reportIds: string[],
  viaJob: boolean,
): Promise<{ report: string, physicalFile: string }[] | null> {

  const queryString = `
PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
PREFIX sign: <http://mu.semte.ch/vocabularies/ext/handtekenen/>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX schema: <http://schema.org/>
PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>

SELECT DISTINCT ?report ?physicalFile
WHERE {
  VALUES ?reportId { ${reportIds.map(sparqlEscapeString).join(' ')} }
  GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
    ?report mu:uuid ?reportId .
    ?report prov:value/^nie:dataSource ?originalFile .
    OPTIONAL {
      ?report sign:getekendStukKopie/prov:value/^nie:dataSource ?flattenedFile .
    }
    ?report dct:title ?reportName .
    ?report besluitvorming:beschrijft ?decisionActivity .
    ?treatment besluitvorming:heeftBeslissing ?decisionActivity .
    ?treatment dct:subject ?agendaitem .
    ?agendaitem dct:type ?agendaitemType .

    BIND(IF(BOUND(?flattenedFile), ?flattenedFile , ?originalFile) AS ?physicalFile)
  }
  GRAPH ${sparqlEscapeUri(config.graph.public)} { ?agendaitemType schema:position ?typeOrder }
} ORDER BY ?typeOrder ?reportName`;

  let result;
  if (viaJob) {
    result = await querySudo(queryString);
  } else {
    result = await query(queryString);
  }
  const bindings = result.results.bindings;
  if (bindings.length === 0) {
    return null;
  } else {
    return bindings.map((binding) => ({
      report: binding.report.value,
      physicalFile: binding.physicalFile.value,
    }));
  }
}

async function attachToMeeting(
  meetingId: string,
  fileMeta: FileMeta,
  viaJob: boolean
) {
  const pieceUuid = uuid();
  const pieceUri = `${config.PIECE_RESOURCE_BASE}${pieceUuid}`;

  const documentContainerUuid = uuid();
  const documentContainerUri = `${config.DOCUMENT_CONTAINER_RESOURCE_BASE}${documentContainerUuid}`;

  const now = new Date();

  const accessLevel = config.INTERN_OVERHEID

  const insertPieceQueryString = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>

  INSERT {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?meeting ext:zittingDocumentversie ${sparqlEscapeUri(pieceUri)} .
      ${sparqlEscapeUri(pieceUri)} a dossier:Stuk ;
        mu:uuid ${sparqlEscapeString(pieceUuid)} ;
        dct:title ?pieceName ;
        besluitvorming:vertrouwelijkheidsniveau ${sparqlEscapeUri(accessLevel)} ;
        dct:created ${sparqlEscapeDateTime(now)} ;
        dct:modified ${sparqlEscapeDateTime(now)} .
      ${sparqlEscapeUri(documentContainerUri)} a dossier:Serie ;
        mu:uuid ${sparqlEscapeString(documentContainerUuid)} ;
        dct:created ${sparqlEscapeDateTime(now)} ;
        dct:type ${sparqlEscapeUri(config.BESLISSINGSFICHE_TYPE)} ;
        dossier:Collectie.bestaatUit ${sparqlEscapeUri(pieceUri)} .
    }
  }
  WHERE {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?meeting mu:uuid ${sparqlEscapeString(meetingId)} .
      ?meeting a besluit:Vergaderactiviteit .
      ?meeting ext:numberRepresentation ?numberRepresentation .
      BIND(CONCAT(?numberRepresentation, " - ALLE BESLISSINGEN") AS ?pieceName)
      FILTER NOT EXISTS {
        ?meeting ext:zittingDocumentversie ?piece .
        ?piece dct:title ?pieceName .
      }
    }
  }`;

  const attachFileToPieceQueryString = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  DELETE {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?piece prov:value ?file .
      ?piece dct:modified ?modified .
    }
  } INSERT {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?piece prov:value ${sparqlEscapeUri(fileMeta.uri)} .
      ?piece dct:modified ${sparqlEscapeDateTime(now)}
    }
  } WHERE {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?meeting mu:uuid ${sparqlEscapeString(meetingId)} .
      ?meeting a besluit:Vergaderactiviteit .
      ?meeting ext:numberRepresentation ?numberRepresentation .
      ?meeting ext:zittingDocumentversie ?piece .
      BIND(CONCAT(?numberRepresentation, " - ALLE BESLISSINGEN") AS ?pieceName)
      ?piece dct:title ?pieceName .
      OPTIONAL { ?piece dct:modified ?modified .}
      OPTIONAL { ?piece prov:value ?file .}
    }
  }
  `;

  if (viaJob) {
    await updateSudo(insertPieceQueryString);
    await updateSudo(attachFileToPieceQueryString);
  } else {
    await update(insertPieceQueryString);
    await update(attachFileToPieceQueryString);
  }
}


export async function generateReportBundle(
  reportIds: string[],
  requestHeaders,
  viaJob: boolean = false,
) {

  if (reportIds.length === 0) return;

  console.debug('############## Getting individual report files');
  const reportFileUris = await getReportFiles(reportIds, viaJob);

  if (reportFileUris === null || reportFileUris.length === 0) return;

  const reportContext = await retrieveContext(reportIds[0], viaJob);
  const meetingId = reportContext.meeting.id;
  const meetingNumberRepresentation = reportContext.meeting.numberRepresentation;


  console.debug('############## Getting old bundle file');
  const oldFile = await getOldBundleFile(meetingId, viaJob);

  const mergedPdf = await PDFDocument.create();

  console.debug('############## Merging report PDFs into single bundle');
  for (const { physicalFile } of reportFileUris) {
    const filePath = physicalFile.replace('share://', '/share/');
    const pdf = await PDFDocument.load(fs.readFileSync(filePath));
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }
  const mergedPdfFile = await mergedPdf.save();

  console.debug('############## Storing merged bundle PDF');
  const fileMeta = await storePdf(
    `${meetingNumberRepresentation.replace('/', '-')} - ALLE BESLISSINGEN.pdf`,
    mergedPdfFile,
    viaJob,
  );

  if (fileMeta) {
    console.debug('############## Attaching bundle PDF to meeting');
    await attachToMeeting(meetingId, fileMeta, viaJob);
    if (oldFile) {
      console.debug('############## Deleting old bundle file');
      deleteFile(requestHeaders, oldFile);
    }
    return fileMeta;
  }
  throw new Error("Something went wrong while generating the pdf");
}
