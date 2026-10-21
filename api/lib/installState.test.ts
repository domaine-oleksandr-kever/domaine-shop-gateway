import { beforeEach, describe, expect, it, vi } from "vitest";
import { save } from "gadget-server";
import { run } from "../models/shopifyShop/actions/uninstall";
import { probeInstalled } from "./installState";
import { runAdminGraphql, TOKEN_INVALID, type ShopifyConnection } from "./shopify";

vi.mock("gadget-server", () => ({ applyParams: vi.fn(), save: vi.fn() }));
vi.mock("gadget-server/shopify", () => ({ preventCrossShopDataAccess: vi.fn() }));
vi.mock("./shopify", async (original) => ({
  ...(await original<typeof import("./shopify")>()),
  runAdminGraphql: vi.fn(),
}));

const shopify = {} as ShopifyConnection;
const shop = { id: "s1", myshopifyDomain: "acme.myshopify.com" };
const installed = { ok: true, status: 200, body: { data: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } } } } as const;
const revoked = { ok: false, status: 401, message: TOKEN_INVALID } as const;
const unavailable = { ok: false, status: 503, message: "Shopify rate-limited/unavailable, retry" } as const;

beforeEach(() => {
  vi.mocked(runAdminGraphql).mockReset();
  vi.mocked(save).mockReset();
});

describe("probeInstalled", () => {
  it("asks for the current app installation with a short timeout", async () => {
    vi.mocked(runAdminGraphql).mockResolvedValue(installed);
    expect(await probeInstalled(shopify, shop)).toEqual({ state: "installed" });
    expect(runAdminGraphql).toHaveBeenCalledWith(shopify, shop, { query: "{ currentAppInstallation { id } }" }, 5_000);
  });

  it("reads a rejected or missing token as uninstalled", async () => {
    vi.mocked(runAdminGraphql).mockResolvedValueOnce(revoked).mockResolvedValueOnce({ ok: false, status: null, message: TOKEN_INVALID });
    expect(await probeInstalled(shopify, shop)).toEqual({ state: "uninstalled" });
    expect(await probeInstalled(shopify, shop)).toEqual({ state: "uninstalled" });
  });

  it("reports outages and timeouts as unknown with the reason", async () => {
    vi.mocked(runAdminGraphql).mockResolvedValue(unavailable);
    expect(await probeInstalled(shopify, shop)).toEqual({ state: "unknown", reason: unavailable.message });
  });

  it("does not read a non-200 JSON answer, such as 402 for a closed shop, as installed", async () => {
    vi.mocked(runAdminGraphql).mockResolvedValue({ ok: true, status: 402, body: { errors: "Unavailable Shop" } });
    expect(await probeInstalled(shopify, shop)).toEqual({ state: "unknown", reason: "Shopify answered HTTP 402" });
  });
});

describe("uninstall action", () => {
  function context() {
    return {
      params: {},
      record: { id: "s1", myshopifyDomain: "acme.myshopify.com", alias: "acme", env: "prod", enabled: true },
      connections: { shopify },
      trigger: { type: "shopify_webhook", topic: "app/uninstalled", retries: 0 },
      logger: { warn: vi.fn(), error: vi.fn() },
      api: { audit: { create: vi.fn() } },
    };
  }

  it("ignores a stale webhook while Shopify still accepts the token: no save, a warning and an audit row", async () => {
    vi.mocked(runAdminGraphql).mockResolvedValue(installed);
    const ctx = context();
    await run(ctx as never);
    expect(save).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      { shopId: "s1", trigger: "shopify_webhook", retries: 0 },
      "stale app/uninstalled ignored: app still installed"
    );
    expect(ctx.api.audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: undefined, shop: { _link: "s1" }, tool: "admin", operationType: "uninstall-ignored" })
    );
  });

  it("uninstalls when the token is revoked", async () => {
    vi.mocked(runAdminGraphql).mockResolvedValue(revoked);
    const ctx = context();
    await run(ctx as never);
    expect(save).toHaveBeenCalledWith(ctx.record);
    expect(ctx.logger.warn).not.toHaveBeenCalled();
    expect(ctx.api.audit.create).not.toHaveBeenCalled();
  });

  it("uninstalls when Shopify cannot answer, logging why", async () => {
    vi.mocked(runAdminGraphql).mockResolvedValue(unavailable);
    const ctx = context();
    await run(ctx as never);
    expect(save).toHaveBeenCalledWith(ctx.record);
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: unavailable.message }), expect.any(String));
  });
});
