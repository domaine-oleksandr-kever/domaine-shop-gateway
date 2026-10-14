import { buildClientSchema, getIntrospectionQuery, type GraphQLSchema, type IntrospectionQuery } from "graphql";
import { shopifyApiVersion } from "./config";
import { runAdminGraphql, type ShopifyConnection } from "./shopify";

type SchemaLogger = {
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
};

const TTL_MS = 24 * 60 * 60 * 1000;
const COOL_DOWN_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
// Without inputValueDeprecation the answer omits deprecated arguments and input fields, which would then validate as unknown.
const INTROSPECTION = getIntrospectionQuery({ descriptions: false, inputValueDeprecation: true });

/** The last schema built; it stays in use past `expires` while refreshes fail. */
let cached: { version: string; schema: GraphQLSchema; expires: number } | undefined;
/** Shop id → time before which that shop's token is not used for another load. */
const failedUntil = new Map<string, number>();
let loading: Promise<GraphQLSchema | null> | undefined;

/**
 * The Admin schema for `shopifyApiVersion`, built from the gateway's own introspection call with the
 * calling store's token, or null when none could be loaded (callers fail open).
 */
export async function adminSchema(
  shopify: ShopifyConnection,
  shop: { id: string; myshopifyDomain: string },
  logger?: SchemaLogger
): Promise<GraphQLSchema | null> {
  const version = shopifyApiVersion;
  const current = cached?.version === version ? cached : undefined;
  if (current && Date.now() < current.expires) return current.schema;
  if (Date.now() < (failedUntil.get(shop.id) ?? 0)) return current?.schema ?? null;
  loading ??= load(shopify, shop, version, current?.schema ?? null, logger).finally(() => {
    loading = undefined;
  });
  return loading;
}

export function resetSchemaCache(): void {
  cached = undefined;
  failedUntil.clear();
  loading = undefined;
}

async function load(
  shopify: ShopifyConnection,
  shop: { id: string; myshopifyDomain: string },
  version: string,
  previous: GraphQLSchema | null,
  logger?: SchemaLogger
): Promise<GraphQLSchema | null> {
  const unavailable = (reason: string) => {
    logger?.warn({ version, reason, stale: previous !== null }, "admin schema unavailable");
    failedUntil.set(shop.id, Date.now() + COOL_DOWN_MS);
    return previous;
  };

  try {
    const started = Date.now();
    const result = await runAdminGraphql(shopify, shop, { query: INTROSPECTION }, FETCH_TIMEOUT_MS);
    const fetchMs = Date.now() - started;
    if (!result.ok) return unavailable(result.message);
    if (result.body.errors) return unavailable("introspection returned errors");
    const data = result.body.data as IntrospectionQuery | undefined;
    if (!data?.__schema) return unavailable("introspection returned no __schema");

    const buildStarted = Date.now();
    const schema = buildClientSchema(data);
    const buildMs = Date.now() - buildStarted;
    const rssMb = Math.round(process.memoryUsage().rss / 1e6);
    cached = { version, schema, expires: Date.now() + TTL_MS };
    failedUntil.clear();
    logger?.info(
      { version, types: Object.keys(schema.getTypeMap()).length, buildMs, fetchMs, rssMb },
      "admin schema loaded"
    );
    return schema;
  } catch (error) {
    return unavailable(error instanceof Error ? error.name : "unknown");
  }
}
