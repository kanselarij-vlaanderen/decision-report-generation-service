import { prefixHeaderLines } from "./utils";
import { query, sparqlEscapeString, sparqlEscapeUri } from "mu";
import CONSTANTS from "../constants";
import VRDocumentName, { compareFunction } from "./vr-document-name";

export async function getAgendaitemData(agendaitemId) {
  const queryString = `
    ${prefixHeaderLines.besluitvorming}
    ${prefixHeaderLines.dct}
    ${prefixHeaderLines.ext}
    ${prefixHeaderLines.mu}

    SELECT ?shortTitle ?title ?isApproval ?subcaseName
    WHERE {
      ?agendaitem 
        mu:uuid ${sparqlEscapeString(agendaitemId)} ;
        besluitvorming:korteTitel ?shortTitle ;
        ext:isGoedkeuringVanDeNotulen ?isApproval ;
        ^besluitvorming:genereertAgendapunt/besluitvorming:vindtPlaatsTijdens ?subcase .
      ?subcase dct:alternative ?subcaseName .
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
  };
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
        dct:created ?created .
      ?documentContainer dossier:Collectie.bestaatUit ?piece . 

      OPTIONAL {
        ?documentContainer schema:position ?position .
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
  { isApproval = false, isPreKaleidos = false } = {}
) => {
  const positionsAvailable = !pieces.some(
    (piece) => piece.position === undefined
  );

  if (positionsAvailable) {
    return sortPiecesByPosition(pieces);
  } else if (isApproval) {
    return sortPiecesByName(pieces, VrNotulenName, compareNotulen);
    // } else if (isPreKaleidos) {
    //   return sortPiecesByName(
    //     pieces,
    //     VrLegacyDocumentName,
    //     compareLegacyDocuments
    //   );
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
