import * as htmlPdf from "html-pdf-chrome";
import { renderReport, createStyleHeader } from "./render-report";
import {
  app,
  query,
  update,
  sparqlEscapeString,
  sparqlEscapeUri,
  uuid as generateUuid,
} from "mu";
import { createFile, FileMeta, FileMetaNoUri } from "./file";
import { STORAGE_PATH, STORAGE_URI } from "./config";
import sanitizeHtml from "sanitize-html";

export interface ReportParts {
  concerns: string;
  decision: string;
}

export interface Meeting {
  plannedStart: Date;
  numberRepresentation: number;
}

export type ReportContext = {
  meeting: Meeting;
  agendaItemNumber: number;
};

async function generatePdf(
  reportParts: ReportParts,
  reportContext: ReportContext
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

  const html = renderReport(reportParts, reportContext);
  const pdf = await htmlPdf.create(`${createStyleHeader()}${html}`, options);
  const fileMeta: FileMetaNoUri = {
    name: fileName,
    extension: "pdf",
    size: pdf.toBuffer().buffer.byteLength,
    created: new Date(),
    format: "application/pdf",
    id: uuid,
  };

  await pdf.toFile(filePath);

  return await createFile(fileMeta, `${STORAGE_URI}${fileMeta.name}`);
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
    ?piecePart prov:value ?value .
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
    concerns: bindings.find(
      (b: Record<"title", Record<"value", string>>) =>
        b.title.value === "Betreft"
    ).value.value,
    decision: bindings.find(
      (b: Record<"title", Record<"value", string>>) =>
        b.title.value === "Beslissing"
    ).value.value,
  };
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

  SELECT DISTINCT ?numberRepresentation ?geplandeStart ?agendaItemNumber WHERE {
    ?report mu:uuid ${sparqlEscapeString(reportId)} .
    ?report a besluitvorming:Verslag .
    ?report besluitvorming:beschrijft/^besluitvorming:heeftBeslissing/dct:subject ?agendaItem .
    ?agendaItem ^dct:hasPart/besluitvorming:isAgendaVoor ?meeting .
    ?meeting ext:numberRepresentation ?numberRepresentation .
    ?meeting besluit:geplandeStart ?geplandeStart .
    ?agendaItem schema:position ?agendaItemNumber .
    FILTER(NOT EXISTS { [] prov:wasRevisionOf ?agendaItem })
  }
  `;
  const {
    results: {
      bindings: [{ numberRepresentation, geplandeStart, agendaItemNumber }],
    },
  } = await query(dataQuery);
  return {
    meeting: {
      plannedStart: new Date(geplandeStart.value),
      numberRepresentation: numberRepresentation.value,
    },
    agendaItemNumber: agendaItemNumber.value,
  };
}

function sanitizeReportParts(reportParts: ReportParts): ReportParts {
  const { concerns, decision } = reportParts;
  return {
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
  } INSERT {
    ?report prov:value ${sparqlEscapeUri(fileUri)} .
  } WHERE {
    ?report mu:uuid ${sparqlEscapeString(reportId)} .
    ?report a besluitvorming:Verslag .
    OPTIONAL {
      ?report prov:value ?document .
    }
  }
  `;

  await update(queryString);
}

app.get("/:id", async function (req, res) {
  try {
    const reportParts = await retrieveReportParts(req.params.id);
    const reportContext = await retrieveContext(req.params.id);
    if (!reportParts || !reportContext) {
      res.status(500);
      res.send("No report parts found.");
      return;
    }

    const sanitizedParts = sanitizeReportParts(reportParts);
    const fileMeta = await generatePdf(sanitizedParts, reportContext);
    // await attachToReport(req.params.id, fileMeta.uri);
    res.send(fileMeta);
  } catch (e) {
    res.status(500);
    console.error(e);
    res.send(e);
  }
});
