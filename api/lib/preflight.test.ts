import { buildSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { invalidDocument, preflight, resultExtras } from "./preflight";

const schema = buildSchema(`
  type Product { id: ID! title: String! handle: String @deprecated(reason: "use title") }
  input ProductInput { id: ID! title: String }
  type Query { product(id: ID!): Product }
  type Mutation { productUpdate(product: ProductInput!): Product }
`);

describe("preflight", () => {
  it("passes a valid document with no extras", () => {
    const result = preflight(schema, `{ product(id: "1") { id title } }`);
    expect(result).toEqual({ validated: true, errors: [], warnings: [] });
    expect(resultExtras(result)).toEqual({});
  });

  it("refuses an invalid document with at most three problems and line:column", () => {
    const result = preflight(schema, `{\n  product(id: "1") { a b c d }\n}`);
    expect(result.errors).toHaveLength(4);
    const text = invalidDocument(result.errors);
    expect(text).toBe(
      'invalid document: Cannot query field "a" on type "Product". (2:22); ' +
        'Cannot query field "b" on type "Product". (2:24); Cannot query field "c" on type "Product". (2:26)'
    );
  });

  it("reports a problem without a location by message only", () => {
    expect(invalidDocument([{ message: "bad variable" }, { message: "x", line: 1, column: 2 }])).toBe(
      "invalid document: bad variable; x (1:2)"
    );
  });

  it("checks variables, and a missing required variable when none are given", () => {
    const mutation = `mutation M($product: ProductInput!) { productUpdate(product: $product) { id } }`;
    expect(preflight(schema, mutation, { product: { id: "1" } }).errors).toEqual([]);
    expect(preflight(schema, mutation, { product: { title: "x" } }).errors).toHaveLength(1);
    expect(preflight(schema, mutation).errors).toHaveLength(1);
  });

  it("carries a deprecation as a warning, never an error", () => {
    const result = preflight(schema, `{ product(id: "1") { handle } }`);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(resultExtras(result)).toEqual({ warnings: result.warnings });
  });

  it("passes unvalidated when the schema is unavailable or validation is off", () => {
    const result = preflight(null, `{ nonsense }`);
    expect(result).toEqual({ validated: false, errors: [], warnings: [] });
    expect(resultExtras(result)).toEqual({ validated: false });
  });
});
