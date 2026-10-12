import type { api as gadgetApi } from "gadget-server";
import type { GatewayUser } from "./identity";
import type { StoreEnv, StoreRole } from "./policy";
import { gatewayDefaults } from "./shopDefaults";

type Api = typeof gadgetApi;

export interface GatewayShop {
  id: string;
  alias: string;
  myshopifyDomain: string;
  env: StoreEnv;
  enabled: boolean;
}

export interface StoreGrant {
  shop: GatewayShop;
  role: StoreRole;
}

const SHOP_SELECT = {
  id: true,
  alias: true,
  myshopifyDomain: true,
  env: true,
  enabled: true,
  planName: true,
  planDisplayName: true,
} as const;
const PAGE = 250;

/** Global admin is store-admin everywhere; otherwise the access row decides; a user without a known email has no store roles. */
export function effectiveRole(user: GatewayUser, accessRole: StoreRole | undefined): StoreRole | null {
  if (user.globalRole === "admin") return "store-admin";
  if (!user.email) return null;
  return accessRole ?? null;
}

/** Installed shops the user holds a role on, with gateway fields filled in for rows that predate them. */
export async function storeGrants(api: Api, user: GatewayUser): Promise<StoreGrant[]> {
  const [shops, accessRoles] = await Promise.all([installedShops(api), accessRolesByShop(api, user)]);
  return shops.flatMap((shop) => {
    const role = effectiveRole(user, accessRoles.get(shop.id));
    return role ? [{ shop, role }] : [];
  });
}

export function findGrant(grants: StoreGrant[], selector: { alias?: string; shopId?: string }): StoreGrant | undefined {
  const alias = selector.alias?.trim().toLowerCase();
  return grants.find((grant) =>
    alias ? grant.shop.alias === alias || grant.shop.myshopifyDomain === alias : grant.shop.id === selector.shopId
  );
}

async function installedShops(api: Api): Promise<GatewayShop[]> {
  const records = await api.shopifyShop.findMany({
    filter: { state: { inState: "created.installed" } },
    select: SHOP_SELECT,
    first: PAGE,
  });
  return Promise.all(records.map((record) => withGatewayFields(api, record)));
}

async function withGatewayFields(
  api: Api,
  record: {
    id: string;
    alias: string | null;
    myshopifyDomain: string | null;
    env: StoreEnv | null;
    enabled: boolean | null;
    planName: string | null;
    planDisplayName: string | null;
  }
): Promise<GatewayShop> {
  const myshopifyDomain = record.myshopifyDomain ?? "";
  if (record.env && record.alias) {
    return { id: record.id, alias: record.alias, myshopifyDomain, env: record.env, enabled: record.enabled ?? false };
  }
  const defaults = gatewayDefaults(record);
  const fields = {
    env: record.env ?? defaults.env,
    enabled: record.env ? (record.enabled ?? false) : defaults.enabled,
    alias: record.alias ?? defaults.alias ?? record.id,
  };
  await api.internal.shopifyShop.update(record.id, fields);
  return { id: record.id, myshopifyDomain, ...fields };
}

async function accessRolesByShop(api: Api, user: GatewayUser): Promise<Map<string, StoreRole>> {
  if (user.globalRole === "admin" || !user.email) return new Map();
  const rows = await api.access.findMany({
    filter: { userId: { equals: user.id } },
    select: { role: true, shopId: true },
    first: PAGE,
  });
  return new Map(rows.flatMap((row) => (row.shopId && row.role ? [[row.shopId, row.role as StoreRole]] : [])));
}
