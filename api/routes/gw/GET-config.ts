import { RouteHandler } from "gadget-server";
import {
  corsOptions,
  issuer,
  mcpCommand,
  resourceUrl,
  scopesSupported,
  shopifyAppUrl,
  shopifyRedirectUrl,
  shopifyScopes,
  webClientId,
  webRedirectUri,
} from "../../lib/config";

/** Public sign-in settings for the admin page, and the values a client app in the Shopify Dev Dashboard needs. */
const route: RouteHandler = async ({ reply }) => {
  await reply.send({
    issuer,
    clientId: webClientId,
    resource: resourceUrl,
    redirectUri: webRedirectUri,
    scopes: scopesSupported,
    mcpCommand,
    shopifyApp: { appUrl: shopifyAppUrl, oauthCallbackUrl: shopifyRedirectUrl, scopes: shopifyScopes },
  });
};

route.options = { cors: corsOptions };

export default route;
