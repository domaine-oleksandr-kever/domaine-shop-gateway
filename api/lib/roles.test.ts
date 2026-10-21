import { describe, expect, it, vi } from "vitest";
import type { GatewayUser } from "./identity";
import { storeGrants } from "./roles";

type Api = Parameters<typeof storeGrants>[0];

const admin: GatewayUser = { id: "u1", sub: "user_1", email: "jane@meetdomaine.com", name: null, globalRole: "admin", lastSeenAt: null };
const createdAt = new Date("2026-10-01T00:00:00Z");

describe("storeGrants", () => {
  it("reads only installed shops and grants exactly those", async () => {
    const installed = { id: "s1", alias: "acme", myshopifyDomain: "acme.myshopify.com", env: "dev", enabled: true, planName: null, planDisplayName: null, createdAt };
    const api = {
      shopifyShop: { findMany: vi.fn(async () => [installed]) },
      access: { findMany: vi.fn(async () => []) },
      internal: { shopifyShop: { update: vi.fn() } },
    };

    const grants = await storeGrants(api as unknown as Api, admin);

    expect(api.shopifyShop.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { state: { inState: "created.installed" } } })
    );
    expect(grants).toEqual([
      { shop: { id: "s1", alias: "acme", myshopifyDomain: "acme.myshopify.com", env: "dev", enabled: true, installedAt: createdAt }, role: "store-admin" },
    ]);
  });
});
