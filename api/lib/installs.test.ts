import { describe, expect, it, vi } from "vitest";
import type { GatewayUser } from "./identity";
import { dismissInstall, pendingInstallView, probeShop, reserveInstall, resolveClientId, shopInstallUrl } from "./installs";

type Api = Parameters<typeof reserveInstall>[0];
type Logger = Parameters<typeof reserveInstall>[1];

const answering = (status: number) => vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;

describe("probeShop", () => {
  it("asks the storefront root without following redirects", async () => {
    const fetchImpl = answering(302);
    await probeShop("example-dev.myshopify.com", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example-dev.myshopify.com/",
      expect.objectContaining({ method: "HEAD", redirect: "manual" })
    );
  });

  it("treats a redirect or a page as an existing shop", async () => {
    expect(await probeShop("a.myshopify.com", answering(302))).toBe("exists");
    expect(await probeShop("a.myshopify.com", answering(200))).toBe("exists");
    expect(await probeShop("a.myshopify.com", answering(503))).toBe("exists");
  });

  it("reports a 404 as a missing shop", async () => {
    expect(await probeShop("no-such-store.myshopify.com", answering(404))).toBe("missing");
  });

  it("reports a network failure as unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await probeShop("a.myshopify.com", fetchImpl)).toBe("unreachable");
  });

  it("gives up after the timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))
    ) as unknown as typeof fetch;
    expect(await probeShop("a.myshopify.com", fetchImpl, 10)).toBe("timeout");
  });
});

describe("shopInstallUrl", () => {
  it("builds the install link for the given app", () => {
    expect(shopInstallUrl("a.myshopify.com", "key 1")).toBe("https://a.myshopify.com/admin/oauth/install?client_id=key%201");
  });
});

describe("resolveClientId", () => {
  const keys = ["main", "client"];

  it("accepts a requested client id only when Gadget knows it", () => {
    expect(resolveClientId(keys, "main", "client")).toBe("client");
    expect(resolveClientId(keys, "main", "other")).toBeNull();
  });

  it("falls back to the default when Gadget knows it, else to the only app", () => {
    expect(resolveClientId(keys, "main")).toBe("main");
    expect(resolveClientId(keys, "gone")).toBeNull();
    expect(resolveClientId(["only"], "gone")).toBe("only");
  });

  it("uses the only app when no default is configured", () => {
    expect(resolveClientId(["only"])).toBe("only");
    expect(resolveClientId(keys)).toBeNull();
    expect(resolveClientId([])).toBeNull();
  });
});

const now = new Date("2026-10-18T12:00:00Z");
const minutes = (count: number) => new Date(now.getTime() + count * 60_000);
const logger = { error: vi.fn() } as unknown as Logger;
const user = (fields: Partial<GatewayUser> = {}): GatewayUser => ({
  id: "u1",
  sub: "user_1",
  email: "jane@meetdomaine.com",
  name: null,
  globalRole: "none",
  lastSeenAt: null,
  ...fields,
});

function fakeApi(pending: { id: string; userId: string; expiresAt: Date } | null) {
  return {
    shopifyShop: { maybeFindFirst: vi.fn(async () => null) },
    pendingInstall: {
      maybeFindFirst: vi.fn(async () => pending),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    audit: { create: vi.fn(async () => ({})) },
  };
}

describe("pendingInstallView", () => {
  const row = { shopDomain: "a.myshopify.com", expiresAt: minutes(5), user: { email: "jane@meetdomaine.com" } };

  it("marks a reservation expired once its window has closed", () => {
    expect(pendingInstallView(row, now, false)).toEqual({ shop: "a.myshopify.com", expiresAt: minutes(5).toISOString(), expired: false });
    expect(pendingInstallView(row, minutes(5), false).expired).toBe(true);
    expect(pendingInstallView({ ...row, expiresAt: null }, now, false).expired).toBe(true);
  });

  it("names the user and the app only in the admin view", () => {
    expect(pendingInstallView({ ...row, clientId: "key-1" }, now, true)).toMatchObject({ userEmail: "jane@meetdomaine.com", clientId: "key-1" });
    expect(pendingInstallView({ ...row, user: null }, now, true)).toMatchObject({ userEmail: null, clientId: null });
    expect(pendingInstallView({ ...row, clientId: "key-1" }, now, false)).not.toHaveProperty("userEmail");
    expect(pendingInstallView({ ...row, clientId: "key-1" }, now, false)).not.toHaveProperty("clientId");
  });
});

describe("reserveInstall", () => {
  it("takes over another user's expired reservation", async () => {
    const api = fakeApi({ id: "p1", userId: "u2", expiresAt: minutes(-1) });
    expect(await reserveInstall(api as unknown as Api, logger, user(), "a.myshopify.com", "key-1", now)).toBe("reserved");
    expect(api.pendingInstall.update).toHaveBeenCalledWith("p1", { user: { _link: "u1" }, expiresAt: minutes(15), clientId: "key-1" });
    expect(api.pendingInstall.create).not.toHaveBeenCalled();
  });

  it("reuses the caller's own expired reservation", async () => {
    const api = fakeApi({ id: "p1", userId: "u1", expiresAt: minutes(-30) });
    expect(await reserveInstall(api as unknown as Api, logger, user(), "a.myshopify.com", "key-1", now)).toBe("reserved");
    expect(api.pendingInstall.update).toHaveBeenCalledWith("p1", { user: { _link: "u1" }, expiresAt: minutes(15), clientId: "key-1" });
  });

  it("refuses while another user's reservation is active", async () => {
    const api = fakeApi({ id: "p1", userId: "u2", expiresAt: minutes(1) });
    expect(await reserveInstall(api as unknown as Api, logger, user(), "a.myshopify.com", "key-1", now)).toBe("conflict");
    expect(api.pendingInstall.update).not.toHaveBeenCalled();
  });
});

describe("dismissInstall", () => {
  it("lets the owner remove the reservation and audits it", async () => {
    const api = fakeApi({ id: "p1", userId: "u1", expiresAt: minutes(-1) });
    await dismissInstall(api as unknown as Api, logger, user(), "a.myshopify.com", now);
    expect(api.pendingInstall.delete).toHaveBeenCalledWith("p1");
    expect(api.audit.create).toHaveBeenCalledWith(expect.objectContaining({ operationType: "install-dismissed" }));
  });

  it("lets a global admin remove someone else's reservation", async () => {
    const api = fakeApi({ id: "p1", userId: "u2", expiresAt: minutes(-1) });
    await dismissInstall(api as unknown as Api, logger, user({ globalRole: "admin" }), "a.myshopify.com", now);
    expect(api.pendingInstall.delete).toHaveBeenCalledWith("p1");
  });

  it("answers 404 to anyone else and for a missing reservation", async () => {
    const other = fakeApi({ id: "p1", userId: "u2", expiresAt: minutes(-1) });
    await expect(dismissInstall(other as unknown as Api, logger, user(), "a.myshopify.com", now)).rejects.toMatchObject({ status: 404 });
    expect(other.pendingInstall.delete).not.toHaveBeenCalled();
    await expect(dismissInstall(fakeApi(null) as unknown as Api, logger, user(), "a.myshopify.com")).rejects.toMatchObject({ status: 404 });
  });

  it("answers 404 when the reservation was claimed before the delete", async () => {
    const api = fakeApi({ id: "p1", userId: "u1", expiresAt: minutes(-1) });
    api.pendingInstall.delete.mockRejectedValueOnce(new Error("Record Not Found Error: Gadget API returned no data at deletePendingInstall"));
    await expect(dismissInstall(api as unknown as Api, logger, user(), "a.myshopify.com", now)).rejects.toMatchObject({ status: 404 });
    expect(api.audit.create).not.toHaveBeenCalled();
  });

  it("refuses an active reservation, even for a global admin", async () => {
    const api = fakeApi({ id: "p1", userId: "u2", expiresAt: minutes(5) });
    await expect(dismissInstall(api as unknown as Api, logger, user({ globalRole: "admin" }), "a.myshopify.com", now)).rejects.toMatchObject({ status: 409 });
    expect(api.pendingInstall.delete).not.toHaveBeenCalled();
  });
});
