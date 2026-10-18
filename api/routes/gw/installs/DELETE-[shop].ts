import { gwRoute } from "../../../lib/gw";
import { HttpError } from "../../../lib/httpError";
import { dismissInstall } from "../../../lib/installs";
import { normalizeShopDomain } from "../../../lib/validate";

export default gwRoute<{ Params: { shop: string } }>(async ({ api, logger, request }, user) => {
  const shopDomain = normalizeShopDomain(request.params.shop);
  if (!shopDomain) throw new HttpError(400, "shop must be a store handle or <handle>.myshopify.com");
  await dismissInstall(api, logger, user, shopDomain);
});
