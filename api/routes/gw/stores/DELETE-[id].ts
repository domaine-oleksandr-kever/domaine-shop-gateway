import { gwRoute, requireGlobalAdmin } from "../../../lib/gw";
import { removeStore } from "../../../lib/stores";

export default gwRoute<{ Params: { id: string } }>(async ({ api, connections, logger, request }, user) => {
  requireGlobalAdmin(user);
  await removeStore(api, connections.shopify, logger, user, request.params.id);
});
