import type { StoreRole } from "./policy";

const STORE_ROLES: ReadonlySet<string> = new Set(["read", "dev", "store-admin"]);
const HANDLE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ALIAS = /^[a-z0-9-]{2,40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Turns a handle, a myshopify domain, a shop URL or an admin.shopify.com/store/<handle> URL into `<handle>.myshopify.com`. */
export function normalizeShopDomain(input: string): string | null {
  const text = input.trim().toLowerCase();
  const adminStore = text.match(/admin\.shopify\.com\/store\/([^/?#]+)/)?.[1];
  const host = adminStore ?? text.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  const handle = host.endsWith(".myshopify.com") ? host.slice(0, -".myshopify.com".length) : host;
  return HANDLE.test(handle) ? `${handle}.myshopify.com` : null;
}

export function isValidAlias(alias: string): boolean {
  return ALIAS.test(alias);
}

export function parseStoreRole(role: unknown): StoreRole | null {
  return typeof role === "string" && STORE_ROLES.has(role) ? (role as StoreRole) : null;
}

/** Lower-cased email when it is well formed and its domain is on the allow-list, else null. */
export function normalizeMemberEmail(email: string, allowedDomains: readonly string[]): string | null {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL.test(normalized)) return null;
  return allowedDomains.includes(normalized.split("@").pop() ?? "") ? normalized : null;
}
