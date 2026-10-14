import {
  Kind,
  NoDeprecatedCustomRule,
  getVariableValues,
  validate,
  type DocumentNode,
  type GraphQLError,
  type GraphQLSchema,
  type OperationDefinitionNode,
} from "graphql";

export type Problem = { message: string; line?: number; column?: number };

/** Checks a parsed document against a schema; warnings are deprecations and never make it invalid. */
export function validateDocument(
  schema: GraphQLSchema,
  document: DocumentNode,
  variables?: Record<string, unknown>
): { errors: Problem[]; warnings: Problem[] } {
  const operation = document.definitions.find(
    (definition): definition is OperationDefinitionNode => definition.kind === Kind.OPERATION_DEFINITION
  );
  if (!operation) return { errors: [{ message: "no operation" }], warnings: [] };

  const errors = validate(schema, document).map(problem);
  const warnings = validate(schema, document, [NoDeprecatedCustomRule]).map(problem);
  if (variables !== undefined && errors.length === 0) {
    const coerced = getVariableValues(schema, operation.variableDefinitions ?? [], variables);
    if (coerced.errors) errors.push(...coerced.errors.map((error) => ({ message: error.message })));
  }
  return { errors, warnings };
}

function problem(error: GraphQLError): Problem {
  const location = error.locations?.[0];
  return location ? { message: error.message, line: location.line, column: location.column } : { message: error.message };
}
