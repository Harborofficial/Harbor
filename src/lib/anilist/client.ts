import { ANILIST_GRAPHQL_URL } from "./config";
import { getSession } from "./session";
import { safeFetch } from "@/lib/safe-fetch";
import { AnilistApiError } from "./errors";
export { AnilistApiError } from "./errors";

type GraphqlResponse<T> = { data?: T; errors?: Array<{ message: string }> };

// AniList's anonymous bucket is shared by every read-only surface. Once it is
// exhausted, retrying immediately only burns more requests, so reads fail fast
// for the retry window instead of sleeping inside the request.
let anonymousCooldownUntil = 0;
// Authenticated limits are per-token and bursty; one short retry absorbs a
// transient 429 without holding a page for the full Retry-After window.
const AUTH_RETRY_MAX_MS = 5_000;

function rateLimitWaitMs(retryAfter: string | null): number {
  const retry = Number(retryAfter ?? "60");
  const seconds = Number.isFinite(retry) ? Math.min(Math.max(retry, 1), 60) : 60;
  return seconds * 1000;
}

function doFetch(
  query: string,
  variables: Record<string, unknown>,
  token: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return safeFetch(ANILIST_GRAPHQL_URL, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers,
    body: JSON.stringify({ query, variables }),
  });
}

export async function anilistRequest<T>(
  query: string,
  variables: Record<string, unknown> = {},
  accessToken?: string,
  skipAuth = false,
): Promise<T> {
  const token = skipAuth ? null : (accessToken ?? getSession()?.accessToken ?? null);
  // The cooldown applies to the anonymous bucket whether the caller opted out
  // of auth explicitly or simply has no token.
  const anonymous = !token;
  if (anonymous && Date.now() < anonymousCooldownUntil) {
    throw new AnilistApiError(429, "anonymous rate limit cooldown");
  }

  let res = await doFetch(query, variables, token);

  if (res.status === 429) {
    const body = await res.text().catch(() => "");
    if (anonymous) {
      anonymousCooldownUntil = Math.max(
        anonymousCooldownUntil,
        Date.now() + rateLimitWaitMs(res.headers.get("retry-after")),
      );
      throw new AnilistApiError(429, body);
    }
    const waitMs = Math.min(rateLimitWaitMs(res.headers.get("retry-after")), AUTH_RETRY_MAX_MS);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    res = await doFetch(query, variables, token);
    if (res.status === 429) {
      throw new AnilistApiError(429, await res.text().catch(() => ""));
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AnilistApiError(res.status, body);
  }

  const json = (await res.json()) as GraphqlResponse<T>;
  if (json.errors && json.errors.length > 0) {
    throw new AnilistApiError(200, json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) throw new AnilistApiError(200, "Missing GraphQL data");
  return json.data as T;
}
