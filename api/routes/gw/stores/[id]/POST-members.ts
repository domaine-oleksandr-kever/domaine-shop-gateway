import { z } from "zod";
import { allowedEmailDomains, isEmailAllowed } from "../../../../lib/config";
import { gwRoute, requireStore } from "../../../../lib/gw";
import { HttpError } from "../../../../lib/httpError";
import { addMember } from "../../../../lib/members";
import { normalizeMemberEmail } from "../../../../lib/validate";

const Body = z.strictObject({ email: z.string(), role: z.enum(["read", "dev", "store-admin"]) });

export default gwRoute<{ Params: { id: string }; Body: unknown }>(async ({ api, logger, request }, user) => {
  const parsed = Body.safeParse(request.body);
  if (!parsed.success) throw new HttpError(400, "body must be { email, role: read | dev | store-admin }");
  const email = normalizeMemberEmail(parsed.data.email, isEmailAllowed);
  if (!email) throw new HttpError(400, `email must be a valid address at ${allowedEmailDomains.join(" or ")}`);
  const { shop } = await requireStore(api, user, request.params.id, { storeAdmin: true });
  return addMember(api, logger, user, shop.id, email, parsed.data.role);
});
