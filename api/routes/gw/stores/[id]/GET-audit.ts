import { gwRoute, requireStore } from "../../../../lib/gw";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export default gwRoute<{ Params: { id: string }; Querystring: { limit?: string } }>(async ({ api, request }, user) => {
  const { shop } = await requireStore(api, user, request.params.id, { storeAdmin: true });
  const requested = Number.parseInt(request.query.limit ?? "", 10);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT;
  const rows = await api.audit.findMany({
    filter: { shopId: { equals: shop.id } },
    sort: { createdAt: "Descending" },
    first: limit,
    select: {
      createdAt: true,
      tool: true,
      operationType: true,
      operationName: true,
      allowed: true,
      reason: true,
      durationMs: true,
      cost: true,
      user: { email: true },
    },
  });
  return rows.map(({ user: actor, ...row }) => ({ ...row, userEmail: actor?.email ?? null }));
});
