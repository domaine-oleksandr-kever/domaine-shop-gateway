import { listApps } from "../../lib/apps";
import { gwRoute, requireGlobalAdmin } from "../../lib/gw";

export default gwRoute(async ({ api, connections }, user) => {
  requireGlobalAdmin(user);
  return listApps(api, connections.shopify.apiKeys);
});
