import {
  query,
  update,
  sparqlEscapeString,
  sparqlEscapeUri,
  sparqlEscapeDateTime,
  uuid as generateUuid,
} from "mu";
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import { createFile, PhysicalFile, VirtualFile, FileMeta } from "./file";
import { generateReportBundleHtml, generateReportHtml } from "./render-report";
import config from "../config";
import constants from "../constants";
import sanitizeHtml from "sanitize-html";
import * as fs from "fs";
import fetch from "node-fetch";
import { retrieveSignFlowStatus } from "./sign-flow";

export interface ReportParts {
  annotation: string | null;
  concerns: string;
  decision: string;
}

export interface Meeting {
  id: string;
  plannedStart: Date;
  numberRepresentation: string;
  kind: string;
  mainMeetingKind: string | null;
}

export type ReportContext = {
  meeting: Meeting;
  agendaItem: AgendaItem;
  accessLevel: string;
  currentReportName: string;
};

export type AgendaItem = {
  number: number;
  isAnnouncement: boolean;
};

export type File = {
  id: string;
}

export interface Person {
  firstName: string;
  lastName: string;
}

export type Secretary = {
  person: Person;
  title: string;
};

function generateReportFileName(reportContext: ReportContext): string {
  return `${reportContext.currentReportName}.pdf`.replace('/', '-');
}

async function deleteFile(requestHeaders, file: File) {
  try {
    const response = await fetch(`http://file/files/${file.id}`, {
      method: "delete",
      headers: {
        'mu-auth-allowed-groups': requestHeaders['mu-auth-allowed-groups'],
        'mu-call-id': requestHeaders['mu-call-id'],
        'mu-session-id': requestHeaders['mu-session-id'],
      }
    });
    if (!response.ok) {
      throw new Error(`Something went wrong while removing the file: ${response.statusText}`);
    }
  } catch (error) {
    console.error(`Could not delete file with id: ${file.id}. Error:`, error);
  }
}

async function retrieveOldFile(
  reportId: string,
  viaJob: boolean
): Promise<File | null> {
  const queryString = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>

  SELECT DISTINCT ?fileId WHERE {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?report mu:uuid ${sparqlEscapeString(reportId)} .
      ?report a besluitvorming:Verslag .
      ?report prov:value ?file .
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

async function retrieveOldBundleFile(
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
      BIND(CONCAT(REPLACE(?numberRepresentation, "/", "-"), " - ALLE BESLISSINGEN") AS ?pieceName)
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

async function renderHtml(html: string): Promise<Buffer> {
  const response = await fetch("http://html-to-pdf/generate", {
    method: "POST",
    headers: {
      "Content-Type": "text/html",
    },
    body: html,
  });

  if (response.ok) {
    const buffer = await response.buffer();
    return buffer;
  } else {
    if (response.headers["Content-Type"] === "application/vnd.api+json") {
      const errorResponse = await response.json();
      console.log(
        "Rendering PDF returned the following error response: ",
        errorResponse
      );
    }
    throw new Error("Something went wrong while generating the pdf");
  }
}

async function storePdf(fileName: string, buffer: Buffer, viaJob: boolean) {
  const now = new Date();
  const physicalUuid = generateUuid();
  const physicalName = `${physicalUuid}.pdf`
  const filePath = `${config.STORAGE_PATH}/${physicalName}`;

  const physicalFile: PhysicalFile = {
    id: physicalUuid,
    uri: filePath.replace('/share/', 'share://'),
    name: physicalName,
    extension: "pdf",
    size: buffer.byteLength,
    created: now,
    format: "application/pdf",
  };

  const virtualUuid = generateUuid();
  const file: VirtualFile =   {
    id: virtualUuid,
    uri: `${config.FILE_RESOURCE_BASE}${virtualUuid}`,
    name: fileName,
    extension: "pdf",
    size: buffer.byteLength,
    created: now,
    format: "application/pdf",
    physicalFile,
  };
  fs.writeFileSync(filePath, buffer);
  await createFile(file, viaJob);
  return file;
}

async function retrieveReportParts(
  reportId: string,
  viaJob: boolean
): Promise<ReportParts | null> {
  const reportQuery = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
  PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX pav: <http://purl.org/pav/>

  SELECT * WHERE {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?s mu:uuid ${sparqlEscapeString(reportId)} .
      ?s a besluitvorming:Verslag .
   	  ?piecePart dct:isPartOf ?s .
      ?piecePart dct:title ?title .
      ?piecePart prov:value ?htmlContent .
      FILTER(NOT EXISTS { [] pav:previousVersion ?piecePart }) .
    }
  }
  `;
  let queryResult;
  if (viaJob) {
    queryResult = await querySudo(reportQuery);
  } else {
    queryResult = await query(reportQuery);
  }
  const {
    results: { bindings },
  } = queryResult;
  if (bindings.length === 0) {
    return null;
  }

  return {
    annotation: bindings.find(
      (b: Record<"title", Record<"value", string>>) =>
        b.title.value === "Annotatie"
    )?.htmlContent?.value,
    concerns: bindings.find(
      (b: Record<"title", Record<"value", string>>) =>
        b.title.value === "Betreft"
    ).htmlContent.value,
    decision: bindings.find(
      (b: Record<"title", Record<"value", string>>) =>
        b.title.value === "Beslissing"
    ).htmlContent.value,
  };
}

async function retrieveReportSecretary(
  reportId: string,
  viaJob: boolean
): Promise<Secretary | null> {
  const dataQuery = `
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX mandaat: <http://data.vlaanderen.be/ns/mandaat#>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX persoon: <https://data.vlaanderen.be/ns/persoon#>

    SELECT DISTINCT ?lastName ?firstName ?title  WHERE {
      GRAPH ${sparqlEscapeUri(config.graph.public)}  {
        ?mandatee dct:title ?title .
        ?mandatee mandaat:isBestuurlijkeAliasVan ?person .
        ?person foaf:familyName ?lastName .
        ?person persoon:gebruikteVoornaam ?firstName .
        {
          SELECT DISTINCT ?mandatee WHERE {
            GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
              ?report mu:uuid ${sparqlEscapeString(reportId)} .
              ?report a besluitvorming:Verslag .
              ?report besluitvorming:beschrijft ?decisionActivity .
              ?decisionActivity prov:wasAssociatedWith ?mandatee .
            }
          }
        }
      }
    }
    `;
  let queryResult;
  if (viaJob) {
    queryResult = await querySudo(dataQuery);
  } else {
    queryResult = await query(dataQuery);
  }
  if (queryResult.results?.bindings?.length) {
    const result = queryResult.results.bindings[0];
    return {
      person: {
        firstName: result.firstName.value,
        lastName: result.lastName.value,
      },
      title: result.title.value,
    };
  }
  return null;
}

async function retrieveContext(
  reportId: string,
  viaJob: boolean
): Promise<ReportContext> {
  const dataQuery = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
  PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX schema: <http://schema.org/>

  SELECT DISTINCT
  ?numberRepresentation ?geplandeStart ?agendaItemNumber ?meetingId ?meetingType ?mainMeetingType ?agendaItemType ?accessLevel ?currentReportName
  WHERE {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?report mu:uuid ${sparqlEscapeString(reportId)} .
      ?report a besluitvorming:Verslag .
      ?report dct:title ?currentReportName .
      ?report besluitvorming:beschrijft/^besluitvorming:heeftBeslissing/dct:subject ?agendaItem .
      ?report besluitvorming:vertrouwelijkheidsniveau ?accessLevel .
      ?agendaItem ^dct:hasPart/besluitvorming:isAgendaVoor ?meeting .
      ?meeting mu:uuid ?meetingId .
      ?meeting ext:numberRepresentation ?numberRepresentation .
      ?meeting besluit:geplandeStart ?geplandeStart .
      ?meeting dct:type ?meetingType .
      OPTIONAL {
        ?meeting dct:isPartOf ?mainMeeting .
        ?mainMeeting dct:type ?mainMeetingType .
      }
      ?agendaItem schema:position ?agendaItemNumber .
      ?agendaItem dct:type ?agendaItemType .
      FILTER(NOT EXISTS { [] prov:wasRevisionOf ?agendaItem })
    }
  }
  `;
  let queryResult;
  if (viaJob) {
    queryResult = await querySudo(dataQuery);
  } else {
    queryResult = await query(dataQuery);
  }
  const {
    results: {
      bindings: [
        {
          numberRepresentation,
          geplandeStart,
          agendaItemNumber,
          agendaItemType,
          meetingId,
          meetingType,
          mainMeetingType,
          accessLevel,
          currentReportName
        },
      ],
    },
  } = queryResult;

  return {
    meeting: {
      id: meetingId.value,
      plannedStart: new Date(geplandeStart.value),
      numberRepresentation: numberRepresentation.value,
      kind: meetingType.value,
      mainMeetingKind: mainMeetingType?.value
    },
    agendaItem: {
      number: agendaItemNumber.value,
      isAnnouncement:
        agendaItemType.value === constants.AGENDA_ITEM_TYPES.ANNOUNCEMENT,
    },
    accessLevel: accessLevel?.value,
    currentReportName: currentReportName?.value,
  };
}

function sanitizeReportParts(reportParts: ReportParts): ReportParts {
  const { concerns, decision, annotation } = reportParts;
  const additionalAllowedTags = ['del'];
  const additionalAllowedAttributes = {'ol': ['data-list-style']};
  const options = sanitizeHtml.defaults;
  options.allowedTags = sanitizeHtml.defaults.allowedTags.concat(additionalAllowedTags);
  options.allowedAttributes = { 
    ...sanitizeHtml.defaults.allowedAttributes, 
    ...additionalAllowedAttributes
  };
  return {
    annotation: annotation ? sanitizeHtml(annotation, sanitizeHtml.defaults) : null,
    concerns: sanitizeHtml(concerns, options),
    decision: sanitizeHtml(decision, options),
  };
}

async function attachToReport(
  reportId: string,
  fileMeta: FileMeta,
  viaJob: boolean
) {
  // Update this function so it works with versioning
  const queryString = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
  PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>

  DELETE {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?report prov:value ?document .
      ?report dct:modified ?modified .
    }
  } INSERT {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?report prov:value ${sparqlEscapeUri(fileMeta.uri)} .
      ?report dct:modified ${sparqlEscapeDateTime(new Date())}
    }
  } WHERE {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?report mu:uuid ${sparqlEscapeString(reportId)} .
      ?report a besluitvorming:Verslag .
      OPTIONAL { ?report dct:modified ?modified .}
      OPTIONAL { ?report prov:value ?document .}
    }
  }
  `;

  if (viaJob) {
    await updateSudo(queryString);
  } else {
    await update(queryString);
  }
}

async function attachToMeeting(
  meetingId: string,
  fileMeta: FileMeta,
  viaJob: boolean
) {
  const pieceUuid = generateUuid();
  const pieceUri = `${config.PIECE_RESOURCE_BASE}${pieceUuid}`;

  const documentContainerUuid = generateUuid();
  const documentContainerUri = `${config.DOCUMENT_CONTAINER_RESOURCE_BASE}${documentContainerUuid}`;

  const now = new Date();

  const queryString = `
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
        besluitvorming:vertrouwelijkheidsniveau ${sparqlEscapeUri(config.INTERN_OVERHEID)} ;
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
      BIND(CONCAT(REPLACE(?numberRepresentation, "/", "-"), " - ALLE BESLISSINGEN") AS ?pieceName)
      FILTER NOT EXISTS {
        ?meeting ext:zittingDocumentversie ?piece .
        ?piece dct:title ?pieceName .
      }
    }
  }
  ;
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
      BIND(CONCAT(REPLACE(?numberRepresentation, "/", "-"), " - ALLE BESLISSINGEN") AS ?pieceName)
      ?piece dct:title ?pieceName .
      OPTIONAL { ?piece dct:modified ?modified .}
      OPTIONAL { ?piece prov:value ?file .}
    }
  }
  `;

  if (viaJob) {
    await updateSudo(queryString);
  } else {
    await update(queryString);
  }
}

export async function generateReport(
  reportId: string,
  requestHeaders,
  viaJob: boolean = false,
) {
  const reportParts = await retrieveReportParts(reportId, viaJob);
  const reportContext = await retrieveContext(reportId, viaJob);
  const secretary = await retrieveReportSecretary(reportId, viaJob);
  const signFlowStatus = await retrieveSignFlowStatus(reportId, viaJob);
  if (!reportParts || !reportContext) {
    throw new Error("No report parts found.");
  }
  if (!reportContext.meeting) {
    throw new Error("No meeting found for this report.");
  }
  if (signFlowStatus && signFlowStatus !== config.signFlows.statuses.marked) {
    throw new Error("Cannot edit reports that have signatures.")
  }

  const oldFile = await retrieveOldFile(reportId, viaJob);
  const sanitizedParts = sanitizeReportParts(reportParts);
  const reportHtml = generateReportHtml(sanitizedParts, reportContext, secretary);
  const pdfBuffer = await renderHtml(reportHtml);
  const fileMeta = await storePdf(
    generateReportFileName(reportContext),
    pdfBuffer,
    viaJob,
  );

  if (fileMeta) {
    await attachToReport(reportId, fileMeta, viaJob);
    if (oldFile) {
      deleteFile(requestHeaders, oldFile);
    }
    return fileMeta;
  }
  throw new Error("Something went wrong while generating the pdf");
}

export async function generateReportBundle(
  reportIds: [string],
  requestHeaders,
  viaJob: boolean = false,
) {

  let parameters: {
    reportParts: ReportParts,
    reportContext: ReportContext,
    secretary: Secretary | null
  }[] = [];
  for (const reportId of reportIds) {
    const reportParts = await retrieveReportParts(reportId, viaJob);
    const reportContext = await retrieveContext(reportId, viaJob);
    const secretary = await retrieveReportSecretary(reportId, viaJob);
    if (!reportParts || !reportContext) {
      throw new Error(`No report parts found for report with id ${reportId}.`);
    }
    if (!reportContext.meeting) {
      throw new Error(`No meeting found for report with id ${reportId}.`);
    }

    const sanitizedParts = sanitizeReportParts(reportParts);

    parameters.push({ reportParts: sanitizedParts, reportContext, secretary });
  }

  const meetingId = parameters[0].reportContext.meeting.id;
  const meetingNumberRepresentation = parameters[0].reportContext.meeting.numberRepresentation;
  for (const { reportContext } of parameters) {
    if (reportContext.meeting.id !== meetingId) {
      throw new Error(`Not all reports belong to the same meeting, can't create bundle.`);
    }
  }

  console.debug('############## Getting old bundle file');
  const oldFile = await retrieveOldBundleFile(meetingId, viaJob);
  console.debug('############## Generating report bundle html');
  const reportBundleHtml = generateReportBundleHtml(parameters);
  console.debug('############## Rendering report bundle in backend service');
  const pdfBuffer = await renderHtml(reportBundleHtml);
  console.debug('############## Storing rendered bundle PDF');
  const fileMeta = await storePdf(
    `${meetingNumberRepresentation.replace('/', '-')} - ALLE BESLISSINGEN.pdf`,
    pdfBuffer,
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
