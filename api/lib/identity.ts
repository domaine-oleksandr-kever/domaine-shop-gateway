import type { api as gadgetApi, logger as gadgetLogger } from "gadget-server";
import type { Principal } from "./auth";
import { adminSubs, allowedEmailDomains, userinfoUrl } from "./config";
import { consumeInvites } from "./members";

type Api = typeof gadgetApi;
type Logger = typeof gadgetLogger;

export interface GatewayUser {
  id: string;
  sub: string;
  email: string | null;
  name: string | null;
  globalRole: "none" | "admin";
  lastSeenAt: Date | null;
}

/** `rejected` carries the refusal text when the account may not use the gateway at all. */
export interface Resolution {
  user: GatewayUser;
  rejected: string | null;
}

interface Profile {
  email?: string;
  name?: string;
}

const USER_SELECT = { id: true, sub: true, email: true, name: true, globalRole: true, lastSeenAt: true } as const;
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;
const USERINFO_TIMEOUT_MS = 5_000;

/** Finds or creates the gateway user for a verified bearer, filling email and name from AuthKit userinfo when missing; the first known email redeems pending invites. */
export async function resolveUser(principal: Principal, bearer: string, api: Api, logger: Logger): Promise<Resolution> {
  const existing = await findBySub(api, principal.sub);
  const now = new Date();
  const touchDue = !existing?.lastSeenAt || now.getTime() - existing.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS;

  const changes: Partial<Omit<GatewayUser, "id" | "sub">> = {};
  if (!existing || (!existing.email && touchDue)) {
    const profile = principal.email ? { email: principal.email, name: principal.name } : await fetchProfile(bearer, logger);
    if (profile.email) changes.email = profile.email.toLowerCase();
    if (profile.name && !existing?.name) changes.name = profile.name;
  }
  if (adminSubs.includes(principal.sub) && existing?.globalRole !== "admin") changes.globalRole = "admin";
  if (touchDue) changes.lastSeenAt = now;

  const user = existing
    ? Object.keys(changes).length > 0
      ? toUser(await api.user.update(existing.id, changes, { select: USER_SELECT }))
      : existing
    : await createUser(api, principal.sub, changes);

  if (user.email && !allowedEmailDomains.includes(user.email.split("@").pop() ?? "")) {
    return { user, rejected: "account domain not allowed" };
  }
  if (changes.email) await consumeInvites(api, logger, user);
  return { user, rejected: null };
}

async function findBySub(api: Api, sub: string): Promise<GatewayUser | null> {
  const record = await api.user.maybeFindFirst({ filter: { sub: { equals: sub } }, select: USER_SELECT });
  return record ? toUser(record) : null;
}

async function createUser(api: Api, sub: string, fields: Partial<Omit<GatewayUser, "id" | "sub">>): Promise<GatewayUser> {
  try {
    return toUser(await api.user.create({ sub, ...fields }, { select: USER_SELECT }));
  } catch (error) {
    // Two first requests from one person race on the unique `sub`; the loser reads the winner's row.
    const winner = await findBySub(api, sub);
    if (winner) return winner;
    throw error;
  }
}

async function fetchProfile(bearer: string, logger: Logger): Promise<Profile> {
  try {
    const response = await fetch(userinfoUrl, {
      headers: { Authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "userinfo refused");
      return {};
    }
    const claims = (await response.json()) as Record<string, unknown>;
    logger.info({ claims: Object.keys(claims) }, "userinfo claims");
    const fullName = [claims.given_name, claims.family_name].filter((part) => typeof part === "string").join(" ");
    return {
      email: typeof claims.email === "string" && claims.email_verified !== false ? claims.email : undefined,
      name: typeof claims.name === "string" ? claims.name : fullName || undefined,
    };
  } catch (error) {
    logger.warn({ reason: error instanceof Error ? error.name : "unknown" }, "userinfo failed");
    return {};
  }
}

function toUser(record: {
  id: string;
  sub: string | null;
  email: string | null;
  name: string | null;
  globalRole: string | null;
  lastSeenAt: Date | null;
}): GatewayUser {
  return {
    id: record.id,
    sub: record.sub ?? "",
    email: record.email,
    name: record.name,
    globalRole: record.globalRole === "admin" ? "admin" : "none",
    lastSeenAt: record.lastSeenAt,
  };
}
