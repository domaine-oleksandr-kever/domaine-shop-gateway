import { z } from "zod";
import { gwRoute, requireGlobalAdmin } from "../../lib/gw";
import { defaultShopifyClientId } from "../../lib/config";
import { HttpError } from "../../lib/httpError";
import { devDashboardUrl, probeShop, reserveInstall, resolveClientId, shopInstallUrl } from "../../lib/installs";
import { normalizeShopDomain } from "../../lib/validate";

const Body = z.strictObject({ shop: z.string(), clientId: z.string().trim().min(1).optional() });

const REFUSALS: Record<string, [number, string]> = {
  "exists-404": [404, "store not found: check the handle"],
  "already-installed": [409, "this store is already connected: ask its store-admin for access"],
  conflict: [409, "someone else is installing this store: try again in 15 minutes"],
};

export default gwRoute<{ Body: unknown }>(async ({ api, logger, request, connections }, user) => {
  if (!user.email) throw new HttpError(403, "your email is not known yet: sign out and sign in again");
  const parsed = Body.safeParse(request.body);
  const shopDomain = parsed.success ? normalizeShopDomain(parsed.data.shop) : null;
  if (!shopDomain) throw new HttpError(400, "shop must be a store handle or <handle>.myshopify.com");
  const requested = parsed.data?.clientId;
  if (requested !== undefined) requireGlobalAdmin(user);
  const clientId = resolveClientId(connections.shopify.apiKeys, defaultShopifyClientId, requested);
  if (requested && !clientId) throw new HttpError(400, "unknown app client id: add the app in Gadget first");

  const started = Date.now();
  const probe = await probeShop(shopDomain);
  const outcome = probe === "missing" ? "exists-404" : await reserveInstall(api, logger, user, shopDomain, clientId);
  logger.info({ shop: shopDomain, outcome, probe, durationMs: Date.now() - started }, "install request");
  if (outcome !== "reserved") throw new HttpError(...REFUSALS[outcome]);

  if (clientId) return { shop: shopDomain, installUrl: shopInstallUrl(shopDomain, clientId) };
  return {
    shop: shopDomain,
    manual: true,
    devDashboardUrl,
    instructions: `Open the Shopify Dev Dashboard, choose the domaine-shop-gateway app, select "Install app" and pick ${shopDomain}. Finish within 15 minutes so the store is assigned to you.`,
  };
});
