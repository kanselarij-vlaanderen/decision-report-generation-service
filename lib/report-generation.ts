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
import { renderReport, createStyleHeader } from "./render-report";
import config from "../config";
import constants from "../constants";
import sanitizeHtml from "sanitize-html";
import * as fs from "fs";
import fetch from "node-fetch";
import { retrieveSignFlowStatus } from "./sign-flow";

export interface ReportParts {
  annotation: string;
  concerns: string;
  decision: string;
}

export interface Meeting {
  plannedStart: Date;
  numberRepresentation: number;
  kind: string;
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
  }
  `;

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

async function generatePdf(
  reportParts: ReportParts,
  reportContext: ReportContext,
  secretary: Secretary | null
): Promise<VirtualFile> {
  const html = renderReport(reportParts, reportContext, secretary);
  const htmlString = `${createStyleHeader()}${html}`;
  const response = await fetch("http://html-to-pdf/generate", {
    method: "POST",
    headers: {
      "Content-Type": "text/html",
    },
    body: htmlString,
  });

  if (response.ok) {
    const buffer = await response.buffer();

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
    const fileName = generateReportFileName(reportContext);
    const file: VirtualFile =   {
      id: virtualUuid,
      uri: `${config.RESOURCE_BASE}/files/${virtualUuid}`,
      name: fileName,
      extension: "pdf",
      size: buffer.byteLength,
      created: now,
      format: "application/pdf",
      physicalFile,
    };
    fs.writeFileSync(filePath, buffer);
    await createFile(file);
    return file;
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

  SELECT DISTINCT ?numberRepresentation ?geplandeStart ?agendaItemNumber ?meetingType ?agendaItemType ?accessLevel ?currentReportName WHERE {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?report mu:uuid ${sparqlEscapeString(reportId)} .
      ?report a besluitvorming:Verslag .
      ?report dct:title ?currentReportName .
      ?report besluitvorming:beschrijft/^besluitvorming:heeftBeslissing/dct:subject ?agendaItem .
      ?report besluitvorming:vertrouwelijkheidsniveau ?accessLevel .
      ?agendaItem ^dct:hasPart/besluitvorming:isAgendaVoor ?meeting .
      ?meeting ext:numberRepresentation ?numberRepresentation .
      ?meeting besluit:geplandeStart ?geplandeStart .
      ?meeting dct:type ?meetingType .
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
          meetingType,
          accessLevel,
          currentReportName
        },
      ],
    },
  } = queryResult;

  return {
    meeting: {
      plannedStart: new Date(geplandeStart.value),
      numberRepresentation: numberRepresentation.value,
      kind: meetingType.value,
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
  return {
    annotation: annotation ? sanitizeHtml(annotation, sanitizeHtml.defaults) : null,
    concerns: sanitizeHtml(concerns, sanitizeHtml.defaults),
    decision: sanitizeHtml(decision, sanitizeHtml.defaults),
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
  const fileMeta = await generatePdf(
    sanitizedParts,
    reportContext,
    secretary
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
