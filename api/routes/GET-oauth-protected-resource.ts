import { RouteHandler } from "gadget-server";
import { issuer, resourceUrl, scopesSupported } from "../lib/config";

const protectedResourceMetadata = {
  resource: resourceUrl,
  authorization_servers: [issuer],
  bearer_methods_supported: ["header"],
  scopes_supported: scopesSupported,
};

const route: RouteHandler = async ({ reply }) => {
  await reply
    .header("Content-Type", "application/json")
    .header("Cache-Control", "public, max-age=300")
    .send(protectedResourceMetadata);
};

route.options = { cors: { origin: "*" } };

export default route;
