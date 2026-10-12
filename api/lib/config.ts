const DEFAULT_BASE_URL = "https://domaine-shop-gateway--development.gadget.app";
const DEFAULT_ISSUER = "https://meaningful-pink-49-staging.authkit.app";

function gadgetBaseUrl(): string | undefined {
  const { GADGET_APP: app, GADGET_ENV: env } = process.env;
  if (!app || !env) return undefined;
  return env === "production" ? `https://${app}.gadget.app` : `https://${app}--${env}.gadget.app`;
}

const baseUrl = (gadgetBaseUrl() ?? process.env.GATEWAY_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

export const issuer = (process.env.WORKOS_ISSUER ?? DEFAULT_ISSUER).replace(/\/+$/, "");
export const jwksUrl = `${issuer}/oauth2/jwks`;
export const resourceUrl = `${baseUrl}/mcp`;
export const metadataUrl = `${baseUrl}/oauth-protected-resource`;
export const scopesSupported = ["openid", "profile", "email", "offline_access"];

export const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "Mcp-Protocol-Version"],
  exposedHeaders: ["WWW-Authenticate"],
};
