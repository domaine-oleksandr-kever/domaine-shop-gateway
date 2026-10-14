import { buildSchema, parse } from "graphql";
import { describe, expect, it } from "vitest";
import { validateDocument } from "./graphql-validate";

const schema = buildSchema(`
  interface Node { id: ID! }
  type Product implements Node { id: ID! title: String! handle: String @deprecated(reason: "use title") }
  type Collection implements Node { id: ID! name: String! }
  union SearchResult = Product | Collection
  input ProductInput { id: ID! title: String }
  type Query {
    product(id: ID!): Product
    node(id: ID!): Node
    search(term: String!): [SearchResult!]!
  }
  type Mutation { productUpdate(product: ProductInput!): Product }
`);

const check = (source: string, variables?: Record<string, unknown>) =>
  validateDocument(schema, parse(source), variables);

describe("validateDocument", () => {
  it("passes a valid query with no warnings", () => {
    expect(check(`{ product(id: "1") { id title } }`)).toEqual({ errors: [], warnings: [] });
  });

  it("reports an unknown field with its line and column", () => {
    const { errors } = check(`query {\n  product(id: "1") {\n    price\n  }\n}`);
    expect(errors).toEqual([{ message: expect.stringContaining('"price"'), line: 3, column: 5 }]);
  });

  it("reports a missing required argument", () => {
    const { errors } = check(`{ product { id } }`);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('argument "id"');
  });

  it("reports a variable of the wrong type", () => {
    const { errors } = check(`query ($term: String!) { search(term: $term) { __typename } }`, { term: 5 });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("$term");
    expect(errors[0].line).toBeUndefined();
  });

  it("reports a missing required variable", () => {
    const { errors } = check(`mutation ($product: ProductInput!) { productUpdate(product: $product) { id } }`, {});
    expect(errors).toEqual([{ message: expect.stringContaining("$product") }]);
  });

  it("checks fields inside an input object variable", () => {
    const { errors } = check(`mutation ($product: ProductInput!) { productUpdate(product: $product) { id } }`, {
      product: { title: "x" },
    });
    expect(errors[0].message).toContain("id");
  });

  it("treats a deprecated field as a warning only", () => {
    const result = check(`{ product(id: "1") { handle } }`);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([{ message: expect.stringContaining("deprecated"), line: 1, column: 22 }]);
  });

  it("accepts fragments on union members and refuses a spread on an unrelated type", () => {
    const fragments = `fragment P on Product { title } fragment C on Collection { name }`;
    expect(check(`{ search(term: "a") { ...P ...C } } ${fragments}`).errors).toEqual([]);
    const { errors } = check(`{ product(id: "1") { ...C } } fragment C on Collection { name }`);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('"C"');
  });

  it("coerces variables for the first operation", () => {
    const source = `query A($id: ID!) { product(id: $id) { id } } query B($term: String!) { search(term: $term) { __typename } }`;
    expect(check(source, { id: "1" }).errors).toEqual([]);
    expect(check(source, { term: "a" }).errors).toEqual([{ message: expect.stringContaining("$id") }]);
  });

  it("ignores variables when none are given", () => {
    expect(check(`query ($id: ID!) { product(id: $id) { id } }`).errors).toEqual([]);
  });

  it("answers a document with no operation", () => {
    expect(check(`fragment P on Product { title }`)).toEqual({ errors: [{ message: "no operation" }], warnings: [] });
  });
});
