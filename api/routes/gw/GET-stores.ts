import { gwRoute } from "../../lib/gw";
import { storeGrants } from "../../lib/roles";

export default gwRoute(async ({ api }, user) =>
  (await storeGrants(api, user)).map(({ shop, role }) => ({
    id: shop.id,
    alias: shop.alias,
    domain: shop.myshopifyDomain,
    env: shop.env,
    enabled: shop.enabled,
    role,
    installedAt: shop.installedAt,
  }))
);
