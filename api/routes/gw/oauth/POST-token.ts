import { RouteHandler } from "gadget-server";
import { z } from "zod";
import { corsOptions, issuer, resourceUrl, webClientId } from "../../../lib/config";

/**
 * Token exchange for the admin page. AuthKit's token endpoint answers the CORS preflight but not the POST itself,
 * so the browser cannot call it; this route forwards the grant and returns AuthKit's status and JSON unchanged.
 */
const Grant = z.discriminatedUnion("grant_type", [
  z.strictObject({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(1),
    code_verifier: z.string().min(1),
    redirect_uri: z.string().min(1),
  }),
  z.strictObject({ grant_type: z.literal("refresh_token"), refresh_token: z.string().min(1) }),
]);

const TOKEN_TIMEOUT_MS = 10_000;

const route: RouteHandler<{ Body: unknown }> = async ({ request, reply, logger }) => {
  const parsed = Grant.safeParse(request.body);
  if (!parsed.success) {
    await reply.code(400).send({ error: "invalid_request", error_description: "unsupported grant or missing fields" });
    return;
  }
  const form = new URLSearchParams({ ...parsed.data, client_id: webClientId });
  if (parsed.data.grant_type === "authorization_code") form.set("resource", resourceUrl);

  try {
    const response = await fetch(`${issuer}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({ error: "server_error", error_description: "unreadable token response" }));
    await reply.code(response.status).header("Cache-Control", "no-store").send(body);
  } catch (error) {
    logger.warn({ reason: error instanceof Error ? error.name : "unknown" }, "token endpoint unreachable");
    await reply.code(502).send({ error: "temporarily_unavailable", error_description: "sign-in service unreachable" });
  }
};

route.options = { cors: corsOptions };

export default route;
