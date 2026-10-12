/**
 * OAuth 2.1 authorization code + PKCE against WorkOS AuthKit: the authorize redirect runs in the browser, the code and
 * refresh exchanges go through /gw/oauth/token (AuthKit's token endpoint sends no CORS header on the POST). The
 * `resource` parameter (RFC 8707) asks for an access token whose audience is the gateway's /mcp resource.
 * Tokens live in localStorage, shared by every tab of the browser; the PKCE flow record and the automatic sign-in flag
 * stay in the sessionStorage of the tab that set them.
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
const AUTO_SIGN_IN_KEY = "gw.auto-signin";
const SIGNED_OUT_KEY = "gw.signed-out";

const tokenStore = () => localStorage;
const tabStore = () => sessionStorage;

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
  return readJson<Tokens>(tokenStore, TOKENS_KEY)?.accessToken ?? null;
}

/** Forgets the tokens when the session has ended; the next sign-in screen may still sign in automatically. */
export function dropTokens(): void {
  removeItem(tokenStore, TOKENS_KEY);
}

/** The user's own sign-out: every tab shows the sign-in button until they sign in again by hand. */
export function signOut(): void {
  dropTokens();
  tryWrite(tokenStore, SIGNED_OUT_KEY);
}

/**
 * True when this tab may start the sign-in by itself (AuthKit's own session cookie then skips the Google screen):
 * once per tab, so a failing callback cannot loop, and never after the user signed out.
 */
export function autoSignInAllowed(): boolean {
  return !readJson(tabStore, AUTO_SIGN_IN_KEY) && !readJson(tokenStore, SIGNED_OUT_KEY);
}

export function markAutoSignIn(): void {
  tryWrite(tabStore, AUTO_SIGN_IN_KEY);
}

export async function startSignIn(returnTo: string): Promise<void> {
  const config = await loadConfig();
  const flow: PendingFlow = { verifier: randomToken(), state: randomToken(), returnTo };
  writeJson(tabStore, FLOW_KEY, flow);
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
  const flow = readJson<PendingFlow>(tabStore, FLOW_KEY);
  removeItem(tabStore, FLOW_KEY);
  const error = params.get("error");
  if (error) throw new Error(params.get("error_description") ?? error);
  const code = params.get("code");
  if (!flow || !code || params.get("state") !== flow.state) {
    throw new Error("This sign-in link is stale or was not started here. Sign in again.");
  }
  const config = await loadConfig();
  await requestTokens({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: flow.verifier,
  });
  removeItem(tokenStore, SIGNED_OUT_KEY);
  return flow.returnTo.startsWith("/") && !flow.returnTo.startsWith("//") ? flow.returnTo : "/";
}

/** Swaps the refresh token for new tokens; concurrent callers share one request. False when the session is over. */
export function refreshTokens(): Promise<boolean> {
  refreshRequest ??= (async () => {
    const refreshToken = readJson<Tokens>(tokenStore, TOKENS_KEY)?.refreshToken;
    if (!refreshToken) return false;
    try {
      await requestTokens({ grant_type: "refresh_token", refresh_token: refreshToken });
      return true;
    } catch {
      // Another tab may have spent this refresh token and stored its successor.
      const current = readJson<Tokens>(tokenStore, TOKENS_KEY)?.refreshToken;
      if (current && current !== refreshToken) return true;
      dropTokens();
      return false;
    }
  })().finally(() => {
    refreshRequest = undefined;
  });
  return refreshRequest;
}

async function requestTokens(grant: Record<string, string>): Promise<void> {
  const response = await fetch("/gw/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(grant),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== "string") {
    throw new Error(typeof body.error_description === "string" ? body.error_description : "Sign-in failed. Try again.");
  }
  const previous = readJson<Tokens>(tokenStore, TOKENS_KEY);
  writeJson(tokenStore, TOKENS_KEY, {
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

function readJson<T>(store: () => Storage, key: string): T | null {
  try {
    const raw = store().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(store: () => Storage, key: string, value: unknown): void {
  store().setItem(key, JSON.stringify(value));
}

function tryWrite(store: () => Storage, key: string): void {
  try {
    writeJson(store, key, true);
  } catch {
    // Storage blocked: no sign-in can complete without storage either.
  }
}

function removeItem(store: () => Storage, key: string): void {
  try {
    store().removeItem(key);
  } catch {
    // Storage blocked: nothing was stored either.
  }
}
