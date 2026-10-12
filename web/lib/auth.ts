/**
 * OAuth 2.1 authorization code + PKCE against WorkOS AuthKit, in the browser. The `resource` parameter (RFC 8707)
 * asks for an access token whose audience is the gateway's /mcp resource, the one the backend verifies.
 * Tokens live in sessionStorage: they survive a reload, not the tab.
 */
import type { GatewayConfig } from "./types";

interface Tokens {
  accessToken: string;
  refreshToken: string | null;
}

interface PendingFlow {
  verifier: string;
  state: string;
  returnTo: string;
}

const TOKENS_KEY = "gw.tokens";
const FLOW_KEY = "gw.oauth-flow";

let configRequest: Promise<GatewayConfig> | undefined;
let refreshRequest: Promise<boolean> | undefined;

export function loadConfig(): Promise<GatewayConfig> {
  configRequest ??= fetch("/gw/config").then((response) => {
    if (!response.ok) throw new Error(`Could not load the sign-in settings (${response.status})`);
    return response.json() as Promise<GatewayConfig>;
  });
  return configRequest;
}

export function accessToken(): string | null {
  return readJson<Tokens>(TOKENS_KEY)?.accessToken ?? null;
}

export function signOut(): void {
  removeItem(TOKENS_KEY);
}

export async function startSignIn(returnTo: string): Promise<void> {
  const config = await loadConfig();
  const flow: PendingFlow = { verifier: randomToken(), state: randomToken(), returnTo };
  writeJson(FLOW_KEY, flow);
  const url = new URL(`${config.issuer}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
    state: flow.state,
    code_challenge: await sha256Base64Url(flow.verifier),
    code_challenge_method: "S256",
    resource: config.resource,
  }).toString();
  window.location.assign(url.toString());
}

/** Exchanges the callback's code for tokens and returns the path the sign-in started from. */
export async function finishSignIn(params: URLSearchParams): Promise<string> {
  const flow = readJson<PendingFlow>(FLOW_KEY);
  removeItem(FLOW_KEY);
  const error = params.get("error");
  if (error) throw new Error(params.get("error_description") ?? error);
  const code = params.get("code");
  if (!flow || !code || params.get("state") !== flow.state) {
    throw new Error("This sign-in link is stale or was not started here. Sign in again.");
  }
  const config = await loadConfig();
  await requestTokens(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: flow.verifier,
  });
  return flow.returnTo.startsWith("/") && !flow.returnTo.startsWith("//") ? flow.returnTo : "/";
}

/** Swaps the refresh token for new tokens; concurrent callers share one request. False when the session is over. */
export function refreshTokens(): Promise<boolean> {
  refreshRequest ??= (async () => {
    const refreshToken = readJson<Tokens>(TOKENS_KEY)?.refreshToken;
    if (!refreshToken) return false;
    try {
      await requestTokens(await loadConfig(), { grant_type: "refresh_token", refresh_token: refreshToken });
      return true;
    } catch {
      signOut();
      return false;
    }
  })().finally(() => {
    refreshRequest = undefined;
  });
  return refreshRequest;
}

async function requestTokens(config: GatewayConfig, grant: Record<string, string>): Promise<void> {
  const response = await fetch(`${config.issuer}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...grant, client_id: config.clientId, resource: config.resource }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== "string") {
    throw new Error(typeof body.error_description === "string" ? body.error_description : "Sign-in failed. Try again.");
  }
  const previous = readJson<Tokens>(TOKENS_KEY);
  writeJson(TOKENS_KEY, {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : (previous?.refreshToken ?? null),
  } satisfies Tokens);
}

function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256Base64Url(text: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readJson<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  sessionStorage.setItem(key, JSON.stringify(value));
}

function removeItem(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing was stored either.
  }
}
