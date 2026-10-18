export type StoreRole = "read" | "dev" | "store-admin";
export type StoreEnv = "dev" | "prod";

export interface GatewayConfig {
  issuer: string;
  clientId: string;
  resource: string;
  redirectUri: string;
  scopes: string[];
  mcpCommand: string;
  /** What to enter for a client app in the Shopify Dev Dashboard. */
  shopifyApp: { devDashboardUrl: string; appUrl: string; oauthCallbackUrl: string; scopes: string[] };
}

export interface Me {
  sub: string;
  email: string | null;
  name: string | null;
  globalRole: "none" | "admin";
}

export interface Store {
  id: string;
  alias: string;
  domain: string;
  env: StoreEnv;
  enabled: boolean;
  role: StoreRole;
  installedAt: string;
}

export interface Member {
  userId: string;
  email: string | null;
  name: string | null;
  role: StoreRole;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: StoreRole;
}

export interface AuditRow {
  createdAt: string;
  userEmail: string | null;
  tool: string;
  operationType: string | null;
  operationName: string | null;
  allowed: boolean | null;
  reason: string | null;
  durationMs: number | null;
  cost: unknown;
}

export type InstallStart =
  | { shop: string; installUrl: string }
  | { shop: string; manual: true; devDashboardUrl: string; instructions: string };

export interface PendingInstallRow {
  shop: string;
  expiresAt: string;
  expired: boolean;
  /** Only in a global admin's list. */
  userEmail?: string | null;
  /** The Shopify app the install link was built for; only in a global admin's list. */
  clientId?: string | null;
}

export interface ShopApp {
  id: string;
  clientId: string;
  label: string;
  registeredInGadget: boolean;
  storeDomains: string[];
}
