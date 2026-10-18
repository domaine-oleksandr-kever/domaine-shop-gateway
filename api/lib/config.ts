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

export const webRedirectUri = `${baseUrl}/auth/callback`;
/**
 * The admin page's OAuth `client_id`: the URL of its Client ID Metadata Document. AuthKit's OAuth endpoints refuse the
 * environment client id (`application_not_found`) but accept this document, so no client is registered in WorkOS.
 */
export const webClientId = `${baseUrl}/gw/oauth-client`;
export const mcpCommand = `claude mcp add --transport http --scope user domaine-shop-gateway ${resourceUrl}`;

export const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "Mcp-Protocol-Version"],
  exposedHeaders: ["WWW-Authenticate"],
};

function listFromEnv(name: string, fallback: string): string[] {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const userinfoUrl = `${issuer}/oauth2/userinfo`;
export const allowedEmailDomains = listFromEnv("GATEWAY_ALLOWED_DOMAINS", "meetdomaine.com").map((domain) =>
  domain.toLowerCase()
);
/** Individual addresses allowed in besides the domains (a personal account used for testing). */
export const allowedEmails = listFromEnv("GATEWAY_ALLOWED_EMAILS", "").map((email) => email.toLowerCase());
export const adminSubs = listFromEnv("GATEWAY_ADMIN_SUBS", "");

export function isEmailAllowed(email: string): boolean {
  const lower = email.toLowerCase();
  return allowedEmails.includes(lower) || allowedEmailDomains.includes(lower.split("@").pop() ?? "");
}

/** Client id of the main (dev-store) Shopify app, used when an install names no app; must match `client_id` in shopify.app.toml (a test checks it). */
export const defaultShopifyClientId = process.env.GATEWAY_DEFAULT_CLIENT_ID || "b73a7f59b61391d5901163e77050f8c8";
/** What a client app in the Shopify Dev Dashboard needs so Gadget's Shopify connection handles its installs. */
export const shopifyAppUrl = `${baseUrl}/api/shopify/install-or-render`;
export const shopifyRedirectUrl = `${baseUrl}/api/connections/auth/shopify/callback`;
/** Must match `[access_scopes]` in shopify.app.toml (a test checks it). */
export const shopifyScopes = [
  "read_products",
  "write_products",
  "read_metaobjects",
  "write_metaobjects",
  "unauthenticated_read_metaobjects",
  "read_metaobject_definitions",
  "write_metaobject_definitions",
  "read_themes",
  "read_publications",
  "read_inventory",
  "read_inventory_shipments",
  "read_inventory_shipments_received_items",
  "read_inventory_transfers",
  "unauthenticated_read_product_inventory",
  "read_locations",
  "unauthenticated_read_product_pickup_locations",
  "read_markets",
  "read_markets_home",
];
export const shopifyApiVersion = "2026-10";
export const shopifyTimeoutMs = 25_000;
/** `GATEWAY_VALIDATE=0` skips the pre-send schema check. */
export const validateEnabled = process.env.GATEWAY_VALIDATE !== "0";
/** Largest tool result, in characters, returned inline; Claude Code spills text results over 50,000 to a file. */
export const resultCapChars = 45_000;
export const truncatedPreviewChars = 2_000;
