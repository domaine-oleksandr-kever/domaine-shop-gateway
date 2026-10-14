import { buildSchema, graphqlSync, parse, validate } from "graphql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preflight } from "./preflight";
import { adminSchema, resetSchemaCache } from "./schema";
import type { ShopifyConnection } from "./shopify";

const live = buildSchema(`
  type Product { id: ID! title: String! }
  input ProductInput { id: ID, title: String, handle: String @deprecated(reason: "use title") }
  type Query { product(id: ID!): Product }
  type Mutation {
    productUpdate(input: ProductInput @deprecated(reason: "use product"), product: ProductInput): Product
  }
`);
const shop = { id: "1", myshopifyDomain: "test.myshopify.com" };
const other = { id: "2", myshopifyDomain: "other.myshopify.com" };
const shopify = { getAccessToken: async () => ({ accessToken: "token" }) } as unknown as ShopifyConnection;
const logger = () => ({ info: vi.fn(), warn: vi.fn() });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const answering = (body: () => unknown, status = 200) => vi.fn(async () => json(body(), status));
/** Answers the gateway's own introspection text by running it against `live`, as Shopify would. */
const introspecting = () =>
  vi.fn(async (_url: string, init: RequestInit) =>
    json(graphqlSync({ schema: live, source: JSON.parse(init.body as string).query }))
  );
const failing = () => json({}, 503);

let now = 0;
beforeEach(() => {
  resetSchemaCache();
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("adminSchema", () => {
  it("builds a usable schema from the introspection result and logs one load line", async () => {
    const fetch = introspecting();
    vi.stubGlobal("fetch", fetch);
    const log = logger();

    const schema = await adminSchema(shopify, shop, log);

    expect(schema).not.toBeNull();
    expect(validate(schema!, parse("{ product(id: 1) { title } }"))).toEqual([]);
    expect(validate(schema!, parse("{ product(id: 1) { nope } }"))).toHaveLength(1);
    expect(log.info).toHaveBeenCalledTimes(1);
    const [fields, message] = log.info.mock.calls[0];
    expect(message).toBe("admin schema loaded");
    expect(Object.keys(fields).sort()).toEqual(["buildMs", "fetchMs", "rssMb", "types", "version"]);
    expect(fields.version).toBe("2026-10");
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("token");
  });

  it("serves the cache within the TTL and refetches after it", async () => {
    const fetch = introspecting();
    vi.stubGlobal("fetch", fetch);

    const first = await adminSchema(shopify, shop);
    now += 23 * 60 * 60 * 1000;
    expect(await adminSchema(shopify, shop)).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);

    now += 2 * 60 * 60 * 1000;
    const second = await adminSchema(shopify, shop);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("keeps deprecated arguments and input fields, so a document using them is valid with warnings", async () => {
    vi.stubGlobal("fetch", introspecting());
    const schema = await adminSchema(shopify, shop);

    const result = preflight(
      schema,
      `mutation U($input: ProductInput!) { productUpdate(input: $input) { id } }`,
      { input: { id: "1", handle: "ring" } }
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.message)).toEqual([
      expect.stringContaining('argument "input" is deprecated'),
    ]);
  });

  it("returns null on failure and does not refetch within the cool-down", async () => {
    const fetch = answering(() => ({}), 503);
    vi.stubGlobal("fetch", fetch);
    const log = logger();

    expect(await adminSchema(shopify, shop, log)).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ version: "2026-10" }), "admin schema unavailable");
    now += 4 * 60 * 1000;
    expect(await adminSchema(shopify, shop, log)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    now += 2 * 60 * 1000;
    await adminSchema(shopify, shop, log);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps serving the previous schema when a refresh fails", async () => {
    const fetch = introspecting();
    vi.stubGlobal("fetch", fetch);
    const first = await adminSchema(shopify, shop);

    now += 25 * 60 * 60 * 1000;
    fetch.mockImplementation(async () => failing());
    expect(await adminSchema(shopify, shop)).toBe(first);
    expect(await adminSchema(shopify, shop)).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cools down only the store whose load failed", async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) =>
      url.includes(shop.myshopifyDomain) ? failing() : introspecting()(url, init)
    );
    vi.stubGlobal("fetch", fetch);

    expect(await adminSchema(shopify, shop)).toBeNull();
    expect(await adminSchema(shopify, other)).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["GraphQL errors", { errors: [{ message: "denied" }] }],
    ["no __schema", { data: {} }],
    ["an unbuildable schema", { data: { __schema: { queryType: { name: "Missing" }, types: [] } } }],
  ])("treats %s as unavailable", async (_label, body) => {
    vi.stubGlobal("fetch", answering(() => body));
    expect(await adminSchema(shopify, shop)).toBeNull();
  });

  it("treats a network failure as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await adminSchema(shopify, shop)).toBeNull();
  });

  it("shares one fetch between concurrent first calls", async () => {
    const fetch = introspecting();
    vi.stubGlobal("fetch", fetch);

    const [a, b, c] = await Promise.all([adminSchema(shopify, shop), adminSchema(shopify, shop), adminSchema(shopify, shop)]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("sends the introspection query with the store token and a 10 s timeout signal", async () => {
    const fetch = introspecting();
    vi.stubGlobal("fetch", fetch);

    await adminSchema(shopify, shop);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://test.myshopify.com/admin/api/2026-10/graphql.json");
    expect((init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("token");
    expect(JSON.parse(init.body as string).query).toContain("__schema");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("resetSchemaCache clears the cache", async () => {
    const fetch = introspecting();
    vi.stubGlobal("fetch", fetch);

    await adminSchema(shopify, shop);
    resetSchemaCache();
    await adminSchema(shopify, shop);

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
