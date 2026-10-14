import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { api as gadgetApi, connections as gadgetConnections, logger as gadgetLogger } from "gadget-server";
import { z } from "zod";
import type { Principal } from "./auth";
import { validateEnabled } from "./config";
import { resolveUser, type GatewayUser, type Resolution } from "./identity";
import { checkVariables, evaluateQuery } from "./policy";
import { invalidDocument, preflight, resultExtras } from "./preflight";
import { findGrant, storeGrants, type GatewayShop, type StoreGrant } from "./roles";
import { adminSchema } from "./schema";
import { formatResult, queryCost, runAdminGraphql, type QueryCost } from "./shopify";

export interface McpContext {
  principal: Principal;
  bearer: string;
  api: typeof gadgetApi;
  connections: typeof gadgetConnections;
  logger: typeof gadgetLogger;
}

const INSTRUCTIONS = `Domaine Shop Gateway: Shopify Admin GraphQL API 2026-10 on Domaine stores, with your own role per store.
- Call \`stores\` to see the stores you can use (alias, domain, env, role). Pick one with \`use_store\` or pass \`store\` to \`query\`.
- \`query\` takes ONE GraphQL operation (fragments allowed) plus optional \`variables\` as a JSON object. Introspection and subscriptions are refused.
- env=prod stores are read-only: every mutation is refused there.
- env=dev stores allow mutations only for roles dev/store-admin and only these root fields: metafieldsSet, productUpdate, productCreate, metafieldDefinitionCreate, metaobjectCreate, metaobjectUpdate, publishablePublish, publishableUnpublish.
- Use 2026-10 shapes: \`productUpdate(product: {...})\` (not \`input:\`), \`metafieldsSet(metafields: [{ownerId, namespace, key, type, value}])\`.
- Prefer narrow queries: few fields, \`first:\` <= 10 (metafields 50), filter with \`query:\`, read \`pageInfo\`. Large results come back truncated with a hint.
- An \`ACCESS_DENIED\` error means the app lacks a Shopify scope for that field, not that your role is too low.
- A refusal names the rule that refused; do not retry the same document.
- Validate a mutation with \`validate\`, show it to the user, then run it with \`query\` in a later turn.`;

export function createMcpServer(context: McpContext): McpServer {
  const server = new McpServer({ name: "domaine-shop-gateway", version: "0.3.0" }, { instructions: INSTRUCTIONS });
  let resolution: Promise<Resolution> | undefined;
  const resolve = () => (resolution ??= resolveUser(context.principal, context.bearer, context.api, context.logger));

  server.registerTool(
    "whoami",
    { description: "Show the identity and global role the gateway resolved for you.", annotations: { readOnlyHint: true } },
    async () => {
      const { user, rejected } = await resolve();
      if (rejected) return refusal(rejected);
      return text({ sub: user.sub, email: user.email, name: user.name, globalRole: user.globalRole });
    }
  );

  server.registerTool(
    "stores",
    {
      description: "List the stores you can use: alias, domain, env (dev/prod), enabled, your role, and which is current.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { user, rejected } = await resolve();
      if (rejected) return refusal(rejected);
      const [grants, currentShopId] = await Promise.all([storeGrants(context.api, user), currentShop(context, user)]);
      return text(
        grants.map(({ shop, role }) => ({
          alias: shop.alias,
          domain: shop.myshopifyDomain,
          env: shop.env,
          enabled: shop.enabled,
          role,
          current: shop.id === currentShopId,
        }))
      );
    }
  );

  server.registerTool(
    "use_store",
    {
      description: "Make a store (by alias) your current store for later `query` and `validate` calls.",
      inputSchema: { alias: z.string().describe("Store alias from `stores`") },
    },
    async ({ alias }) => {
      const { user, rejected } = await resolve();
      if (rejected) return refusal(rejected);
      const grant = findGrant(await storeGrants(context.api, user), { alias });
      if (!grant) return refusal(`unknown store or no role: ${alias}`);
      await setCurrentShop(context, user, grant.shop.id);
      return text({ current: grant.shop.alias, domain: grant.shop.myshopifyDomain, env: grant.shop.env, role: grant.role });
    }
  );

  server.registerTool(
    "query",
    {
      description: "Run one Admin GraphQL (2026-10) operation on a store; it is schema-checked first and an invalid document is refused unsent. Returns {data, errors, cost, validated?, warnings?} as JSON text.",
      inputSchema: {
        query: z.string().describe("One GraphQL query or mutation document"),
        variables: z.unknown().optional().describe("Variables as a JSON object"),
        store: z.string().optional().describe("Store alias; defaults to the current store"),
      },
    },
    async (input) => runQuery(context, resolve, input)
  );

  server.registerTool(
    "validate",
    {
      description:
        "Check one Admin GraphQL (2026-10) operation against the store's policy and the Admin schema without running it. Returns {valid, validated, policy, operationType, operationName, errors, warnings} as JSON text; `valid` is true only when the policy allows and the schema check ran (`validated`) with no errors.",
      inputSchema: {
        query: z.string().describe("One GraphQL query or mutation document"),
        variables: z.unknown().optional().describe("Variables as a JSON object"),
        store: z.string().optional().describe("Store alias; defaults to the current store"),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => runValidate(context, resolve, input)
  );

  return server;
}

type Tool = "query" | "validate";
type ToolInput = { query: string; variables?: unknown; store?: string };

interface AuditEntry {
  shop?: GatewayShop;
  operationType?: string | null;
  operationName?: string | null;
  allowed: boolean;
  reason?: string | null;
  cost?: QueryCost | null;
}

type Audit = (entry: AuditEntry) => Promise<void>;
type Refuse = (reason: string, entry?: Omit<AuditEntry, "allowed" | "reason">) => Promise<CallToolResult>;

/** The checks `query` and `validate` share: identity, variables shape, store and grant. */
async function openCall(
  context: McpContext,
  resolve: () => Promise<Resolution>,
  tool: Tool,
  input: ToolInput
): Promise<{ done: CallToolResult } | { grant: StoreGrant; variables?: Record<string, unknown>; audit: Audit; refuse: Refuse }> {
  const started = Date.now();
  const { user, rejected } = await resolve();
  const audit: Audit = (entry) => writeAudit(context, user, tool, started, entry);
  const refuse: Refuse = async (reason, entry = {}) => {
    await audit({ ...entry, allowed: false, reason });
    return refusal(reason);
  };

  if (rejected) return { done: await refuse(rejected) };
  const variablesProblem = checkVariables(input.variables);
  if (variablesProblem) return { done: await refuse(variablesProblem) };

  const currentShopId = input.store ? undefined : await currentShop(context, user);
  if (!input.store && !currentShopId) return { done: await refuse("call use_store first or pass store") };
  const grant = findGrant(await storeGrants(context.api, user), { alias: input.store, shopId: currentShopId });
  if (!grant) {
    return {
      done: await refuse(
        input.store ? `unknown store or no role: ${input.store}` : "current store is no longer available, call use_store"
      ),
    };
  }
  if (!grant.shop.enabled) return { done: await refuse("store disabled", { shop: grant.shop }) };

  const variables = (input.variables ?? undefined) as Record<string, unknown> | undefined;
  return { grant, variables, audit, refuse };
}

async function schemaCheck(context: McpContext, grant: StoreGrant, source: string, variables?: Record<string, unknown>) {
  const schema = validateEnabled ? await adminSchema(context.connections.shopify, grant.shop, context.logger) : null;
  return preflight(schema, source, variables);
}

async function runQuery(context: McpContext, resolve: () => Promise<Resolution>, input: ToolInput): Promise<CallToolResult> {
  const call = await openCall(context, resolve, "query", input);
  if ("done" in call) return call.done;
  const { grant, variables, audit, refuse } = call;

  const decision = evaluateQuery(input.query, grant.role, grant.shop.env);
  const operation = { shop: grant.shop, operationType: decision.operationType, operationName: decision.operationName };
  if (!decision.allowed) return refuse(decision.reason, operation);

  const checked = await schemaCheck(context, grant, input.query, variables);
  if (checked.errors.length) {
    await audit({ ...operation, allowed: false, reason: "invalid" });
    return refusal(invalidDocument(checked.errors));
  }

  const result = await runAdminGraphql(context.connections.shopify, grant.shop, { query: decision.query, variables });
  if (!result.ok) {
    await audit({ ...operation, allowed: true, reason: result.message });
    return refusal(result.message);
  }
  await audit({ ...operation, allowed: true, cost: queryCost(result.body) });
  return { content: [{ type: "text", text: formatResult(result.body, resultExtras(checked)) }] };
}

async function runValidate(context: McpContext, resolve: () => Promise<Resolution>, input: ToolInput): Promise<CallToolResult> {
  const call = await openCall(context, resolve, "validate", input);
  if ("done" in call) return call.done;
  const { grant, variables, audit } = call;

  const decision = evaluateQuery(input.query, grant.role, grant.shop.env);
  const operation = { shop: grant.shop, operationType: decision.operationType, operationName: decision.operationName };
  const policy = { allowed: decision.allowed, reason: decision.allowed ? null : decision.reason };
  const checked = decision.allowed
    ? await schemaCheck(context, grant, input.query, variables)
    : { validated: false, errors: [], warnings: [] };
  const sendable = decision.allowed && checked.errors.length === 0;
  const valid = sendable && checked.validated;

  // `allowed` matches what `query` would audit for the same document: would it be sent.
  await audit({ ...operation, allowed: sendable, reason: policy.reason ?? (sendable ? null : "invalid") });
  return text({
    valid,
    validated: checked.validated,
    policy,
    operationType: decision.operationType,
    operationName: decision.operationName,
    errors: checked.errors,
    warnings: checked.warnings,
  });
}

async function writeAudit(
  context: McpContext,
  user: GatewayUser,
  tool: Tool,
  started: number,
  entry: AuditEntry
): Promise<void> {
  try {
    await context.api.audit.create({
      user: { _link: user.id },
      shop: entry.shop ? { _link: entry.shop.id } : undefined,
      tool,
      operationType: entry.operationType ?? "unknown",
      operationName: entry.operationName ?? null,
      allowed: entry.allowed,
      reason: entry.reason ?? null,
      durationMs: Date.now() - started,
      cost: entry.cost ?? null,
    });
  } catch (error) {
    // The Shopify call may already have run; a lost row is logged instead of reported as a failed call.
    context.logger.error({ reason: error instanceof Error ? error.name : "unknown" }, "audit write failed");
  }
}

async function currentShop(context: McpContext, user: GatewayUser): Promise<string | undefined> {
  const pref = await context.api.pref.maybeFindFirst({
    filter: { userId: { equals: user.id } },
    select: { currentShopId: true },
  });
  return pref?.currentShopId ?? undefined;
}

async function setCurrentShop(context: McpContext, user: GatewayUser, shopId: string): Promise<void> {
  const pref = await context.api.pref.maybeFindFirst({ filter: { userId: { equals: user.id } }, select: { id: true } });
  if (pref) await context.api.pref.update(pref.id, { currentShop: { _link: shopId } });
  else await context.api.pref.create({ user: { _link: user.id }, currentShop: { _link: shopId } });
}

function text(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function refusal(reason: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: reason }] };
}
