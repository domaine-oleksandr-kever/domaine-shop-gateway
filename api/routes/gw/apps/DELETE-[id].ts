import { removeApp } from "../../../lib/apps";
import { gwRoute, requireGlobalAdmin } from "../../../lib/gw";

export default gwRoute<{ Params: { id: string } }>(async ({ api, logger, request }, user) => {
  requireGlobalAdmin(user);
  await removeApp(api, logger, user, request.params.id);
});
