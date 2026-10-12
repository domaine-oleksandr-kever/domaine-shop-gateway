import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import type { FastifyReply } from "fastify";
import { issuer, jwksUrl, metadataUrl, resourceUrl } from "./config";

export interface Principal {
  sub: string;
  email?: string;
  name?: string;
}

interface Logger {
  warn(fields: object, message: string): void;
}

const jwks = createRemoteJWKSet(new URL(jwksUrl));

function failureReason(error: unknown): string {
  if (error instanceof errors.JWTExpired) return "expired";
  if (error instanceof errors.JWTClaimValidationFailed) return `claim:${error.claim}`;
  if (error instanceof errors.JWSSignatureVerificationFailed) return "signature";
  if (error instanceof errors.JOSEError) return error.code;
  return "unknown";
}

export function bearerToken(authorizationHeader: string | undefined): string | null {
  return authorizationHeader?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
}

export async function verifyBearer(authorizationHeader: string | undefined, logger?: Logger): Promise<Principal | null> {
  const token = bearerToken(authorizationHeader);
  if (!token) {
    logger?.warn({ reason: authorizationHeader ? "scheme" : "missing" }, "bearer rejected");
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: resourceUrl });
    if (typeof payload.sub !== "string") throw new errors.JWTClaimValidationFailed("missing sub", payload, "sub");
    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
    };
  } catch (error) {
    logger?.warn({ reason: failureReason(error) }, "bearer rejected");
    return null;
  }
}

/** The 401 every bearer-protected route answers with; `resource_metadata` lets an OAuth client discover the authorization server. */
export function sendUnauthorized(reply: FastifyReply) {
  return reply
    .code(401)
    .header(
      "WWW-Authenticate",
      `Bearer error="unauthorized", error_description="Authorization needed", resource_metadata="${metadataUrl}"`
    )
    .send({ error: "unauthorized", error_description: "Authorization needed" });
}
