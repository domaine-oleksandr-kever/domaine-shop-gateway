import type { api as gadgetApi, logger as gadgetLogger } from "gadget-server";
import { recordAdminEvent } from "./audit";
import { HttpError } from "./httpError";
import type { GatewayUser } from "./identity";
import type { StoreEnv, StoreRole } from "./policy";
import { probeInstalled } from "./installState";
import { accessRolesByShop, storeGrants } from "./roles";
import { gatewayDefaults } from "./shopDefaults";
import type { ShopifyConnection } from "./shopify";

type Api = typeof gadgetApi;
type Logger = typeof gadgetLogger;

const PAGE = 250;

export interface StoreView {
  id: string;
  alias: string;
  domain: string;
  env: StoreEnv;
  enabled: boolean;
  role: StoreRole;
  installedAt: Date;
  /** False for a shop in state uninstalled: a global admin sees every such shop, other users those they hold an access row on. */
  installed: boolean;
}

/** The user's stores plus uninstalled shops, which `storeGrants` never returns: all of them for a global admin, else by access row. */
export async function listStores(api: Api, user: GatewayUser): Promise<StoreView[]> {
  const rows: StoreView[] = (await storeGrants(api, user)).map(({ shop, role }) => ({
    id: shop.id,
    alias: shop.alias,
    domain: shop.myshopifyDomain,
    env: shop.env,
    enabled: shop.enabled,
    role,
    installedAt: shop.installedAt,
    installed: true,
  }));
  const roles = user.globalRole === "admin" ? null : await accessRolesByShop(api, user);
  const candidates = roles && [...roles.keys()].filter((id) => !rows.some((row) => row.id === id));
  if (candidates?.length === 0) return rows;
  const uninstalled = await api.shopifyShop.findMany({
    filter: { state: { inState: "created.uninstalled" }, ...(candidates && { id: { in: candidates } }) },
    select: { id: true, alias: true, myshopifyDomain: true, env: true, enabled: true, createdAt: true },
    first: PAGE,
  });
  return [
    ...rows,
    ...uninstalled.map((record) => ({
      id: record.id,
      alias: record.alias ?? gatewayDefaults(record).alias ?? record.id,
      domain: record.myshopifyDomain ?? "",
      env: record.env ?? "dev",
      enabled: record.enabled ?? false,
      role: roles?.get(record.id) ?? ("store-admin" as const),
      installedAt: record.createdAt,
      installed: false,
    })),
  ];
}

async function findUninstalled(api: Api, id: string) {
  const shop = await api.shopifyShop.maybeFindFirst({
    filter: { id: { equals: id }, state: { inState: "created.uninstalled" } },
    select: { id: true, myshopifyDomain: true },
  });
  if (shop) return shop;
  const other = await api.shopifyShop.maybeFindFirst({ filter: { id: { equals: id } }, select: { myshopifyDomain: true } });
  if (!other) throw new HttpError(404, "store not found");
  throw new HttpError(
    409,
    `the app is still installed in ${other.myshopifyDomain ?? id}: uninstall it in the store's Apps settings, then press Delete again (Shopify tells the gateway, usually within a few minutes)`
  );
}

/**
 * Deletes an uninstalled shop record with its access rows, invites and expired install reservation; 404 for an unknown id,
 * 409 while the app is still installed (by record state or by a live check with the stored token) or a reinstall reservation
 * is active. The record goes first, so a reinstall that lands later creates a fresh record and leftover rows point at a dead
 * id; orphan access/invite rows are harmless (store lookups only map existing shop records).
 */
export async function removeStore(
  api: Api,
  shopify: ShopifyConnection,
  logger: Logger,
  user: GatewayUser,
  id: string,
  now = new Date()
): Promise<void> {
  const shop = await findUninstalled(api, id);
  // A late app/uninstalled webhook can mark a reinstalled shop uninstalled.
  const probe = await probeInstalled(shopify, { id: shop.id, myshopifyDomain: shop.myshopifyDomain ?? "" });
  if (probe.state === "installed") {
    throw new HttpError(
      409,
      `the app is still installed in Shopify on ${shop.myshopifyDomain ?? shop.id}, so the gateway record is stale: open the app there to resync it, or uninstall it in the store's Apps settings and press Delete again`
    );
  }
  // The probe can take seconds: a reinstall or a new reservation may have landed meanwhile.
  await findUninstalled(api, id);
  const domain = shop.myshopifyDomain?.toLowerCase();
  const pending = domain
    ? await api.pendingInstall.maybeFindFirst({ filter: { shopDomain: { equals: domain } }, select: { id: true, expiresAt: true } })
    : null;
  if (pending && (pending.expiresAt?.getTime() ?? 0) > now.getTime()) throw new HttpError(409, "install is still in progress");

  await api.internal.shopifyShop.delete(shop.id);
  const [access, invites] = await Promise.all([
    api.access.findMany({ filter: { shopId: { equals: shop.id } }, select: { id: true }, first: PAGE }),
    api.invite.findMany({ filter: { shopId: { equals: shop.id } }, select: { id: true }, first: PAGE }),
  ]);
  for (const row of access) await api.access.delete(row.id);
  for (const row of invites) await api.invite.delete(row.id);
  if (pending) await api.pendingInstall.delete(pending.id);
  await recordAdminEvent(api, logger, {
    userId: user.id,
    shopId: null,
    operationType: "store-removed",
    reason: `store ${domain ?? shop.id} deleted`,
  });
}
