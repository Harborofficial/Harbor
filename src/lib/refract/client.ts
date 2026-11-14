import { safeFetch } from "@/lib/safe-fetch";
import { readSharedSecret, writeSharedSecret } from "@/lib/secret-store";

const KEY = "harbor.refract.key.v1";
const ENABLED_KEY = "harbor.refract.enabled.v1";
const AUTO_THRESHOLD_KEY = "harbor.refract.auto-threshold.v1";
export const REFRACT_AUTO_THRESHOLDS = ["3m", "5m", "10m", 50, 60, 70, 80, 85] as const;
export type RefractAutoThreshold = (typeof REFRACT_AUTO_THRESHOLDS)[number];
const DEFAULT_AUTO_THRESHOLD: RefractAutoThreshold = 70;
const API = "https://getrefract.app/v1";

export type RefractLookup = {
  type?: "movie" | "show" | "episode";
  ids?: { refract?: string | number };
  show?: { ids?: { refract?: string | number } };
  episode?: { season?: number; number?: number };
};

export class RefractApiError extends Error {
  readonly status: number;
  readonly retryAfterMs: number;
  readonly code?: string;

  constructor(status: number, retryAfterMs = 0, code?: string) {
    super(`Refract HTTP ${status}`);
    this.name = "RefractApiError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.code = code;
  }
}

export function getRefractKey(): string | null {
  return readSharedSecret(KEY)?.trim() || null;
}
export function saveRefractKey(value: string | null): void {
  writeSharedSecret(KEY, value?.trim() || null);
  window.dispatchEvent(new Event("harbor:refract-auth-changed"));
}
export function refractEnabled(): boolean {
  try {
    return getRefractKey() !== null && localStorage.getItem(ENABLED_KEY) !== "0";
  } catch {
    return false;
  }
}
export function setRefractEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
}
export function getRefractAutoThreshold(): RefractAutoThreshold {
  try {
    const raw = localStorage.getItem(AUTO_THRESHOLD_KEY);
    return REFRACT_AUTO_THRESHOLDS.find((value) => String(value) === raw) ?? DEFAULT_AUTO_THRESHOLD;
  } catch {
    return DEFAULT_AUTO_THRESHOLD;
  }
}
export function setRefractAutoThreshold(value: number | string): void {
  if (REFRACT_AUTO_THRESHOLDS.some((allowed) => String(allowed) === String(value)))
    localStorage.setItem(AUTO_THRESHOLD_KEY, String(value));
}
/** Use the media position, not wall-clock time. Seeking may cross the threshold. */
export function refractPlaybackReached(positionSec: number, durationSec: number): boolean {
  if (!Number.isFinite(positionSec) || !Number.isFinite(durationSec) || durationSec <= 0)
    return false;
  const threshold = getRefractAutoThreshold();
  const target =
    typeof threshold === "string"
      ? Number.parseInt(threshold, 10) * 60
      : (durationSec * threshold) / 100;
  return positionSec >= target;
}
async function request<T>(
  key: string,
  path: string,
  method: "GET" | "PUT" | "POST" | "DELETE" = "GET",
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const response = await safeFetch(`${API}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${key}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": `"${idempotencyKey}"` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: "error",
  });
  if (!response.ok) {
    const retry = Number(response.headers.get("Retry-After"));
    let code: string | undefined;
    try {
      const problem = await response.json();
      if (typeof problem?.code === "string") code = problem.code;
    } catch {
      // Not every HTTP error has a JSON problem body.
    }
    throw new RefractApiError(
      response.status,
      Number.isFinite(retry) && retry > 0 ? retry * 1000 : 0,
      code,
    );
  }
  if (response.status === 204) return undefined as T;
  const raw = await response.text();
  return (raw ? JSON.parse(raw) : undefined) as T;
}
export type RefractProfile = { id: string; username?: string; display_name?: string };
export async function getRefractProfile(key: string): Promise<RefractProfile> {
  return request<RefractProfile>(key, "/me");
}
export async function verifyRefractKey(key: string): Promise<string> {
  const profile = await getRefractProfile(key);
  return profile?.username || profile?.display_name || "Connected";
}
export async function lookupRefract(
  key: string,
  idType: "imdb" | "tmdb" | "tvdb",
  externalId: string,
  type: "movie" | "show" | "episode",
  season?: number,
  episode?: number,
  numbering?: "tmdb" | "tvdb" | "absolute",
): Promise<RefractLookup[]> {
  const query = new URLSearchParams({ type });
  if (type === "episode") {
    if (season !== undefined) query.set("season", String(season));
    if (episode !== undefined) query.set("number", String(episode));
    query.set("numbering", numbering || (idType === "tvdb" ? "tvdb" : "tmdb"));
  }
  try {
    const data = await request<{ data?: RefractLookup[] }>(
      key,
      `/search/${idType}/${encodeURIComponent(externalId)}?${query}`,
    );
    return Array.isArray(data?.data) ? data.data : [];
  } catch (error) {
    if (error instanceof RefractApiError && error.status === 404) return [];
    throw error;
  }
}
export async function writeRefractMovie(
  key: string,
  movieId: string | number,
  watchedAt: number,
  requestId: string,
): Promise<void> {
  await request(
    key,
    "/history/movies",
    "POST",
    {
      movie_id: movieId,
      watched_at: new Date(watchedAt).toISOString(),
    },
    requestId,
  );
}
export async function writeRefractEpisode(
  key: string,
  showId: string | number,
  season: number,
  number: number,
  watchedAt: number,
): Promise<void> {
  await request(
    key,
    `/history/episodes/${encodeURIComponent(String(showId))}/${season}/${number}`,
    "PUT",
    { watched_at: new Date(watchedAt).toISOString() },
  );
}

/** Watchlist membership is separate from watched history and other library statuses. */
export type RefractWatchlistInput = { id: string; type?: string; imdbId?: string | null };
type WatchlistIdentity = {
  idType: "imdb" | "tmdb" | "tvdb";
  id: string;
  type: "movie" | "show";
};
export function refractWatchlistIdentity(input: RefractWatchlistInput): WatchlistIdentity | null {
  const tmdb = /^tmdb:(movie|tv):(\d+)$/.exec(input.id);
  const tvdb = /^tvdb:(\d+)$/.exec(input.id);
  const type =
    input.type === "movie"
      ? "movie"
      : ["series", "tv", "show", "anime"].includes(input.type ?? "")
        ? "show"
        : !input.type && tmdb
          ? tmdb[1] === "movie"
            ? "movie"
            : "show"
          : !input.type && tvdb
            ? "show"
            : null;
  if (!type) return null;
  if (tmdb && tmdb[1] !== (type === "movie" ? "movie" : "tv")) return null;
  if (tvdb && type !== "show") return null;
  const imdb =
    /^(?:imdb:)?(tt\d+)$/.exec(input.imdbId ?? "") ?? /^(?:imdb:)?(tt\d+)$/.exec(input.id);
  if (imdb) return { idType: "imdb", id: imdb[1], type };
  if (tmdb) return { idType: "tmdb", id: tmdb[2], type };
  if (tvdb) return { idType: "tvdb", id: tvdb[1], type };
  return null;
}

export async function writeRefractWatchlist(
  key: string,
  id: string | number,
  on: boolean,
): Promise<"updated" | "protected"> {
  try {
    await request(key, `/watchlist/${encodeURIComponent(String(id))}`, on ? "PUT" : "DELETE");
    return "updated";
  } catch (error) {
    if (error instanceof RefractApiError && error.code === "IN_LIBRARY") return "protected";
    throw error;
  }
}

let watchlistMessage = "";
const WATCHLIST_EVENT = "harbor:refract-watchlist-changed";
export function refractWatchlistStatus(): string {
  return watchlistMessage;
}
export function subscribeRefractWatchlistStatus(fn: () => void): () => void {
  window.addEventListener(WATCHLIST_EVENT, fn);
  return () => window.removeEventListener(WATCHLIST_EVENT, fn);
}
function reportWatchlist(message: string): void {
  watchlistMessage = message;
  window.dispatchEvent(new Event(WATCHLIST_EVENT));
}
export function clearRefractWatchlistStatus(): void {
  reportWatchlist("");
}

/** Account/profile guards are rechecked after lookup, before writing membership. */
export async function syncRefractWatchlist(
  key: string,
  input: RefractWatchlistInput,
  on: boolean,
  assertCurrent: () => void,
): Promise<string | undefined> {
  try {
    assertCurrent();
    const identity = refractWatchlistIdentity(input);
    if (!identity) {
      const reason = "No verified IMDb/TMDB/TVDB identity is available for this title.";
      reportWatchlist(reason);
      return reason;
    }
    const matches = await lookupRefract(key, identity.idType, identity.id, identity.type);
    assertCurrent();
    const ids = [
      ...new Set(
        matches
          .filter((match) => match.type === identity.type && match.ids?.refract != null)
          .map((match) => String(match.ids!.refract)),
      ),
    ];
    if (ids.length !== 1 || !ids[0]) {
      const reason = "Refract could not uniquely identify this title.";
      reportWatchlist(reason);
      return reason;
    }
    const result = await writeRefractWatchlist(key, ids[0], on);
    assertCurrent();
    if (result === "protected") {
      reportWatchlist("Refract preserved an existing library entry or viewing history.");
      return;
    }
    reportWatchlist(on ? "Added to Refract Plan to Watch." : "Removed from Refract Plan to Watch.");
  } catch (error) {
    // Do not report an old account's result after a profile/key switch.
    assertCurrent();
    const reason =
      error instanceof RefractApiError && error.status === 403
        ? "Refract watchlist requires library:write. Reconnect with a key that has this scope."
        : "Refract could not confirm the watchlist change. Try again.";
    reportWatchlist(reason);
    return reason;
  }
}
