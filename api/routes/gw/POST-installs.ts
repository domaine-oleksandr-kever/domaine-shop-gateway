import { z } from "zod";
import { gwRoute } from "../../lib/gw";
import { HttpError } from "../../lib/httpError";
import { devDashboardUrl, reserveInstall, shopInstallUrl } from "../../lib/installs";
import { normalizeShopDomain } from "../../lib/validate";

const Body = z.strictObject({ shop: z.string() });

export default gwRoute<{ Body: unknown }>(async ({ api, logger, request, connections }, user) => {
  if (!user.email) throw new HttpError(403, "your email is not known yet: sign out and sign in again");
  const parsed = Body.safeParse(request.body);
  const shopDomain = parsed.success ? normalizeShopDomain(parsed.data.shop) : null;
  if (!shopDomain) throw new HttpError(400, "shop must be a store handle or <handle>.myshopify.com");

  await reserveInstall(api, logger, user, shopDomain);
  const installUrl = shopInstallUrl(shopDomain, connections.shopify.apiKeys);
  if (installUrl) return { shop: shopDomain, installUrl };
  return {
    shop: shopDomain,
    manual: true,
    devDashboardUrl,
    instructions: `Open the Shopify Dev Dashboard, choose the domaine-shop-gateway app, select "Install app" and pick ${shopDomain}. Finish within 15 minutes so the store is assigned to you.`,
  };
});
