import { describe, expect, it } from "vitest";
import { checkVariables, evaluateQuery } from "./policy";

const PRODUCTS = "query Products { products(first: 5) { nodes { id title } } }";
const SET_METAFIELD =
  "mutation Set($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { message } } }";

function refusal(source: string, role: "read" | "dev" | "store-admin" = "dev", env: "dev" | "prod" = "dev") {
  const decision = evaluateQuery(source, role, env);
  if (decision.allowed) throw new Error("expected a refusal");
  return decision.reason;
}

describe("evaluateQuery", () => {
  it("refuses a parse error without echoing query text", () => {
    const reason = refusal('query { products(query: "secret-value" { id } }');
    expect(reason).toMatch(/^parse error at 1:\d+/);
    expect(reason).not.toContain("secret-value");
  });

  it("refuses two operations", () => {
    expect(refusal(`${PRODUCTS} mutation B { productUpdate(product: {}) { product { id } } }`)).toBe(
      "exactly one operation per request"
    );
  });

  it("refuses type system definitions", () => {
    expect(refusal("type Foo { id: ID }")).toBe("only operations and fragments are allowed");
  });

  it("refuses a subscription", () => {
    expect(refusal("subscription S { products { id } }")).toBe("subscriptions are not allowed");
  });

  it("refuses introspection, also behind a fragment", () => {
    expect(refusal("{ __schema { types { name } } }", "read", "prod")).toBe("introspection (__schema) is not allowed");
    expect(refusal("query { ...F } fragment F on QueryRoot { __type(name: \"Shop\") { name } }")).toBe(
      "introspection (__type) is not allowed"
    );
  });

  it("allows a query for every role on prod and returns the reprinted document", () => {
    for (const role of ["read", "dev", "store-admin"] as const) {
      const decision = evaluateQuery(PRODUCTS, role, "prod");
      expect(decision).toMatchObject({ allowed: true, operationType: "query", operationName: "Products" });
    }
    const decision = evaluateQuery("{shop{name}}", "read", "prod");
    expect(decision).toMatchObject({ allowed: true, operationName: null, query: "{\n  shop {\n    name\n  }\n}" });
  });

  it("refuses every mutation on prod", () => {
    expect(refusal(SET_METAFIELD, "store-admin", "prod")).toBe("prod is read-only");
  });

  it("refuses a mutation on dev for the read role", () => {
    expect(refusal(SET_METAFIELD, "read", "dev")).toBe("role read cannot run mutations");
  });

  it("refuses a mutation on dev when any root field is off the allow-list", () => {
    expect(
      refusal("mutation { metafieldsSet(metafields: []) { userErrors { message } } productDelete(input: {id: \"1\"}) { deletedProductId } }")
    ).toBe("mutation productDelete is not on the dev allow-list");
    expect(refusal("mutation { ... on Mutation { themePublish(id: \"1\") { theme { id } } } }")).toBe(
      "mutation themePublish is not on the dev allow-list"
    );
  });

  it("allows an allow-listed mutation on dev for dev and store-admin", () => {
    for (const role of ["dev", "store-admin"] as const) {
      expect(evaluateQuery(SET_METAFIELD, role, "dev")).toMatchObject({
        allowed: true,
        operationType: "mutation",
        operationName: "Set",
      });
    }
  });

  it("allows used fragments and refuses unused or unknown ones", () => {
    const used = "query { products(first: 1) { nodes { ...P } } } fragment P on Product { id ...T } fragment T on Product { title }";
    const decision = evaluateQuery(used, "read", "prod");
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.query).toContain("fragment T on Product");

    expect(refusal(`${PRODUCTS} fragment Extra on Product { id }`)).toBe("unused fragment Extra");
    expect(refusal("query { products(first: 1) { nodes { ...Missing } } }")).toBe("unknown fragment Missing");
    expect(refusal("query { ...A } fragment A on QueryRoot { shop { name } } fragment A on QueryRoot { shop { id } }")).toBe(
      "fragment names must be unique"
    );
  });

  it("does not loop on cyclic fragments", () => {
    const cyclic = "query { shop { ...A } } fragment A on Shop { name ...B } fragment B on Shop { id ...A }";
    expect(evaluateQuery(cyclic, "read", "prod").allowed).toBe(true);
  });
});

describe("checkVariables", () => {
  it("accepts a missing value or a plain object", () => {
    expect(checkVariables(undefined)).toBeNull();
    expect(checkVariables({ id: "gid://shopify/Product/1" })).toBeNull();
  });

  it("refuses arrays, primitives and oversized objects", () => {
    expect(checkVariables([1])).toBe("variables must be a plain object");
    expect(checkVariables("x")).toBe("variables must be a plain object");
    expect(checkVariables({ big: "x".repeat(17_000) })).toBe("variables exceed 16 KB");
  });
});
