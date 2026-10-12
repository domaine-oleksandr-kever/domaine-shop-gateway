import { gwRoute, requireStore } from "../../../../lib/gw";
import { listMembers } from "../../../../lib/members";

export default gwRoute<{ Params: { id: string } }>(async ({ api, request }, user) => {
  const { shop } = await requireStore(api, user, request.params.id, { storeAdmin: true });
  return listMembers(api, shop.id);
});
