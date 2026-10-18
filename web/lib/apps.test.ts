import { describe, expect, it } from "vitest";
import { filterApps } from "./apps";
import type { ShopApp } from "./types";

const app = (id: string, label: string, clientId: string, storeDomains: string[] = []): ShopApp => ({
  id,
  label,
  clientId,
  registeredInGadget: true,
  storeDomains,
});

const apps = [app("1", "gateway-Acme", "abc123", ["acme.myshopify.com"]), app("2", "gateway-Globex", "def456")];

describe("filterApps", () => {
  it("keeps every app for an empty query", () => {
    expect(filterApps(apps, "  ")).toEqual(apps);
  });

  it("matches label, client id and store domain, ignoring case", () => {
    expect(filterApps(apps, "acme").map((a) => a.id)).toEqual(["1"]);
    expect(filterApps(apps, "DEF4").map((a) => a.id)).toEqual(["2"]);
    expect(filterApps(apps, "acme.myshopify").map((a) => a.id)).toEqual(["1"]);
  });

  it("needs every word to match", () => {
    expect(filterApps(apps, "gateway acme").map((a) => a.id)).toEqual(["1"]);
    expect(filterApps(apps, "globex acme")).toEqual([]);
  });
});
