import { describe, expect, it, vi } from "vitest";
import type { GatewayUser } from "./identity";
import { consumeInvites, removeMember } from "./members";

type Api = Parameters<typeof consumeInvites>[0];
type Logger = Parameters<typeof consumeInvites>[1];

interface AccessRow {
  id: string;
  userId: string;
  shopId: string;
  role: string;
}

function fakeApi(state: { access: AccessRow[]; invites: { id: string; email: string; shopId: string; role: string }[] }) {
  const matches = (row: Record<string, unknown>, filter: Record<string, { equals: unknown }>) =>
    Object.entries(filter).every(([field, { equals }]) => row[field] === equals);
  const api = {
    access: {
      maybeFindFirst: vi.fn(async ({ filter }) => state.access.find((row) => matches({ ...row }, filter)) ?? null),
      findMany: vi.fn(async ({ filter }) => state.access.filter((row) => matches({ ...row }, filter))),
      create: vi.fn(async ({ user, shop, role }) => {
        state.access.push({ id: `a${state.access.length + 1}`, userId: user._link, shopId: shop._link, role });
      }),
      delete: vi.fn(async (id: string) => {
        state.access = state.access.filter((row) => row.id !== id);
      }),
    },
    invite: {
      findMany: vi.fn(async ({ filter }) => state.invites.filter((row) => matches({ ...row }, filter))),
      delete: vi.fn(async (id: string) => {
        state.invites = state.invites.filter((row) => row.id !== id);
      }),
    },
    audit: { create: vi.fn(async () => ({})) },
  };
  return api as typeof api & Api;
}

const logger = { error: vi.fn() } as unknown as Logger;
const user = (fields: Partial<GatewayUser>): GatewayUser => ({
  id: "u1",
  sub: "user_1",
  email: "jane@meetdomaine.com",
  name: null,
  globalRole: "none",
  lastSeenAt: null,
  ...fields,
});

describe("consumeInvites", () => {
  it("grants each invited role, keeps a role the user already holds, and deletes every invite", async () => {
    const state = {
      access: [{ id: "a0", userId: "u1", shopId: "s2", role: "read" }],
      invites: [
        { id: "i1", email: "jane@meetdomaine.com", shopId: "s1", role: "dev" },
        { id: "i2", email: "jane@meetdomaine.com", shopId: "s2", role: "store-admin" },
        { id: "i3", email: "other@meetdomaine.com", shopId: "s1", role: "read" },
      ],
    };
    const api = fakeApi(state);

    await consumeInvites(api, logger, user({}));

    expect(state.access).toEqual([
      { id: "a0", userId: "u1", shopId: "s2", role: "read" },
      { id: "a2", userId: "u1", shopId: "s1", role: "dev" },
    ]);
    expect(state.invites.map((invite) => invite.id)).toEqual(["i3"]);
    expect(api.audit.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(api.audit.create.mock.calls)).not.toContain("@");
  });

  it("does nothing for a user without an email", async () => {
    const api = fakeApi({ access: [], invites: [] });
    await consumeInvites(api, logger, user({ email: null }));
    expect(api.invite.findMany).not.toHaveBeenCalled();
  });
});

describe("removeMember", () => {
  const lastAdmin = () => ({ access: [{ id: "a1", userId: "u1", shopId: "s1", role: "store-admin" }], invites: [] });

  it("refuses a store-admin removing the last store-admin, themselves included", async () => {
    const state = lastAdmin();
    await expect(removeMember(fakeApi(state), logger, user({}), "s1", "u1")).rejects.toMatchObject({ status: 409 });
    expect(state.access).toHaveLength(1);
  });

  it("lets a global admin remove the last store-admin", async () => {
    const state = lastAdmin();
    await removeMember(fakeApi(state), logger, user({ id: "owner", globalRole: "admin" }), "s1", "u1");
    expect(state.access).toHaveLength(0);
  });
});
