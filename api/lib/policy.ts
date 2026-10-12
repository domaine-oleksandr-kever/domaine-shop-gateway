import {
  GraphQLError,
  Kind,
  parse,
  print,
  type DocumentNode,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
  type SelectionSetNode,
} from "graphql";

export type StoreRole = "read" | "dev" | "store-admin";
export type StoreEnv = "dev" | "prod";

export type PolicyDecision =
  | { allowed: true; operationType: "query" | "mutation"; operationName: string | null; query: string }
  | { allowed: false; reason: string; operationType: string | null; operationName: string | null };

export const ALLOWED_MUTATIONS: ReadonlySet<string> = new Set([
  "metafieldsSet",
  "productUpdate",
  "productCreate",
  "metafieldDefinitionCreate",
  "metaobjectCreate",
  "metaobjectUpdate",
  "publishablePublish",
  "publishableUnpublish",
]);

const WRITE_ROLES: ReadonlySet<StoreRole> = new Set(["dev", "store-admin"]);
const INTROSPECTION_FIELDS: ReadonlySet<string> = new Set(["__schema", "__type"]);
const MAX_VARIABLES_BYTES = 16_384;

class PolicyRefusal extends Error {}

/** Decides whether one client document may reach Shopify for this role and store env; a refusal names the rule. */
export function evaluateQuery(source: string, role: StoreRole, env: StoreEnv): PolicyDecision {
  let operation: OperationDefinitionNode | undefined;
  try {
    const document = parseDocument(source);
    const { operation: op, fragments } = splitDefinitions(document);
    operation = op;
    const rootFields = rootFieldNames(op.selectionSet, fragments, new Set());

    if (op.operation === "subscription") throw new PolicyRefusal("subscriptions are not allowed");
    if (op.operation === "query") {
      const introspection = rootFields.find((name) => INTROSPECTION_FIELDS.has(name));
      if (introspection) throw new PolicyRefusal(`introspection (${introspection}) is not allowed`);
    } else {
      checkMutation(rootFields, role, env);
    }

    return {
      allowed: true,
      operationType: op.operation,
      operationName: op.name?.value ?? null,
      query: print(document),
    };
  } catch (error) {
    if (!(error instanceof PolicyRefusal)) throw error;
    return {
      allowed: false,
      reason: error.message,
      operationType: operation?.operation ?? null,
      operationName: operation?.name?.value ?? null,
    };
  }
}

/** Returns a refusal reason when `variables` is not a plain JSON object within the size limit. */
export function checkVariables(variables: unknown): string | null {
  if (variables === undefined || variables === null) return null;
  if (typeof variables !== "object" || Array.isArray(variables) || Object.getPrototypeOf(variables) !== Object.prototype) {
    return "variables must be a plain object";
  }
  if (Buffer.byteLength(JSON.stringify(variables)) > MAX_VARIABLES_BYTES) return "variables exceed 16 KB";
  return null;
}

function parseDocument(source: string): DocumentNode {
  try {
    return parse(source, { noLocation: true });
  } catch (error) {
    if (!(error instanceof GraphQLError)) throw error;
    // Syntax messages quote tokens from the client's document; keep the reason free of query text.
    const where = error.locations?.[0] ? ` at ${error.locations[0].line}:${error.locations[0].column}` : "";
    throw new PolicyRefusal(`parse error${where}: ${error.message.replace(/".*$/s, "…")}`);
  }
}

function splitDefinitions(document: DocumentNode): {
  operation: OperationDefinitionNode;
  fragments: Map<string, FragmentDefinitionNode>;
} {
  const operations: OperationDefinitionNode[] = [];
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) operations.push(definition);
    else if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      if (fragments.has(definition.name.value)) throw new PolicyRefusal("fragment names must be unique");
      fragments.set(definition.name.value, definition);
    } else throw new PolicyRefusal("only operations and fragments are allowed");
  }
  if (operations.length !== 1) throw new PolicyRefusal("exactly one operation per request");

  const used = new Set<string>();
  collectSpreads(operations[0].selectionSet, fragments, used);
  const unused = [...fragments.keys()].filter((name) => !used.has(name));
  if (unused.length > 0) throw new PolicyRefusal(`unused fragment ${unused[0]}`);
  return { operation: operations[0], fragments };
}

function collectSpreads(
  selectionSet: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  used: Set<string>
): void {
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const name = selection.name.value;
      const fragment = fragments.get(name);
      if (!fragment) throw new PolicyRefusal(`unknown fragment ${name}`);
      if (used.has(name)) continue;
      used.add(name);
      collectSpreads(fragment.selectionSet, fragments, used);
    } else if (selection.selectionSet) {
      collectSpreads(selection.selectionSet, fragments, used);
    }
  }
}

/** Root field names, looking through fragment spreads and inline fragments at the root level. */
function rootFieldNames(
  selectionSet: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  visited: Set<string>
): string[] {
  return selectionSet.selections.flatMap((selection) => {
    if (selection.kind === Kind.FIELD) return [selection.name.value];
    if (selection.kind === Kind.INLINE_FRAGMENT) return rootFieldNames(selection.selectionSet, fragments, visited);
    const name = selection.name.value;
    if (visited.has(name)) return [];
    visited.add(name);
    return rootFieldNames(fragments.get(name)!.selectionSet, fragments, visited);
  });
}

function checkMutation(rootFields: string[], role: StoreRole, env: StoreEnv): void {
  if (env !== "dev") throw new PolicyRefusal("prod is read-only");
  if (!WRITE_ROLES.has(role)) throw new PolicyRefusal(`role ${role} cannot run mutations`);
  const blocked = rootFields.find((name) => !ALLOWED_MUTATIONS.has(name));
  if (blocked) throw new PolicyRefusal(`mutation ${blocked} is not on the dev allow-list`);
}
