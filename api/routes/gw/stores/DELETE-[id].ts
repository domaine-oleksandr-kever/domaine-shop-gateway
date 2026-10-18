import { gwRoute, requireGlobalAdmin } from "../../../lib/gw";
import { removeStore } from "../../../lib/stores";

export default gwRoute<{ Params: { id: string } }>(async ({ api, logger, request }, user) => {
  requireGlobalAdmin(user);
  await removeStore(api, logger, user, request.params.id);
});
