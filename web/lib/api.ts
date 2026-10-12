import { accessToken, dropTokens, refreshTokens } from "./auth";

/** Fired when the session ends mid-use, so the page can show the sign-in screen. */
export const SIGNED_OUT_EVENT = "gw:signed-out";

const REQUEST_TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** Calls the gateway admin API with the bearer, refreshing the tokens once on a 401; errors carry readable text. */
export async function gwFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let response = await send(path, options);
  if (response.status === 401 && (await refreshTokens())) response = await send(path, options);
  if (response.status === 401) {
    dropTokens();
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    throw new ApiError(401, "Your session has ended. Sign in again.");
  }
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new ApiError(response.status, body?.error ?? `Request failed (${response.status})`);
  return body as T;
}

async function send(path: string, { method = "GET", body }: { method?: string; body?: unknown }): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    return await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError(0, "The gateway did not answer in time. Try again.");
    }
    throw error;
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
