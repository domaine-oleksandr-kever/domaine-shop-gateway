import { gwRoute, requireStore } from "../../../../../lib/gw";
import { removeInvite } from "../../../../../lib/members";

export default gwRoute<{ Params: { id: string; inviteId: string } }>(async ({ api, logger, request }, user) => {
  const { shop } = await requireStore(api, user, request.params.id, { storeAdmin: true });
  await removeInvite(api, logger, user, shop.id, request.params.inviteId);
});
