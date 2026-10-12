import type { api as gadgetApi, logger as gadgetLogger } from "gadget-server";
import { recordAdminEvent } from "./audit";
import { HttpError } from "./httpError";
import type { GatewayUser } from "./identity";
import type { StoreRole } from "./policy";

type Api = typeof gadgetApi;
type Logger = typeof gadgetLogger;

export interface Member {
  userId: string;
  email: string | null;
  name: string | null;
  role: StoreRole;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: StoreRole;
}

const PAGE = 250;

export async function listMembers(api: Api, shopId: string): Promise<{ members: Member[]; invites: PendingInvite[] }> {
  const [rows, invites] = await Promise.all([
    api.access.findMany({
      filter: { shopId: { equals: shopId } },
      select: { role: true, user: { id: true, email: true, name: true } },
      first: PAGE,
    }),
    api.invite.findMany({ filter: { shopId: { equals: shopId } }, select: { id: true, email: true, role: true }, first: PAGE }),
  ]);
  return {
    members: rows.map((row) => ({
      userId: row.user.id,
      email: row.user.email,
      name: row.user.name,
      role: row.role as StoreRole,
    })),
    invites: invites.map((invite) => ({ id: invite.id, email: invite.email ?? "", role: invite.role as StoreRole })),
  };
}

/** Grants `role` to a known user at once, or records an invite that their first sign-in redeems. */
export async function addMember(
  api: Api,
  logger: Logger,
  actor: GatewayUser,
  shopId: string,
  email: string,
  role: StoreRole
): Promise<{ status: "granted" | "invited" }> {
  const target = await api.user.maybeFindFirst({ filter: { email: { equals: email } }, select: { id: true } });
  if (target) {
    const existing = await findAccess(api, target.id, shopId);
    if (existing?.role === "store-admin" && role !== "store-admin") await guardLastStoreAdmin(api, actor, shopId);
    if (existing) await api.access.update(existing.id, { role });
    else await api.access.create({ user: { _link: target.id }, shop: { _link: shopId }, role });
    await recordAdminEvent(api, logger, {
      userId: actor.id,
      shopId,
      operationType: "member-granted",
      reason: `role ${role} for user ${target.id}`,
    });
    return { status: "granted" };
  }

  const invite = await api.invite.maybeFindFirst({
    filter: { email: { equals: email }, shopId: { equals: shopId } },
    select: { id: true },
  });
  const saved = invite
    ? await api.invite.update(invite.id, { role, invitedBy: { _link: actor.id } })
    : await api.invite.create({ email, role, shop: { _link: shopId }, invitedBy: { _link: actor.id } });
  await recordAdminEvent(api, logger, {
    userId: actor.id,
    shopId,
    operationType: "member-invited",
    reason: `role ${role} for invite ${saved.id}`,
  });
  return { status: "invited" };
}

export async function removeMember(api: Api, logger: Logger, actor: GatewayUser, shopId: string, userId: string): Promise<void> {
  const access = await findAccess(api, userId, shopId);
  if (!access) throw new HttpError(404, "member not found");
  if (access.role === "store-admin") await guardLastStoreAdmin(api, actor, shopId);
  await api.access.delete(access.id);
  await recordAdminEvent(api, logger, {
    userId: actor.id,
    shopId,
    operationType: "member-removed",
    reason: `role ${access.role} removed from user ${userId}`,
  });
}

export async function removeInvite(api: Api, logger: Logger, actor: GatewayUser, shopId: string, inviteId: string): Promise<void> {
  const invite = await api.invite.maybeFindFirst({
    filter: { id: { equals: inviteId }, shopId: { equals: shopId } },
    select: { id: true },
  });
  if (!invite) throw new HttpError(404, "invite not found");
  await api.invite.delete(invite.id);
  await recordAdminEvent(api, logger, {
    userId: actor.id,
    shopId,
    operationType: "invite-revoked",
    reason: `invite ${inviteId} revoked`,
  });
}

/** Turns every invite for the user's verified email into an access row, keeping a role the user already holds. */
export async function consumeInvites(api: Api, logger: Logger, user: GatewayUser): Promise<void> {
  if (!user.email) return;
  const invites = await api.invite.findMany({
    filter: { email: { equals: user.email } },
    select: { id: true, role: true, shopId: true },
    first: PAGE,
  });
  for (const invite of invites) {
    if (invite.shopId && !(await findAccess(api, user.id, invite.shopId))) {
      await api.access.create({ user: { _link: user.id }, shop: { _link: invite.shopId }, role: invite.role as StoreRole });
      await recordAdminEvent(api, logger, {
        userId: user.id,
        shopId: invite.shopId,
        operationType: "invite-accepted",
        reason: `role ${invite.role} from invite ${invite.id}`,
      });
    }
    await api.invite.delete(invite.id);
  }
}

async function findAccess(api: Api, userId: string, shopId: string) {
  return api.access.maybeFindFirst({
    filter: { userId: { equals: userId }, shopId: { equals: shopId } },
    select: { id: true, role: true },
  });
}

/** A store-admin may not take away the store's last store-admin role (their own included); a global admin may. */
async function guardLastStoreAdmin(api: Api, actor: GatewayUser, shopId: string): Promise<void> {
  if (actor.globalRole === "admin") return;
  const admins = await api.access.findMany({
    filter: { shopId: { equals: shopId }, role: { equals: "store-admin" } },
    select: { id: true },
    first: 2,
  });
  if (admins.length <= 1) throw new HttpError(409, "a store needs at least one store-admin");
}
