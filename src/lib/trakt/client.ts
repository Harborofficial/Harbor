import { TRAKT_API_BASE, TRAKT_API_VERSION, TRAKT_CLIENT_ID, TRAKT_TOKEN_PROXY } from "./config";
import { getSession, setSession } from "./session";
import type { TraktSession } from "./types";

export type TraktRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  authed?: boolean;
  assertCurrent?: () => void;
};

export class TraktApiError extends Error {
  public status: number;
  public body: string;
  /** Epoch milliseconds from the response's Retry-After, when present. */
  public retryAt?: number;
  constructor(status: number, body: string, retryAt?: number) {
    super(`Trakt HTTP ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
    this.retryAt = retryAt;
  }
}

function baseHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "trakt-api-version": TRAKT_API_VERSION,
    "trakt-api-key": TRAKT_CLIENT_ID,
  };
}

/**
 * The Harbor token proxy is not Trakt: it only accepts `Content-Type` (anything else
 * fails its CORS preflight, which silently killed every refresh while the device-token
 * login, which sends just this header, kept working).
 */
function proxyHeaders(): HeadersInit {
  return { "Content-Type": "application/json" };
}

async function refreshAccessToken(): Promise<TraktSession | null> {
  const current = getSession();
  if (!current) return null;
  let res: Response;
  try {
    res = await fetch(TRAKT_TOKEN_PROXY, {
      method: "POST",
      headers: proxyHeaders(),
      body: JSON.stringify({
        refresh_token: current.refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    // A transport failure says nothing about the grant, so the stored session stays.
    return null;
  }
  // A refresh belongs to its captured session, including failed refreshes.
  // Signing in elsewhere while it is pending must not replace that new session.
  if (getSession() !== current) return null;
  if (!res.ok) {
    // Only Trakt's own refusal ends the connection. A proxy hiccup, a rate limit or a
    // server error must not sign the listener out of their tracker and lose the
    // refresh token, which is the only thing that can restore it silently.
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      // A refresh token rotates on every use: a rejection means this one is spent.
      const latest = getSession();
      if (latest?.refreshToken === current.refreshToken) setSession(null);
    }
    return null;
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    created_at: number;
    expires_in: number;
  };
  if (getSession() !== current) return null;
  const next: TraktSession = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    createdAt: data.created_at,
    expiresIn: data.expires_in,
    username: current.username,
  };
  setSession(next);
  return next;
}

let inflightRefresh: Promise<TraktSession | null> | null = null;
function ensureRefreshed(): Promise<TraktSession | null> {
  if (!inflightRefresh) {
    inflightRefresh = refreshAccessToken().finally(() => {
      inflightRefresh = null;
    });
  }
  return inflightRefresh;
}

async function doFetch(path: string, opts: TraktRequestOptions): Promise<Response> {
  opts.assertCurrent?.();
  const headers: Record<string, string> = { ...(baseHeaders() as Record<string, string>) };
  const useAuth = opts.authed !== false;
  if (useAuth) {
    const session = getSession();
    if (session) headers["Authorization"] = `Bearer ${session.accessToken}`;
  }
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };
  return fetch(`${TRAKT_API_BASE}${path}`, init);
}

export type TraktResponse<T> = { data: T; status: number; headers: Headers };

function retryDelayMs(header: string | null): number {
  if (!header) return 1_000;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 1), 30) * 1_000;
  // Trakt documents Retry-After as seconds, but HTTP allows a date. An
  // unparseable value must not collapse into an immediate retry.
  const at = Date.parse(header);
  if (Number.isFinite(at)) {
    return Math.min(Math.max(at - Date.now(), 1_000), 30_000);
  }
  return 1_000;
}

function retryAtFromResponse(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Date.now() + seconds * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? at : undefined;
}

/** Same request path as traktRequest, keeping the status and headers for callers
 * that need pagination or Retry-After metadata. */
export async function traktRequestWithResponse<T>(
  path: string,
  opts: TraktRequestOptions = {},
): Promise<TraktResponse<T>> {
  let res = await doFetch(path, opts);

  if (res.status === 401 && opts.authed !== false) {
    opts.assertCurrent?.();
    const refreshed = await ensureRefreshed();
    if (refreshed) res = await doFetch(path, opts);
  }

  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, retryDelayMs(res.headers.get("retry-after"))));
    res = await doFetch(path, opts);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TraktApiError(res.status, body, retryAtFromResponse(res));
  }

  if (res.status === 204) {
    return { data: undefined as unknown as T, status: 204, headers: res.headers };
  }
  return { data: (await res.json()) as T, status: res.status, headers: res.headers };
}

export async function traktRequest<T>(path: string, opts: TraktRequestOptions = {}): Promise<T> {
  return (await traktRequestWithResponse<T>(path, opts)).data;
}
