declare module "mu" {
  import { Application, Request, Response } from "express";

  type SparqlClientResponse = {
    head: { link: unknown[]; vars?: string[] };
    boolean?: boolean;
    results?: {
      distinct: boolean;
      ordered: boolean;
      bindings: Record<
        string,
        {
          type: "literal" | "typed-literal" | "uri";
          "xml:lang"?: string;
          datatype?:
            | "http://www.w3.org/2001/XMLSchema#dateTime"
            | "http://www.w3.org/2001/XMLSchema#integer";
          value: SparqlClientValue;
        }
      >[];
    };
  } | null;

  type SparqlClientValue = string | number | Date | boolean | undefined;

  const app: Application;
  function sparqlEscapeString(s: string): string;
  function sparqlEscapeUri(s: string): string;
  function sparqlEscapeDecimal(n: number): string;
  function sparqlEscapeInt(n: number): string;
  function sparqlEscapeFloat(n: number): string;
  function sparqlEscapeDate(date: Date): string;
  function sparqlEscapeDateTime(date: Date): string;
  function sparqlEscapeBool(bool: boolean): string;
  function sparqlEscape(
    value: string | boolean | number | Date,
    type: string
  ): string;
  function query(queryString: string): Promise<SparqlClientResponse>;
  function update(queryString: string): Promise<void>;
  function uuid(): string;
  function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    next: () => void
  ): void;
}

declare module "@lblod/mu-auth-sudo" {
  import { Application, Request, Response } from "express";

  type SparqlClientResponse = {
    head: { link: unknown[]; vars: string[] };
    results: {
      distinct: boolean;
      ordered: boolean;
      bindings: Record<
        string,
        {
          type: "literal";
          "xml:lang"?: string;
          value: SparqlClientValue;
        }
      >[];
    };
  } | null;

  type SparqlClientValue = string | number | Date | undefined;

  function querySudo(queryString: string): Promise<SparqlClientResponse>;
  function updateSudo(queryString: string): Promise<void>;
}
