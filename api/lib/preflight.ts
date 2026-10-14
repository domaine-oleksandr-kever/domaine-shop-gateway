import { parse, type GraphQLSchema } from "graphql";
import { validateDocument, type Problem } from "./graphql-validate";

export type Preflight = { validated: boolean; errors: Problem[]; warnings: Problem[] };

const MAX_REPORTED = 3;

/** Schema check of a document the policy already allowed; a null schema (unavailable or switched off) passes unvalidated. */
export function preflight(schema: GraphQLSchema | null, source: string, variables?: Record<string, unknown>): Preflight {
  if (!schema) return { validated: false, errors: [], warnings: [] };
  // Parsed again from the client's text: the policy's AST has no locations, and line:column should match what was sent.
  return { validated: true, ...validateDocument(schema, parse(source), variables ?? {}) };
}

export function invalidDocument(errors: Problem[]): string {
  const listed = errors
    .slice(0, MAX_REPORTED)
    .map(({ message, line, column }) => (line === undefined ? message : `${message} (${line}:${column})`));
  return `invalid document: ${listed.join("; ")}`;
}

/** Fields added to a `query` result: `validated: false` only when unchecked, `warnings` only when present. */
export function resultExtras({ validated, warnings }: Preflight): Record<string, unknown> {
  return { ...(validated ? {} : { validated: false }), ...(warnings.length ? { warnings } : {}) };
}
