import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { api as gadgetApi, connections as gadgetConnections, logger as gadgetLogger } from "gadget-server";
import { z } from "zod";
import type { Principal } from "./auth";
import { resolveUser, type GatewayUser, type Resolution } from "./identity";
import { checkVariables, evaluateQuery } from "./policy";
import { findGrant, storeGrants, type GatewayShop } from "./roles";
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
- A refusal names the rule that refused; do not retry the same document. Show a mutation to the user before running it.`;

export function createMcpServer(context: McpContext): McpServer {
  const server = new McpServer({ name: "domaine-shop-gateway", version: "0.2.0" }, { instructions: INSTRUCTIONS });
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
      description: "Make a store (by alias) your current store for later `query` calls.",
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
      description: "Run one Admin GraphQL (2026-10) operation on a store. Returns {data, errors, cost} as JSON text.",
      inputSchema: {
        query: z.string().describe("One GraphQL query or mutation document"),
        variables: z.unknown().optional().describe("Variables as a JSON object"),
        store: z.string().optional().describe("Store alias; defaults to the current store"),
      },
    },
    async (input) => runQuery(context, resolve, input)
  );

  return server;
}

interface AuditEntry {
  shop?: GatewayShop;
  operationType?: string | null;
  operationName?: string | null;
  allowed: boolean;
  reason?: string | null;
  cost?: QueryCost | null;
}

async function runQuery(
  context: McpContext,
  resolve: () => Promise<Resolution>,
  input: { query: string; variables?: unknown; store?: string }
): Promise<CallToolResult> {
  const started = Date.now();
  const { user, rejected } = await resolve();
  const audit = (entry: AuditEntry) => writeAudit(context, user, started, entry);
  const refuse = async (reason: string, entry: Omit<AuditEntry, "allowed" | "reason"> = {}) => {
    await audit({ ...entry, allowed: false, reason });
    return refusal(reason);
  };

  if (rejected) return refuse(rejected);
  const variablesProblem = checkVariables(input.variables);
  if (variablesProblem) return refuse(variablesProblem);

  const currentShopId = input.store ? undefined : await currentShop(context, user);
  if (!input.store && !currentShopId) return refuse("call use_store first or pass store");
  const grant = findGrant(await storeGrants(context.api, user), { alias: input.store, shopId: currentShopId });
  if (!grant) {
    return refuse(input.store ? `unknown store or no role: ${input.store}` : "current store is no longer available, call use_store");
  }
  if (!grant.shop.enabled) return refuse("store disabled", { shop: grant.shop });

  const decision = evaluateQuery(input.query, grant.role, grant.shop.env);
  const operation = { shop: grant.shop, operationType: decision.operationType, operationName: decision.operationName };
  if (!decision.allowed) return refuse(decision.reason, operation);

  const variables = (input.variables ?? undefined) as Record<string, unknown> | undefined;
  const result = await runAdminGraphql(context.connections.shopify, grant.shop, { query: decision.query, variables });
  if (!result.ok) {
    await audit({ ...operation, allowed: true, reason: result.message });
    return refusal(result.message);
  }
  await audit({ ...operation, allowed: true, cost: queryCost(result.body) });
  return { content: [{ type: "text", text: formatResult(result.body) }] };
}

async function writeAudit(context: McpContext, user: GatewayUser, started: number, entry: AuditEntry): Promise<void> {
  try {
    await context.api.audit.create({
      user: { _link: user.id },
      shop: entry.shop ? { _link: entry.shop.id } : undefined,
      tool: "query",
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
