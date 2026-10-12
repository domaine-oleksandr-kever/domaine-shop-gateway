import { RouteHandler } from "gadget-server";
import { corsOptions, issuer, mcpCommand, resourceUrl, scopesSupported, webClientId, webRedirectUri } from "../../lib/config";

/** Public sign-in settings for the admin page. */
const route: RouteHandler = async ({ reply }) => {
  await reply.send({
    issuer,
    clientId: webClientId,
    resource: resourceUrl,
    redirectUri: webRedirectUri,
    scopes: scopesSupported,
    mcpCommand,
  });
};

route.options = { cors: corsOptions };

export default route;
