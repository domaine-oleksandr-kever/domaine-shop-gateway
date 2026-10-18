import type { api as gadgetApi, logger as gadgetLogger } from "gadget-server";
import { recordAdminEvent } from "./audit";
import { HttpError } from "./httpError";
import type { GatewayUser } from "./identity";
import type { StoreEnv, StoreRole } from "./policy";
import { storeGrants } from "./roles";
import { gatewayDefaults } from "./shopDefaults";

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
  /** False for a shop in state uninstalled; only a global admin's list has such rows. */
  installed: boolean;
}

/** The user's stores; a global admin also gets the uninstalled shops, which `storeGrants` never returns. */
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
  if (user.globalRole !== "admin") return rows;
  const uninstalled = await api.shopifyShop.findMany({
    filter: { state: { inState: "created.uninstalled" } },
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
      role: "store-admin" as const,
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
    `the app is still installed in ${other.myshopifyDomain ?? id}: uninstall it in the store's Apps settings, then press Delete again (Shopify tells the gateway within a few seconds)`
  );
}

/**
 * Deletes an uninstalled shop record with its access rows, invites and expired install reservation; 404 for an unknown id,
 * 409 while the app is still installed or a reinstall reservation is active. The record goes first, so a reinstall that lands
 * later creates a fresh record and leftover rows point at a dead id; orphan access/invite rows are harmless (storeGrants only
 * maps installed shops).
 */
export async function removeStore(api: Api, logger: Logger, user: GatewayUser, id: string, now = new Date()): Promise<void> {
  const shop = await findUninstalled(api, id);
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
