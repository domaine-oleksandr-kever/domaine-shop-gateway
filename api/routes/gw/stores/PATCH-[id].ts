import { z } from "zod";
import { recordAdminEvent } from "../../../lib/audit";
import { gwRoute, requireGlobalAdmin, requireStore } from "../../../lib/gw";
import { HttpError } from "../../../lib/httpError";
import { isValidAlias } from "../../../lib/validate";

const Body = z.strictObject({
  alias: z.string().optional(),
  enabled: z.boolean().optional(),
  env: z.enum(["dev", "prod"]).optional(),
});

export default gwRoute<{ Params: { id: string }; Body: unknown }>(async ({ api, logger, request }, user) => {
  const parsed = Body.safeParse(request.body);
  if (!parsed.success) throw new HttpError(400, "body must be { alias?, enabled?, env? }");
  const { alias, enabled, env } = parsed.data;
  const { shop } = await requireStore(api, user, request.params.id, { storeAdmin: true });
  if (enabled !== undefined || env !== undefined) requireGlobalAdmin(user);

  const changes: { alias?: string; enabled?: boolean; env?: "dev" | "prod" } = {};
  if (alias !== undefined && alias !== shop.alias) {
    if (!isValidAlias(alias)) throw new HttpError(400, "alias must be 2-40 characters: a-z, 0-9 and -");
    const taken = await api.shopifyShop.maybeFindFirst({ filter: { alias: { equals: alias } }, select: { id: true } });
    if (taken) throw new HttpError(409, "alias already in use");
    changes.alias = alias;
  }
  if (enabled !== undefined && enabled !== shop.enabled) changes.enabled = enabled;
  if (env !== undefined && env !== shop.env) changes.env = env;
  if (Object.keys(changes).length === 0) return { changed: [] };

  await api.internal.shopifyShop.update(shop.id, changes);
  const described = Object.entries(changes).map(([field, value]) => `${field} ${String(shop[field as keyof typeof changes])} -> ${value}`);
  await recordAdminEvent(api, logger, {
    userId: user.id,
    shopId: shop.id,
    operationType: "store-updated",
    reason: described.join(", "),
  });
  return { changed: Object.keys(changes) };
});
