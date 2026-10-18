import { parseAppInput, registerApp } from "../../lib/apps";
import { gwRoute, requireGlobalAdmin } from "../../lib/gw";

export default gwRoute<{ Body: unknown }>(async ({ api, logger, request, connections }, user) => {
  requireGlobalAdmin(user);
  return registerApp(api, logger, user, parseAppInput(request.body, connections.shopify.apiKeys));
});
