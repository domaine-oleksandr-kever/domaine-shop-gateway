import { RouteHandler } from "gadget-server";
import { webClientId, webRedirectUri } from "../../lib/config";

/** OAuth Client ID Metadata Document for the admin page: a public client that may only redirect to its own callback. */
const clientMetadata = {
  client_id: webClientId,
  client_name: "Domaine Shop Gateway admin",
  redirect_uris: [webRedirectUri],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};

const route: RouteHandler = async ({ reply }) => {
  await reply.header("Cache-Control", "public, max-age=300").send(clientMetadata);
};

route.options = { cors: { origin: "*" } };

export default route;
