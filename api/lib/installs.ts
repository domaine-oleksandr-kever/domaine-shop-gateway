import type { api as gadgetApi, logger as gadgetLogger } from "gadget-server";
import { recordAdminEvent } from "./audit";
import { HttpError } from "./httpError";
import type { GatewayUser } from "./identity";

type Api = typeof gadgetApi;
type Logger = typeof gadgetLogger;

const CLAIM_WINDOW_MS = 15 * 60 * 1000;
const PROBE_TIMEOUT_MS = 8000;
const PAGE = 250;

export type ShopProbe = "exists" | "missing" | "timeout" | "unreachable";
export type ReserveOutcome = "reserved" | "already-installed" | "conflict";

export interface PendingInstallView {
  shop: string;
  expiresAt: string;
  /** The window closed without the install reaching the gateway (a successful install deletes the reservation). */
  expired: boolean;
  /** Who started the install; only in a global admin's list. */
  userEmail?: string | null;
  /** Client id of the Shopify app the install link was built for; only in a global admin's list. */
  clientId?: string | null;
}

export const devDashboardUrl = "https://dev.shopify.com/dashboard";

/**
 * Shopify's install entry for one shop (the URL Shopify CLI opens); Shopify signs the user in, shows the scopes and
 * hands the shop to the app URL.
 */
export function shopInstallUrl(shopDomain: string, clientId: string): string {
  return `https://${shopDomain}/admin/oauth/install?client_id=${encodeURIComponent(clientId)}`;
}

/**
 * Which Shopify app to install: a requested client id only if Gadget knows it, else the default if Gadget knows it,
 * else the only app (an environment whose main app has another client id). Null when none applies.
 */
export function resolveClientId(apiKeys: readonly string[], defaultClientId?: string, requested?: string): string | null {
  if (requested) return apiKeys.includes(requested) ? requested : null;
  if (defaultClientId && apiKeys.includes(defaultClientId)) return defaultClientId;
  return apiKeys.length === 1 ? apiKeys[0] : null;
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

/**
 * Reserves the shop for this user for 15 minutes so the install that follows makes them its store-admin; `clientId` is
 * the app the install link is built for (null for the manual Dev Dashboard install).
 */
export async function reserveInstall(
  api: Api,
  logger: Logger,
  user: GatewayUser,
  shopDomain: string,
  clientId: string | null,
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
  const fields = { user: { _link: user.id }, expiresAt: new Date(now.getTime() + CLAIM_WINDOW_MS), clientId };
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

export function pendingInstallView(
  row: { shopDomain: string; expiresAt: Date | null; clientId?: string | null; user?: { email: string | null } | null },
  now: Date,
  adminView: boolean
): PendingInstallView {
  const expiresAt = row.expiresAt ?? new Date(0);
  const view: PendingInstallView = {
    shop: row.shopDomain,
    expiresAt: expiresAt.toISOString(),
    expired: expiresAt.getTime() <= now.getTime(),
  };
  if (adminView) {
    view.userEmail = row.user?.email ?? null;
    view.clientId = row.clientId ?? null;
  }
  return view;
}

/** The user's own reservations, active and expired; a global admin sees everyone's. */
export async function listPendingInstalls(api: Api, user: GatewayUser, now = new Date()): Promise<PendingInstallView[]> {
  const globalAdmin = user.globalRole === "admin";
  const rows = await api.pendingInstall.findMany({
    filter: globalAdmin ? undefined : { userId: { equals: user.id } },
    sort: { expiresAt: "Descending" },
    select: { shopDomain: true, expiresAt: true, clientId: true, user: { email: true } },
    first: PAGE,
  });
  return rows.map((row) => pendingInstallView(row, now, globalAdmin));
}

/**
 * Removes an expired reservation for its owner or a global admin; anyone else gets the same 404 as for a missing one
 * or one that was just claimed.
 * An active one is refused: it may have been taken over since the caller saw it expire.
 */
export async function dismissInstall(api: Api, logger: Logger, user: GatewayUser, shopDomain: string, now = new Date()): Promise<void> {
  const pending = await api.pendingInstall.maybeFindFirst({
    filter: { shopDomain: { equals: shopDomain } },
    select: { id: true, userId: true, expiresAt: true },
  });
  if (!pending || (pending.userId !== user.id && user.globalRole !== "admin")) throw new HttpError(404, "install reservation not found");
  if ((pending.expiresAt?.getTime() ?? 0) > now.getTime()) throw new HttpError(409, "install is still in progress");
  try {
    await api.pendingInstall.delete(pending.id);
  } catch (error) {
    // Gadget does not export its not-found error class, so match its code or message.
    const notFound = error instanceof Error && ((error as { code?: unknown }).code === "GGT_RECORD_NOT_FOUND" || /not found/i.test(error.message));
    if (notFound) throw new HttpError(404, "install reservation not found");
    throw error;
  }
  await recordAdminEvent(api, logger, {
    userId: user.id,
    shopId: null,
    operationType: "install-dismissed",
    reason: `install reservation for ${shopDomain} dismissed`,
  });
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
