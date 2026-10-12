import { gwRoute, requireStore } from "../../../../../lib/gw";
import { removeMember } from "../../../../../lib/members";

export default gwRoute<{ Params: { id: string; userId: string } }>(async ({ api, logger, request }, user) => {
  const { shop } = await requireStore(api, user, request.params.id, { storeAdmin: true });
  await removeMember(api, logger, user, shop.id, request.params.userId);
});
