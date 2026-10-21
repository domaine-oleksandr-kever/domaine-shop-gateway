import { runAdminGraphql, TOKEN_INVALID, type ShopifyConnection } from "./shopify";

export type InstallProbe = { state: "installed" | "uninstalled" } | { state: "unknown"; reason: string };

const PROBE_TIMEOUT_MS = 5_000;

/**
 * Asks Shopify with the shop's stored token whether the app is installed right now: HTTP 200 (even with GraphQL errors)
 * means installed, a revoked or missing token means uninstalled, and anything else (rate limits, outages, timeouts,
 * 402 for a frozen or closed shop) is `unknown`.
 */
export async function probeInstalled(
  shopify: ShopifyConnection,
  shop: { id: string; myshopifyDomain: string }
): Promise<InstallProbe> {
  const result = await runAdminGraphql(shopify, shop, { query: "{ currentAppInstallation { id } }" }, PROBE_TIMEOUT_MS);
  if (result.ok) return result.status === 200 ? { state: "installed" } : { state: "unknown", reason: `Shopify answered HTTP ${result.status}` };
  if (result.message === TOKEN_INVALID) return { state: "uninstalled" };
  return { state: "unknown", reason: result.message };
}
