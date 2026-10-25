import { safeFetch } from "@/lib/safe-fetch";
import { recordAnimeCwId, recordAnilistMalAlias } from "@/lib/anime-cw-ids";
import {
  animeDbReadProvider,
  animeDbWriteProvider,
  animeDbWriteEntries,
  animeDbWriteEpisodes,
  type AnimeEntryRecord,
  type AnimeEpisodeRecord,
  type AnimeProviderRecord,
} from "@/lib/anime-identity-db";

const ENDPOINT = "https://api.ani.zip/mappings";
const GAP_MS = 90;
const NEG_TTL_MS = 120000;
const NEG_PERSIST_TTL_MS = 6 * 60 * 60 * 1000;
const INCOMPLETE_TTL_MS = 24 * 60 * 60 * 1000;
const COMPLETE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MEMORY_MAX = 512;
const cache = new Map<string, { value: AniZipMapping | null; expiresAt: number }>();
const negCache = new Map<string, number>();
const inflight = new Map<string, Promise<AniZipMapping | null>>();

function remember(query: string, value: AniZipMapping | null, expiresAt: number): void {
  cache.delete(query);
  cache.set(query, { value, expiresAt });
  while (cache.size > MEMORY_MAX) cache.delete(cache.keys().next().value!);
}

function rememberNegative(query: string, at: number): void {
  negCache.delete(query);
  negCache.set(query, at);
  while (negCache.size > MEMORY_MAX) negCache.delete(negCache.keys().next().value!);
}

let queue: Promise<unknown> = Promise.resolve();
function throttled(url: string, ac: AbortController): Promise<Response> {
  const run = queue.then(async () => {
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      return await safeFetch(url, { signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
  });
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  queue = Promise.race([settled, new Promise((r) => setTimeout(r, 5000))]).then(
    () => new Promise((r) => setTimeout(r, GAP_MS)),
  );
  return run;
}

export type AniZipEpisode = {
  seasonNumber?: number;
  episodeNumber: number;
  absoluteEpisodeNumber?: number;
  tvdbShowId?: number;
  tvdbId?: number;
  anidbEid?: number;
  airDate?: string;
  /** Newer entries publish the same date under a lowercase key. */
  airdate?: string;
  airDateUtc?: string;
  runtime?: number;
  overview?: string;
  image?: string;
  rating?: string;
  finaleType?: string;
  filler?: boolean;
  titles?: Record<string, string>;
  /** Older entries ship the same localized map under the singular key. */
  title?: Record<string, string>;
};

export type AniZipMapping = {
  titles?: Record<string, string>;
  episodes?: Record<string, AniZipEpisode>;
  mappings?: {
    anilist_id?: number;
    kitsu_id?: number;
    mal_id?: number;
    anidb_id?: number;
    thetvdb_id?: number;
    themoviedb_id?: number | string;
    imdb_id?: string;
  };
};

export async function aniZipByKitsu(kitsuId: number): Promise<AniZipMapping | null> {
  return get(`kitsu_id=${kitsuId}`);
}

export async function aniZipByAnilist(anilistId: number): Promise<AniZipMapping | null> {
  return get(`anilist_id=${anilistId}`);
}

export async function aniZipByMal(malId: number): Promise<AniZipMapping | null> {
  return get(`mal_id=${malId}`);
}

export async function aniZipByAnidb(anidbId: number): Promise<AniZipMapping | null> {
  return get(`anidb_id=${anidbId}`);
}

export async function aniZipByImdb(imdbId: string): Promise<AniZipMapping | null> {
  return get(`imdb_id=${imdbId}`);
}

export async function aniZipByTmdbTv(tmdbId: number): Promise<AniZipMapping | null> {
  return get(`themoviedb_id=${tmdbId}`);
}

const TIMEOUT_MS = 4000;

function persistMapping(query: string, value: AniZipMapping): void {
  const now = Date.now();
  const mappings = value.mappings;
  const episodes = value.episodes ?? {};
  const complete =
    !!mappings?.kitsu_id &&
    !!mappings?.thetvdb_id &&
    Object.keys(episodes).some((k) => /^\d+$/.test(k));
  // A series currently airing can gain new episode mappings every week, even
  // when its database IDs are already complete. Refresh those daily.
  const activelyAiring = Object.values(episodes).some((ep) => {
    const raw = ep.airDateUtc ?? ep.airDate ?? ep.airdate;
    const date = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(date) && date >= now - 45 * 86400000;
  });
  void animeDbWriteProvider({
    key: `anizip:${query}`,
    value,
    fetchedAt: now,
    expiresAt: now + (complete && !activelyAiring ? COMPLETE_TTL_MS : INCOMPLETE_TTL_MS),
  });
  captureExactAliases(query, value);
  // IMDb/TVDB ids are shared between seasons and specials: never store them
  // as an exact anime entry key.
  const ids = {
    anilist: mappings?.anilist_id,
    kitsu: mappings?.kitsu_id,
    mal: mappings?.mal_id,
    anidb: mappings?.anidb_id,
  };
  const rows: AnimeEntryRecord[] = Object.entries(ids)
    .filter(
      (item): item is [string, number] =>
        typeof item[1] === "number" && Number.isSafeInteger(item[1]) && item[1] > 0,
    )
    .map(([scheme, id]) => ({
      key: `${scheme}:${id}`,
      ids: ids as Record<string, number>,
      updatedAt: now,
    }));
  if (rows.length) void animeDbWriteEntries(rows);
  const prefix = mappings?.kitsu_id
    ? `kitsu:${mappings.kitsu_id}`
    : mappings?.anilist_id
      ? `anilist:${mappings.anilist_id}`
      : null;
  if (!prefix) return;
  const epRows: AnimeEpisodeRecord[] = Object.entries(episodes)
    .filter(([key]) => /^[1-9]\d*$/.test(key))
    .map(([key, ep]) => ({
      key: `${prefix}:${key}`,
      season: ep.seasonNumber ?? null,
      episode: ep.episodeNumber,
      absolute: ep.absoluteEpisodeNumber ?? null,
      tvdbId: ep.tvdbId ?? null,
    }));
  if (epRows.length) void animeDbWriteEpisodes(epRows);
}

function captureExactAliases(query: string, value: AniZipMapping): void {
  const mappings = value.mappings;
  if (!mappings) return;
  // Only explicit anime-entry queries establish exact aliases. Shared IMDb and
  // TVDB series queries can return an entirely different cour or special.
  const exactQuery = /^(anilist_id|mal_id|kitsu_id|anidb_id)=[1-9]\d*$/.test(query);
  if (exactQuery) {
    if (mappings.anilist_id && mappings.mal_id) {
      recordAnilistMalAlias(mappings.anilist_id, mappings.mal_id);
    }
    if (mappings.kitsu_id) {
      const canonical = `kitsu:${mappings.kitsu_id}`;
      if (mappings.anilist_id) recordAnimeCwId(`anilist:${mappings.anilist_id}`, canonical);
      if (mappings.mal_id) recordAnimeCwId(`mal:${mappings.mal_id}`, canonical);
      if (mappings.anidb_id) recordAnimeCwId(`anidb:${mappings.anidb_id}`, canonical);
    }
  }
}

async function get(query: string): Promise<AniZipMapping | null> {
  const memory = cache.get(query);
  if (memory && memory.expiresAt > Date.now()) return memory.value;
  if (memory) cache.delete(query);
  const negAt = negCache.get(query);
  if (negAt != null && Date.now() - negAt < NEG_TTL_MS) return null;
  const existing = inflight.get(query);
  if (existing) return existing;
  const p = (async () => {
    let stored: AnimeProviderRecord<AniZipMapping | null> | null = null;
    try {
      stored = await animeDbReadProvider<AniZipMapping | null>(`anizip:${query}`);
      if (stored && stored.expiresAt > Date.now()) {
        remember(query, stored.value, stored.expiresAt);
        if (stored.value) captureExactAliases(query, stored.value);
        return stored.value;
      }
      const ac = new AbortController();
      const res = await throttled(`${ENDPOINT}?${query}`, ac);
      if (!res.ok) {
        if (res.status === 404) {
          const fetchedAt = Date.now();
          remember(query, null, fetchedAt + NEG_TTL_MS);
          void animeDbWriteProvider({
            key: `anizip:${query}`,
            value: null,
            fetchedAt,
            expiresAt: fetchedAt + NEG_PERSIST_TTL_MS,
          });
        } else if (stored?.value) {
          // A provider outage must not make an already downloaded mapping
          // disappear just because its refresh TTL elapsed.
          remember(query, stored.value, Date.now() + NEG_TTL_MS);
          return stored.value;
        } else rememberNegative(query, Date.now());
        return null;
      }
      const json = (await res.json()) as AniZipMapping;
      const now = Date.now();
      const episodes = json.episodes ?? {};
      const complete =
        !!json.mappings?.kitsu_id &&
        !!json.mappings?.thetvdb_id &&
        Object.keys(episodes).some((k) => /^\d+$/.test(k));
      const airing = Object.values(episodes).some((ep) => {
        const date = Date.parse(ep.airDateUtc ?? ep.airDate ?? ep.airdate ?? "");
        return Number.isFinite(date) && date >= now - 45 * 86400000;
      });
      remember(query, json, now + (complete && !airing ? COMPLETE_TTL_MS : INCOMPLETE_TTL_MS));
      negCache.delete(query);
      persistMapping(query, json);
      return json;
    } catch {
      if (stored?.value) {
        remember(query, stored.value, Date.now() + NEG_TTL_MS);
        return stored.value;
      }
      rememberNegative(query, Date.now());
      return null;
    } finally {
      inflight.delete(query);
    }
  })();
  inflight.set(query, p);
  return p;
}

/** AniZip carries the localized title map under `titles` or, on older entries, `title`. */
export function episodeTitleMap(ep: AniZipEpisode | undefined): Record<string, string> | null {
  return ep?.titles ?? ep?.title ?? null;
}

export function pickEpisodeTitle(ep: AniZipEpisode | undefined): string | null {
  const map = episodeTitleMap(ep);
  if (!map) return null;
  return map.en ?? map["x-jat"] ?? map.ja ?? null;
}

export function pickLocalizedTitle(
  ep: AniZipEpisode | undefined,
  lang: string | null | undefined,
): string | null {
  const map = episodeTitleMap(ep);
  if (!map) return null;
  if (lang) {
    const exact = lang.trim();
    if (map[exact]) return map[exact];
    const base = exact.split("-")[0]?.toLowerCase() ?? "";
    if (base && map[base]) return map[base];
  }
  return map.en ?? map["x-jat"] ?? map.ja ?? null;
}
