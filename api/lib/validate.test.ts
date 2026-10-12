import { describe, expect, it } from "vitest";
import { isValidAlias, normalizeMemberEmail, normalizeShopDomain, parseStoreRole } from "./validate";

describe("normalizeShopDomain", () => {
  it.each([
    ["kever-b2b", "kever-b2b.myshopify.com"],
    ["  Kever-B2B.myshopify.com ", "kever-b2b.myshopify.com"],
    ["https://kever-b2b.myshopify.com/admin/products", "kever-b2b.myshopify.com"],
    ["https://admin.shopify.com/store/kever-b2b/apps", "kever-b2b.myshopify.com"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeShopDomain(input)).toBe(expected);
  });

  it.each(["", "shop.example.com", "-bad", "a b", "evil.com/x.myshopify.com", "x.myshopify.com.evil.com"])(
    "rejects %j",
    (input) => {
      expect(normalizeShopDomain(input)).toBeNull();
    }
  );
});

describe("isValidAlias", () => {
  it("accepts lower-case letters, digits and dashes, 2 to 40 long", () => {
    expect(isValidAlias("kever-b2b")).toBe(true);
    expect(isValidAlias("a".repeat(40))).toBe(true);
  });

  it.each(["a", "a".repeat(41), "Kever", "kever_b2b", "kever b2b", ""])("rejects %j", (alias) => {
    expect(isValidAlias(alias)).toBe(false);
  });
});

describe("parseStoreRole", () => {
  it("accepts the three store roles only", () => {
    expect(parseStoreRole("read")).toBe("read");
    expect(parseStoreRole("store-admin")).toBe("store-admin");
    expect(parseStoreRole("admin")).toBeNull();
    expect(parseStoreRole(1)).toBeNull();
  });
});

describe("normalizeMemberEmail", () => {
  const allowed = (email: string) => email.endsWith("@meetdomaine.com") || email === "guest@example.org";

  it("lower-cases an allowed email", () => {
    expect(normalizeMemberEmail(" Jane.Doe@MeetDomaine.com ", allowed)).toBe("jane.doe@meetdomaine.com");
  });

  it("accepts an individually allowed address", () => {
    expect(normalizeMemberEmail("Guest@Example.org", allowed)).toBe("guest@example.org");
  });

  it.each(["jane@example.com", "jane@meetdomaine.com.evil.io", "not-an-email", "a b@meetdomaine.com"])(
    "rejects %j",
    (email) => {
      expect(normalizeMemberEmail(email, allowed)).toBeNull();
    }
  );
});
