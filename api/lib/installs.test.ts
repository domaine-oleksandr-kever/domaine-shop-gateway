import { describe, expect, it, vi } from "vitest";
import { probeShop } from "./installs";

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
