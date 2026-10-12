import type { StoreEnv } from "./policy";

const DEV_PLAN_NAMES: ReadonlySet<string> = new Set([
  "partner_test",
  "development",
  "affiliate",
  "staff",
  "staff_business",
  "plus_partner_sandbox",
  "open_learning",
]);
const DEV_PLAN_DISPLAY = /\b(development|developer|partner test|sandbox)\b/i;

export interface ShopPlanFields {
  myshopifyDomain?: string | null;
  planName?: string | null;
  planDisplayName?: string | null;
}

export interface ShopGatewayDefaults {
  env: StoreEnv;
  enabled: boolean;
  alias: string | null;
}

/** Development and sandbox plans are `dev`; anything else, including an unknown plan, is `prod`. */
export function envForPlan(shop: ShopPlanFields): StoreEnv {
  const planName = shop.planName?.toLowerCase() ?? "";
  if (DEV_PLAN_NAMES.has(planName)) return "dev";
  return DEV_PLAN_DISPLAY.test(shop.planDisplayName ?? "") ? "dev" : "prod";
}

/** Gateway fields for a shop row that has no `env` yet: dev stores start enabled, prod stores wait for an admin. */
export function gatewayDefaults(shop: ShopPlanFields): ShopGatewayDefaults {
  const env = envForPlan(shop);
  return {
    env,
    enabled: env === "dev",
    alias: shop.myshopifyDomain?.replace(/\.myshopify\.com$/i, "").toLowerCase() || null,
  };
}

/** The gateway-owned fields of a shop row, to restore after `applyParams` in actions a Shopify session may call. */
export function gatewayFields(record: { alias: string | null; env: StoreEnv | null; enabled: boolean | null }) {
  return { alias: record.alias, env: record.env, enabled: record.enabled };
}
