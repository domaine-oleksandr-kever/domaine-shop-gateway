import type { RequestGenericInterface } from "fastify";
import type { RouteContext, RouteHandler } from "gadget-server";
import { bearerToken, sendUnauthorized, verifyBearer } from "./auth";
import { corsOptions } from "./config";
import { HttpError } from "./httpError";
import { resolveUser, type GatewayUser } from "./identity";
import { findGrant, storeGrants, type StoreGrant } from "./roles";

/** Wraps an admin API handler: bearer check, user resolution, JSON body or `{ error }` on refusal. */
export function gwRoute<G extends RequestGenericInterface = RequestGenericInterface>(
  handler: (context: RouteContext<G>, user: GatewayUser) => Promise<unknown>
): RouteHandler {
  const route: RouteHandler = async (context) => {
    const { request, reply, logger, api } = context;
    const principal = await verifyBearer(request.headers.authorization, logger);
    if (!principal) {
      await sendUnauthorized(reply);
      return;
    }
    try {
      const { user, rejected } = await resolveUser(principal, bearerToken(request.headers.authorization)!, api, logger);
      if (rejected) throw new HttpError(403, rejected);
      // The route file declares the params, body and query shapes it reads; zod checks bodies inside the handler.
      const body = await handler(context as unknown as RouteContext<G>, user);
      await reply.header("Cache-Control", "no-store").send(body ?? { ok: true });
    } catch (error) {
      if (error instanceof HttpError) {
        await reply.code(error.status).send({ error: error.message });
        return;
      }
      logger.error({ reason: error instanceof Error ? error.name : "unknown" }, "admin route failed");
      await reply.code(500).send({ error: "internal error" });
    }
  };
  route.options = { cors: corsOptions };
  return route;
}

/** The user's grant on one store; 404 when they hold no role there, 403 when `storeAdmin` is required and missing. */
export async function requireStore(
  api: RouteContext["api"],
  user: GatewayUser,
  shopId: string,
  { storeAdmin = false } = {}
): Promise<StoreGrant> {
  const grant = findGrant(await storeGrants(api, user), { shopId });
  if (!grant) throw new HttpError(404, "store not found");
  if (storeAdmin && grant.role !== "store-admin") throw new HttpError(403, "store-admin role required");
  return grant;
}

export function requireGlobalAdmin(user: GatewayUser): void {
  if (user.globalRole !== "admin") throw new HttpError(403, "global admin role required");
}
