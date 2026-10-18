import { describe, expect, it, vi } from "vitest";
import { HttpError } from "./httpError";
import type { GatewayUser } from "./identity";
import { listStores, removeStore } from "./stores";

type Api = Parameters<typeof removeStore>[0];
type Logger = Parameters<typeof removeStore>[1];

const logger = { error: vi.fn() } as unknown as Logger;
const user = (fields: Partial<GatewayUser> = {}): GatewayUser => ({
  id: "u1",
  sub: "user_1",
  email: "jane@meetdomaine.com",
  name: null,
  globalRole: "admin",
  lastSeenAt: null,
  ...fields,
});
const createdAt = new Date("2026-10-01T00:00:00Z");

type Filter = { id?: { equals: string }; state?: { inState: string } };

function listingApi() {
  const installed = { id: "s1", alias: "acme", myshopifyDomain: "acme.myshopify.com", env: "prod", enabled: true, planName: null, planDisplayName: null, createdAt };
  const uninstalled = [
    { id: "s2", alias: "old", myshopifyDomain: "old.myshopify.com", env: "prod", enabled: true, createdAt },
    { id: "s3", alias: null, myshopifyDomain: "Bare-Shop.myshopify.com", env: null, enabled: null, createdAt },
  ];
  return {
    shopifyShop: {
      findMany: vi.fn(async ({ filter }: { filter: Filter }) => (filter.state?.inState === "created.installed" ? [installed] : uninstalled)),
    },
    access: { findMany: vi.fn(async () => [{ shopId: "s1", role: "dev" }]) },
    internal: { shopifyShop: { update: vi.fn() } },
  };
}

describe("listStores", () => {
  it("appends uninstalled shops for a global admin, with handle and dev as fallbacks", async () => {
    const api = listingApi();
    const rows = await listStores(api as unknown as Api, user());
    expect(rows.map(({ id, alias, env, role, installed }) => ({ id, alias, env, role, installed }))).toEqual([
      { id: "s1", alias: "acme", env: "prod", role: "store-admin", installed: true },
      { id: "s2", alias: "old", env: "prod", role: "store-admin", installed: false },
      { id: "s3", alias: "bare-shop", env: "dev", role: "store-admin", installed: false },
    ]);
    expect(rows[2]).toMatchObject({ domain: "Bare-Shop.myshopify.com", enabled: false, installedAt: createdAt });
    expect(api.internal.shopifyShop.update).not.toHaveBeenCalled();
  });

  it("shows other users only their installed stores", async () => {
    const api = listingApi();
    const rows = await listStores(api as unknown as Api, user({ globalRole: "none" }));
    expect(rows).toEqual([
      { id: "s1", alias: "acme", domain: "acme.myshopify.com", env: "prod", enabled: true, role: "dev", installedAt: createdAt, installed: true },
    ]);
    expect(api.shopifyShop.findMany).toHaveBeenCalledTimes(1);
  });
});

const now = new Date("2026-10-18T12:00:00Z");
const expired = new Date("2026-10-18T11:00:00Z");

function removalApi(
  shop: { id: string; myshopifyDomain: string | null; state: "installed" | "uninstalled" } | null,
  pendingExpiresAt: Date | null = expired
) {
  const calls: string[] = [];
  const api = {
    shopifyShop: {
      maybeFindFirst: vi.fn(async ({ filter }: { filter: Filter }) => {
        if (!shop || shop.id !== filter.id?.equals) return null;
        if (filter.state && filter.state.inState !== `created.${shop.state}`) return null;
        return { id: shop.id, myshopifyDomain: shop.myshopifyDomain };
      }),
    },
    access: {
      findMany: vi.fn(async () => [{ id: "a1" }, { id: "a2" }]),
      delete: vi.fn(async (id: string) => void calls.push(`access ${id}`)),
    },
    invite: {
      findMany: vi.fn(async () => [{ id: "i1" }]),
      delete: vi.fn(async (id: string) => void calls.push(`invite ${id}`)),
    },
    pendingInstall: {
      maybeFindFirst: vi.fn(async () => (pendingExpiresAt ? { id: "p1", expiresAt: pendingExpiresAt } : null)),
      delete: vi.fn(async (id: string) => void calls.push(`pending ${id}`)),
    },
    internal: { shopifyShop: { delete: vi.fn(async (id: string) => void calls.push(`shop ${id}`)) } },
    audit: { create: vi.fn(async () => void calls.push("audit")) },
  };
  return { api, calls };
}

async function refusal(run: Promise<unknown>): Promise<HttpError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof HttpError) return error;
  }
  throw new Error("expected an HttpError");
}

describe("removeStore", () => {
  it("answers 404 for an unknown shop", async () => {
    const { api, calls } = removalApi(null);
    const error = await refusal(removeStore(api as unknown as Api, logger, user(), "s9", now));
    expect([error.status, error.message]).toEqual([404, "store not found"]);
    expect(calls).toEqual([]);
  });

  it("answers 409 while the app is still installed and deletes nothing", async () => {
    const { api, calls } = removalApi({ id: "s1", myshopifyDomain: "acme.myshopify.com", state: "installed" });
    const error = await refusal(removeStore(api as unknown as Api, logger, user(), "s1", now));
    expect(error.status).toBe(409);
    expect(error.message).toContain("the app is still installed in acme.myshopify.com");
    expect(calls).toEqual([]);
  });

  it("answers 409 while a reinstall reservation is active and deletes nothing", async () => {
    const { api, calls } = removalApi({ id: "s1", myshopifyDomain: "acme.myshopify.com", state: "uninstalled" }, new Date("2026-10-18T12:10:00Z"));
    const error = await refusal(removeStore(api as unknown as Api, logger, user(), "s1", now));
    expect([error.status, error.message]).toEqual([409, "install is still in progress"]);
    expect(calls).toEqual([]);
  });

  it("deletes the shop first, then its access rows, invites and an expired reservation, then audits", async () => {
    const { api, calls } = removalApi({ id: "s1", myshopifyDomain: "Acme.myshopify.com", state: "uninstalled" });
    await removeStore(api as unknown as Api, logger, user(), "s1", now);
    expect(calls).toEqual(["shop s1", "access a1", "access a2", "invite i1", "pending p1", "audit"]);
    expect(api.access.findMany).toHaveBeenCalledWith(expect.objectContaining({ filter: { shopId: { equals: "s1" } } }));
    expect(api.pendingInstall.maybeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { shopDomain: { equals: "acme.myshopify.com" } } })
    );
    expect(api.audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ shop: undefined, operationType: "store-removed", reason: "store acme.myshopify.com deleted" })
    );
  });
});
