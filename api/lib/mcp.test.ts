import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildSchema } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpServer, type McpContext } from "./mcp";
import { storeGrants } from "./roles";
import { adminSchema } from "./schema";
import { runAdminGraphql } from "./shopify";

vi.mock("./identity", () => ({
  resolveUser: async () => ({
    user: { id: "u1", sub: "s1", email: "dev@example.com", name: null, globalRole: "none", lastSeenAt: null },
    rejected: null,
  }),
}));
vi.mock("./roles", async (original) => ({ ...(await original<typeof import("./roles")>()), storeGrants: vi.fn() }));
vi.mock("./schema", () => ({ adminSchema: vi.fn() }));
vi.mock("./shopify", async (original) => ({
  ...(await original<typeof import("./shopify")>()),
  runAdminGraphql: vi.fn(),
}));

const schema = buildSchema(`
  type Product { id: ID! title: String! handle: String @deprecated(reason: "use title") }
  input ProductInput { id: ID! title: String }
  type Query { product(id: ID!): Product }
  type Mutation { productUpdate(product: ProductInput!): Product }
`);
const shop = { id: "1", alias: "dev-a", myshopifyDomain: "dev-a.myshopify.com", env: "dev", enabled: true, installedAt: new Date(0) };
const BAD = `{ product(id: "1") { price } }`;

let auditRows: Record<string, unknown>[];

async function connect() {
  auditRows = [];
  const context = {
    principal: { sub: "s1" },
    bearer: "bearer",
    api: {
      audit: { create: vi.fn(async (row: Record<string, unknown>) => void auditRows.push(row)) },
      access: { findMany: vi.fn(async () => [{ shopId: "1", role: "dev" }, { shopId: "2", role: "read" }]) },
      shopifyShop: {
        findMany: vi.fn(async () => [
          { id: "2", alias: "gone", myshopifyDomain: "gone.myshopify.com", env: "prod", enabled: true, createdAt: new Date(0) },
        ]),
      },
      pref: { maybeFindFirst: vi.fn(async () => ({ currentShopId: "1" })) },
    },
    connections: { shopify: {} },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as McpContext;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(context).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return async (tool: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name: tool, arguments: { store: "dev-a", ...args } });
    return { isError: result.isError === true, text: (result.content as { text: string }[])[0].text };
  };
}

beforeEach(() => {
  vi.mocked(storeGrants).mockResolvedValue([{ shop, role: "dev" }] as never);
  vi.mocked(adminSchema).mockReset().mockResolvedValue(schema);
  vi.mocked(runAdminGraphql).mockReset().mockResolvedValue({ ok: true, status: 200, body: { data: { product: null } } });
});

describe("query", () => {
  it("refuses an invalid document unsent and audits it as invalid", async () => {
    const call = await connect();
    const result = await call("query", { query: BAD });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^invalid document: Cannot query field "price"/);
    expect(runAdminGraphql).not.toHaveBeenCalled();
    expect(auditRows).toEqual([expect.objectContaining({ tool: "query", allowed: false, reason: "invalid" })]);
  });

  it("sends once and says validated: false when the schema is unavailable", async () => {
    vi.mocked(adminSchema).mockResolvedValue(null);
    const call = await connect();
    const result = await call("query", { query: BAD });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject({ data: { product: null }, validated: false });
    expect(runAdminGraphql).toHaveBeenCalledTimes(1);
    expect(auditRows).toEqual([expect.objectContaining({ tool: "query", allowed: true, reason: null })]);
  });
});

describe("validate", () => {
  it("never calls Shopify and audits as validate, allowed like query would be", async () => {
    const call = await connect();
    const bad = JSON.parse((await call("validate", { query: BAD })).text);
    const good = JSON.parse((await call("validate", { query: `{ product(id: "1") { handle } }` })).text);

    expect(bad).toMatchObject({ valid: false, validated: true, policy: { allowed: true, reason: null } });
    expect(bad.errors).toHaveLength(1);
    expect(good).toMatchObject({ valid: true, validated: true, errors: [] });
    expect(good.warnings).toHaveLength(1);
    expect(runAdminGraphql).not.toHaveBeenCalled();
    expect(auditRows).toEqual([
      expect.objectContaining({ tool: "validate", allowed: false, reason: "invalid" }),
      expect.objectContaining({ tool: "validate", allowed: true, reason: null }),
    ]);
  });

  it("is not valid when nothing was checked", async () => {
    vi.mocked(adminSchema).mockResolvedValue(null);
    const call = await connect();
    const result = JSON.parse((await call("validate", { query: BAD })).text);

    expect(result).toMatchObject({ valid: false, validated: false, errors: [] });
    expect(auditRows).toEqual([expect.objectContaining({ tool: "validate", allowed: true, reason: null })]);
  });

  it("returns a policy refusal inside the JSON and skips the schema check", async () => {
    const call = await connect();
    const result = await call("validate", { query: `{ __schema { types { name } } }` });
    const body = JSON.parse(result.text);

    expect(result.isError).toBe(false);
    expect(body).toMatchObject({ valid: false, validated: false, policy: { allowed: false } });
    expect(body.policy.reason).toEqual(expect.any(String));
    expect(adminSchema).not.toHaveBeenCalled();
    expect(auditRows).toEqual([expect.objectContaining({ tool: "validate", allowed: false, reason: body.policy.reason })]);
  });
});

describe("stores", () => {
  it("lists usable stores and, separately, uninstalled ones with a reconnect hint", async () => {
    const call = await connect();
    const result = await call("stores", {});

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({
      stores: [{ alias: "dev-a", domain: "dev-a.myshopify.com", env: "dev", enabled: true, role: "dev", current: true }],
      uninstalled: [{ alias: "gone", domain: "gone.myshopify.com", hint: expect.stringContaining("Add store") }],
    });
  });
});
