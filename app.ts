import * as htmlPdf from "html-pdf-chrome";
import { renderReport, createStyleHeader } from "./render-report";
import {
  app,
  query,
  update,
  sparqlEscapeString,
  sparqlEscapeUri,
  sparqlEscapeDate,
  uuid as generateUuid,
} from "mu";
import { createFile, FileMeta, FileMetaNoUri } from "./file";
import { STORAGE_PATH, STORAGE_URI } from "./config";
import sanitizeHtml from "sanitize-html";
import * as fs from "fs";
import fetch from "node-fetch";
import constants from "./constants";

export interface ReportParts {
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

async function deleteFile(requestHeaders, file: File) {
  try {
    const response = await fetch(`http://file/files/${file.id}`, {
      method: "delete",
      headers: requestHeaders,
    });
    if (!response.ok) {
      throw new Error(`Something went wrong while removing the file: ${response.statusText}`);
    }
  } catch (error) {
    console.error(`Could not delete file with id: ${file.id}. Error:`, error);
  }
}

async function retrieveOldFile(reportId: string): Promise<File | null> {
  const queryString = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>

  select ?fileId WHERE {
    ?report mu:uuid ${sparqlEscapeString(reportId)} .
    ?report a besluitvorming:Verslag .
    ?report prov:value ?file .
    ?file a nfo:FileDataObject .
    ?file mu:uuid ?fileId .
  }
  `;

  const queryResult = await query(queryString);
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
): Promise<FileMeta> {
  const options: htmlPdf.CreateOptions = {
    host: "chrome-browser",
    port: 9222,
    printOptions: {
      preferCSSPageSize: true,
    },
  };

  const uuid = generateUuid();
  const fileName = `${uuid}.pdf`;
  const filePath = `${STORAGE_PATH}/${fileName}`;

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
    const fileMeta: FileMetaNoUri = {
      name: fileName,
      extension: "pdf",
      size: buffer.byteLength,
      created: new Date(),
      format: "application/pdf",
      id: uuid,
    };
    fs.writeFileSync(filePath, buffer);
    return await createFile(fileMeta, `${STORAGE_URI}${fileMeta.name}`);
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
  reportId: string
): Promise<ReportParts | null> {
  const reportQuery = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
  PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX pav: <http://purl.org/pav/>

  SELECT * WHERE {
    ?s mu:uuid ${sparqlEscapeString(reportId)} .
    ?s a besluitvorming:Verslag .
 	  ?piecePart dct:isPartOf ?s .
    ?piecePart dct:title ?title .
    ?piecePart prov:value ?htmlContent .
    FILTER(NOT EXISTS { [] pav:previousVersion ?piecePart }) .
  }
  `;

  const {
    results: { bindings },
  } = await query(reportQuery);
  if (bindings.length === 0) {
    return null;
  }

  return {
    annotation: bindings.find(
      (b: Record<"title", Record<"value", string>>) =>
        b.title.value === "Annotatie"
    ).htmlContent.value,
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
  reportId: string
): Promise<Secretary | null> {
  const dataQuery = `
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX mandaat: <http://data.vlaanderen.be/ns/mandaat#>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX persoon: <https://data.vlaanderen.be/ns/persoon#>

    SELECT DISTINCT ?lastName ?firstName ?title WHERE {
      ?report mu:uuid ${sparqlEscapeString(reportId)} .
      ?report a besluitvorming:Verslag .
      ?report besluitvorming:beschrijft ?decisionActivity .
      ?decisionActivity prov:wasAssociatedWith ?mandatee .
      ?mandatee dct:title ?title .
      ?mandatee mandaat:isBestuurlijkeAliasVan ?person .
      ?person foaf:familyName ?lastName .
      ?person persoon:gebruikteVoornaam ?firstName .
    }
    `;
  const queryResult = await query(dataQuery);
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

async function retrieveContext(reportId: string): Promise<ReportContext> {
  const dataQuery = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
  PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX schema: <http://schema.org/>

  SELECT DISTINCT ?numberRepresentation ?geplandeStart ?agendaItemNumber ?meetingType ?agendaItemType WHERE {
    ?report mu:uuid ${sparqlEscapeString(reportId)} .
    ?report a besluitvorming:Verslag .
    ?report besluitvorming:beschrijft/^besluitvorming:heeftBeslissing/dct:subject ?agendaItem .
    ?agendaItem ^dct:hasPart/besluitvorming:isAgendaVoor ?meeting .
    ?meeting ext:numberRepresentation ?numberRepresentation .
    ?meeting besluit:geplandeStart ?geplandeStart .
    ?meeting dct:type ?meetingType .
    ?agendaItem schema:position ?agendaItemNumber .
    ?agendaItem dct:type ?agendaItemType .
    FILTER(NOT EXISTS { [] prov:wasRevisionOf ?agendaItem })
  }
  `;
  const {
    results: {
      bindings: [
        {
          numberRepresentation,
          geplandeStart,
          agendaItemNumber,
          agendaItemType,
          meetingType,
        },
      ],
    },
  } = await query(dataQuery);

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

async function attachToReport(reportId: string, fileUri: string) {
  // Update this function so it works with versioning
  const queryString = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
  PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>

  DELETE {
    ?report prov:value ?document .
    ?report dct:modified ?modified .
  } INSERT {
    ?report prov:value ${sparqlEscapeUri(fileUri)} .
    ?report dct:modified ${sparqlEscapeDate(new Date())}
  } WHERE {
    ?report mu:uuid ${sparqlEscapeString(reportId)} .
    ?report a besluitvorming:Verslag .
    OPTIONAL { ?report dct:modified ?modified .}
    OPTIONAL { ?report prov:value ?document .}
  }
  `;

  await update(queryString);
}

app.get("/:id", async function (req, res) {
  try {
    const reportParts = await retrieveReportParts(req.params.id);
    const reportContext = await retrieveContext(req.params.id);
    const secretary = await retrieveReportSecretary(req.params.id);
    if (!reportParts || !reportContext) {
      res.status(500);
      res.send("No report parts found.");
      return;
    }
    const oldFile = await retrieveOldFile(req.params.id);
    const sanitizedParts = sanitizeReportParts(reportParts);
    const fileMeta = await generatePdf(
      sanitizedParts,
      reportContext,
      secretary
    );
    if (fileMeta) {
      await attachToReport(req.params.id, fileMeta.uri);
      if (oldFile) {
        await deleteFile(req.headers, oldFile);
      }
      return res.status(200).send(fileMeta);
    }
    throw new Error("Something went wrong while generating the pdf");
  } catch (e) {
    res.status(500);
    console.error(e);
    res.send(e);
  }
});
