import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { issuer, jwksUrl, resourceUrl } from "./config";

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

export async function verifyBearer(authorizationHeader: string | undefined, logger?: Logger): Promise<Principal | null> {
  const match = authorizationHeader?.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    logger?.warn({ reason: authorizationHeader ? "scheme" : "missing" }, "bearer rejected");
    return null;
  }
  try {
    const { payload } = await jwtVerify(match[1], jwks, { issuer, audience: resourceUrl });
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
