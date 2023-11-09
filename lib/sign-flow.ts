import {
  sparqlEscapeUri,
  sparqlEscapeString,
  query,
} from "mu";
import { querySudo } from '@lblod/mu-auth-sudo';
import config from "../config";

async function retrieveSignFlowStatus(
  reportId: string,
  viaJob: boolean
): Promise<string | undefined> {
  const dataQuery = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX sign: <http://mu.semte.ch/vocabularies/ext/handtekenen/>
  PREFIX adms: <http://www.w3.org/ns/adms#>
  SELECT DISTINCT ?report ?signFlow ?status WHERE {
    GRAPH ${sparqlEscapeUri(config.graph.kanselarij)} {
      ?report mu:uuid ${sparqlEscapeString(reportId)} .
    }
    OPTIONAL {
      GRAPH ${sparqlEscapeUri(config.signFlows.graph)} {
        ?signMarkingActivity sign:gemarkeerdStuk ?report .
        ?signMarkingActivity sign:markeringVindtPlaatsTijdens ?signSubcase .
        ?signFlow sign:doorlooptHandtekening ?signSubcase .
        ?signFlow adms:status ?status .
      }
    }
  }`;
  let queryResult;
  if (viaJob) {
    queryResult = await querySudo(dataQuery);
  } else {
    queryResult = await query(dataQuery);
  }
  if (
    queryResult.results &&
    queryResult.results.bindings &&
    queryResult.results.bindings.length
  ) {
    const result = queryResult.results.bindings[0];
    return result?.status?.value;
  }
}

export {
  retrieveSignFlowStatus,
}
