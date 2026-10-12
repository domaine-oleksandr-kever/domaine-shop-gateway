import type { api as gadgetApi, logger as gadgetLogger } from "gadget-server";
import { recordAdminEvent } from "./audit";
import type { GatewayUser } from "./identity";

type Api = typeof gadgetApi;
type Logger = typeof gadgetLogger;

const CLAIM_WINDOW_MS = 15 * 60 * 1000;
const PROBE_TIMEOUT_MS = 8000;

export type ShopProbe = "exists" | "missing" | "timeout" | "unreachable";
export type ReserveOutcome = "reserved" | "already-installed" | "conflict";

export const devDashboardUrl = "https://dev.shopify.com/dashboard";

/**
 * Shopify's install entry for one shop (the URL Shopify CLI opens); Shopify signs the user in, shows the scopes and
 * hands the shop to the app URL. Null when the environment has no single Shopify app to install.
 */
export function shopInstallUrl(shopDomain: string, apiKeys: readonly string[]): string | null {
  return apiKeys.length === 1 ? `https://${shopDomain}/admin/oauth/install?client_id=${encodeURIComponent(apiKeys[0])}` : null;
}

/**
 * Asks the storefront whether the shop exists: only a 404 means "missing"; a redirect (password page, login) or any
 * other answer means it exists. `timeout` and `unreachable` say nothing about the shop and must not block an install.
 */
export async function probeShop(shopDomain: string, fetchImpl: typeof fetch = fetch, timeoutMs = PROBE_TIMEOUT_MS): Promise<ShopProbe> {
  try {
    const response = await fetchImpl(`https://${shopDomain}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.status === 404 ? "missing" : "exists";
  } catch (error) {
    return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "unreachable";
  }
}

/** Reserves the shop for this user for 15 minutes so the install that follows makes them its store-admin. */
export async function reserveInstall(
  api: Api,
  logger: Logger,
  user: GatewayUser,
  shopDomain: string,
  now = new Date()
): Promise<ReserveOutcome> {
  const installed = await api.shopifyShop.maybeFindFirst({
    filter: { myshopifyDomain: { equals: shopDomain }, state: { inState: "created.installed" } },
    select: { id: true },
  });
  if (installed) return "already-installed";

  const pending = await api.pendingInstall.maybeFindFirst({
    filter: { shopDomain: { equals: shopDomain } },
    select: { id: true, userId: true, expiresAt: true },
  });
  if (pending && pending.userId !== user.id && (pending.expiresAt?.getTime() ?? 0) > now.getTime()) return "conflict";
  const fields = { user: { _link: user.id }, expiresAt: new Date(now.getTime() + CLAIM_WINDOW_MS) };
  if (pending) await api.pendingInstall.update(pending.id, fields);
  else await api.pendingInstall.create({ shopDomain, ...fields });
  await recordAdminEvent(api, logger, {
    userId: user.id,
    shopId: null,
    operationType: "install-requested",
    reason: `install started for ${shopDomain}`,
  });
  return "reserved";
}

/** Makes the user who reserved this shop its store-admin; an install nobody reserved is only audited. Never throws: a failed claim must not fail the Shopify install. */
export async function claimInstall(
  api: Api,
  logger: Logger,
  shop: { id: string; myshopifyDomain: string | null },
  now = new Date()
): Promise<void> {
  try {
    await claim(api, logger, shop, now);
  } catch (error) {
    logger.error({ reason: error instanceof Error ? error.name : "unknown" }, "install claim failed");
  }
}

async function claim(api: Api, logger: Logger, shop: { id: string; myshopifyDomain: string | null }, now: Date) {
  const pending = shop.myshopifyDomain
    ? await api.pendingInstall.maybeFindFirst({
        filter: { shopDomain: { equals: shop.myshopifyDomain.toLowerCase() } },
        select: { id: true, userId: true, expiresAt: true },
      })
    : null;
  if (pending) await api.pendingInstall.delete(pending.id);

  if (!pending?.userId || (pending.expiresAt?.getTime() ?? 0) <= now.getTime()) {
    await recordAdminEvent(api, logger, {
      userId: null,
      shopId: shop.id,
      operationType: "install-unclaimed",
      reason: pending ? "the install reservation had expired" : "no install reservation for this shop",
    });
    return;
  }

  const access = await api.access.maybeFindFirst({
    filter: { userId: { equals: pending.userId }, shopId: { equals: shop.id } },
    select: { id: true },
  });
  if (access) await api.access.update(access.id, { role: "store-admin" });
  else await api.access.create({ user: { _link: pending.userId }, shop: { _link: shop.id }, role: "store-admin" });
  await recordAdminEvent(api, logger, {
    userId: pending.userId,
    shopId: shop.id,
    operationType: "install-claimed",
    reason: "store-admin for the user who started the install",
  });
}
