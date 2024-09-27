import { prefixHeaderLines } from "./utils";
import {
  query,
  update,
  sparqlEscapeString,
  sparqlEscapeUri,
  sparqlEscapeDateTime,
  uuid,
} from "mu";
import config from '../config';
import CONSTANTS from "../constants";
import VRDocumentName, { compareFunction } from "./vr-document-name";

const graph = config.graph;

export async function getAgendaitemDataFromReport(reportId) {
  const queryString = `
    ${prefixHeaderLines.besluitvorming}
    ${prefixHeaderLines.dct}
    ${prefixHeaderLines.ext}
    ${prefixHeaderLines.mu}
    ${prefixHeaderLines.prov}

    SELECT ?agendaitem ?agendaitemId ?shortTitle ?title ?isApproval ?subcaseName
    WHERE {
      ?report mu:uuid ${sparqlEscapeString(reportId)} ;
        besluitvorming:beschrijft/^besluitvorming:heeftBeslissing/dct:subject ?agendaitem .
      FILTER NOT EXISTS { ?newer prov:wasRevisionOf ?agendaitem }

      ?agendaitem
        mu:uuid ?agendaitemId ;
        besluitvorming:korteTitel ?shortTitle ;
        ^besluitvorming:genereertAgendapunt/besluitvorming:vindtPlaatsTijdens ?subcase .
      OPTIONAL {
        ?agendaitem ext:isGoedkeuringVanDeNotulen ?isApproval .
      }
      OPTIONAL {
        ?subcase ext:procedurestapNaam ?subcaseName .
      }
      OPTIONAL {
        ?agendaitem dct:title ?title .
      }
    } LIMIT 1
  `;

  const response = await query(queryString);
  const agendaitem = response?.results?.bindings?.[0];
  if (!agendaitem) {
    return null;
  }

  return {
    shortTitle: agendaitem.shortTitle.value,
    title: agendaitem.title?.value,
    isApproved: agendaitem.isApproved?.value === "1",
    subcaseName: agendaitem.subcaseName?.value,
    agendaitem: agendaitem.agendaitem.value,
    agendaitemId: agendaitem.agendaitemId.value,
  };
}

export async function getRatificationName(agendaitemId) {
  const queryString = `
    ${prefixHeaderLines.besluitvorming}
    ${prefixHeaderLines.dct}
    ${prefixHeaderLines.ext}
    ${prefixHeaderLines.mu}

    SELECT ?name
    WHERE {
      ?agendaitem
        mu:uuid ${sparqlEscapeString(agendaitemId)} ;
        ^besluitvorming:genereertAgendapunt/besluitvorming:vindtPlaatsTijdens ?subcase .

      ?subcase ext:heeftBekrachtiging/dct:title ?name .
    } LIMIT 1
  `;

  const response = await query(queryString);
  const ratification = response?.results?.bindings?.[0];
  if (!ratification) {
    return null;
  }

  return ratification.name?.value;
}

export async function getAgendaitemPiecesForReport(agendaitemId, isApproval) {
  const queryString = `
    ${prefixHeaderLines.besluitvorming}
    ${prefixHeaderLines.dct}
    ${prefixHeaderLines.dossier}
    ${prefixHeaderLines.mu}
    ${prefixHeaderLines.pav}
    ${prefixHeaderLines.schema}

    SELECT DISTINCT ?pieceName ?position ?created
    WHERE {
      ?agendaitem
        mu:uuid ${sparqlEscapeString(agendaitemId)} ;
        besluitvorming:geagendeerdStuk ?piece .
      ?piece
        dct:title ?pieceName ;
        besluitvorming:vertrouwelijkheidsniveau ?accessLevel ;
        dct:created ?created .
      ?documentContainer dossier:Collectie.bestaatUit ?piece .

      OPTIONAL {
        ?documentContainer schema:position ?position .
      }
      FILTER NOT EXISTS {
        ?piece besluitvorming:vertrouwelijkheidsniveau ${sparqlEscapeUri(
          CONSTANTS.ACCESS_LEVELS.INTERN_SECRETARIE
        )} .
      }
      FILTER NOT EXISTS {
        [] pav:previousVersion ?piece .
      }
      FILTER NOT EXISTS {
        ?documentContainer dct:type ${sparqlEscapeUri(
          CONSTANTS.DOCUMENT_TYPES.BIJLAGE_TER_INZAGE
        )}
      }
    }
  `;

  const response = await query(queryString);
  const pieces = response?.results?.bindings;
  if (!pieces) {
    return [];
  }

  const unsortedPieces = pieces.map((binding) => {
    const created = binding?.created?.value;
    const position = binding?.position?.value;

    return {
      name: binding?.pieceName?.value,
      position: parseInt(position),
      created: created ? new Date(created) : undefined,
    };
  });

  return sortPieces(unsortedPieces, { isApproval });
}

const sortPieces = (
  pieces,
  { isApproval = false } = {}
) => {
  const positionsAvailable = !pieces.some(
    (piece) => piece.position === undefined
  );

  if (positionsAvailable) {
    return sortPiecesByPosition(pieces);
  } else if (isApproval) {
    return sortPiecesByName(pieces, VrNotulenName, compareNotulen);
  } else {
    return sortPiecesByName(pieces);
  }
};

const sortPiecesByName = (
  pieces,
  NameClass = VRDocumentName,
  sortingFunc = compareFunction
) => {
  const validNamedPieces = [];
  let invalidNamedPieces = [];
  for (const piece of pieces.slice()) {
    try {
      new NameClass(piece.name).parseMeta();
      validNamedPieces.push(piece);
    } catch {
      invalidNamedPieces.push(piece);
    }
  }
  validNamedPieces.sort((docA, docB) =>
    sortingFunc(new NameClass(docA.name), new NameClass(docB.name))
  );
  invalidNamedPieces = invalidNamedPieces.sort(
    (p1, p2) => p1.created - p2.created
  );
  invalidNamedPieces.reverse();

  return [...validNamedPieces, ...invalidNamedPieces];
};

const sortPiecesByPosition = async (pieces) => {
  return pieces.sort((p1, p2) => {
    return p1.position - p2.position || p1.created - p2.created;
  });
};

export const addPieceToAgendaitem = async function (agendaitem, piece) {
  const endpoint = `/agendaitems/${agendaitem.get("id")}/pieces`;
  const body = {
    data: {
      type: "pieces",
      id: piece.get("id"),
    },
  };
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      "Content-Type": "application/vnd.api+json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to add document ${piece.get("id")} to agendaitem ${agendaitem.get(
        "id"
      )}`
    );
  }
};

export async function updateAgendaitemConcerns(agendaitemId, content) {
  const now = new Date();
  const piecePartUuid = uuid();
  const piecePartUri = `http://themis.vlaanderen.be/id/stukonderdeel/${piecePartUuid}`;
  const queryString = `
    ${prefixHeaderLines.besluitvorming}
    ${prefixHeaderLines.dct}
    ${prefixHeaderLines.dossier}
    ${prefixHeaderLines.mu}
    ${prefixHeaderLines.prov}
    ${prefixHeaderLines.pav}

    INSERT {
        ${sparqlEscapeUri(piecePartUri)}
          a dossier:Stukonderdeel ;
          mu:uuid ${sparqlEscapeString(piecePartUuid)} ;
          dct:isPartOf ?report ;
          pav:previousVersion ?piecePart ;
          prov:value ${sparqlEscapeString(content)} ;
          dct:title """Betreft""" ;
          dct:created ${sparqlEscapeDateTime(now)} .
    }
    WHERE {
        ?agendaitem
          mu:uuid ${sparqlEscapeString(agendaitemId)} .
        ?treatment
          dct:subject ?agendaitem ;
          besluitvorming:heeftBeslissing ?decisionActivity .
        ?report
          besluitvorming:beschrijft ?decisionActivity .
        ?piecePart
          dct:isPartOf ?report ;
          dct:title """Betreft""" ;
          prov:value ?content .

        FILTER NOT EXISTS {
          [] pav:previousVersion ?piecePart .
        }
    }
  `;

  await update(queryString)
}