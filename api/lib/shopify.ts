import type { connections } from "gadget-server";
import { resultCapChars, shopifyApiVersion, shopifyTimeoutMs, truncatedPreviewChars } from "./config";

type ShopifyConnection = typeof connections.shopify;

export interface AdminGraphqlRequest {
  query: string;
  variables?: Record<string, unknown>;
}

export type QueryCost = { [key in "requestedQueryCost" | "actualQueryCost"]?: number };

interface AdminGraphqlBody {
  data?: unknown;
  errors?: unknown;
  extensions?: { cost?: { requestedQueryCost?: unknown; actualQueryCost?: unknown } & Record<string, unknown> };
}

export type AdminGraphqlResult =
  | { ok: true; status: number; body: AdminGraphqlBody }
  | { ok: false; status: number | null; message: string };

const TOKEN_INVALID = "store token invalid — reinstall the app";
const UNAVAILABLE = "Shopify rate-limited/unavailable, retry";

class ShopifyCallFailed extends Error {}

/** Calls the Admin GraphQL API with the shop's offline token, keeping Shopify's `errors` and `extensions.cost` intact. */
export async function runAdminGraphql(
  shopify: ShopifyConnection,
  shop: { id: string; myshopifyDomain: string },
  request: AdminGraphqlRequest
): Promise<AdminGraphqlResult> {
  try {
    let token = await accessToken(shopify, shop.id);
    let response = await post(shop.myshopifyDomain, token, request);
    if (response.status === 401) {
      token = await accessToken(shopify, shop.id, token);
      response = await post(shop.myshopifyDomain, token, request);
    }

    const { status } = response;
    if (status === 401 || status === 403) return { ok: false, status, message: TOKEN_INVALID };
    if (status === 429 || status >= 500) return { ok: false, status, message: UNAVAILABLE };
    try {
      return { ok: true, status, body: (await response.json()) as AdminGraphqlBody };
    } catch {
      return { ok: false, status, message: `Shopify answered HTTP ${status} without a JSON body` };
    }
  } catch (error) {
    if (error instanceof ShopifyCallFailed) return { ok: false, status: null, message: error.message };
    throw error;
  }
}

async function accessToken(shopify: ShopifyConnection, shopId: string, rejectedToken?: string): Promise<string> {
  try {
    return (await shopify.getAccessToken({ shopId, rejectedToken })).accessToken;
  } catch {
    throw new ShopifyCallFailed(TOKEN_INVALID);
  }
}

async function post(domain: string, token: string, request: AdminGraphqlRequest): Promise<Response> {
  try {
    return await fetch(`https://${domain}/admin/api/${shopifyApiVersion}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: request.query, variables: request.variables ?? {} }),
      signal: AbortSignal.timeout(shopifyTimeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new ShopifyCallFailed(timedOut ? `Shopify did not answer within ${shopifyTimeoutMs / 1000} s, retry` : UNAVAILABLE);
  }
}

export function queryCost(body: AdminGraphqlBody): QueryCost | null {
  const cost = body.extensions?.cost;
  if (!cost) return null;
  const result: QueryCost = {};
  if (typeof cost.requestedQueryCost === "number") result.requestedQueryCost = cost.requestedQueryCost;
  if (typeof cost.actualQueryCost === "number") result.actualQueryCost = cost.actualQueryCost;
  return result;
}

/** Tool result text for a Shopify body; over the cap, a truncation notice with a short `data` preview instead of cut JSON. */
export function formatResult(body: AdminGraphqlBody): string {
  const text = JSON.stringify({ data: body.data ?? null, errors: body.errors, cost: body.extensions?.cost });
  if (text.length <= resultCapChars) return text;
  return JSON.stringify({
    truncated: true,
    bytes: Buffer.byteLength(text),
    hint: "narrow the query: fewer fields, smaller first:, or filter",
    preview: JSON.stringify(body.data ?? null).slice(0, truncatedPreviewChars),
  });
}
