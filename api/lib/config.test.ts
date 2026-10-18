import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultShopifyClientId, shopifyScopes } from "./config";

describe("shopify.app.toml", () => {
  const toml = readFileSync(join(__dirname, "../../shopify.app.toml"), "utf8");

  it("holds the default client id", () => {
    expect(defaultShopifyClientId).toBe(/^client_id = "([^"]*)"/m.exec(toml)?.[1]);
  });

  it("matches the scopes", () => {
    const scopes = /^scopes = "([^"]*)"/m.exec(toml)?.[1].split(",").map((scope) => scope.trim());
    expect(shopifyScopes).toEqual(scopes);
  });
});
