import { lruSet } from "@/lib/cache";
import { registerCache } from "@/lib/memory-profiler";
import { safeFetch as tauriFetch } from "@/lib/safe-fetch";
import { HARBOR_TVDB_BASE } from "@/lib/config/endpoints";
import { episodeTextLanguage } from "@/lib/episode-text-language";
import {
  cachedMedia,
  saveMedia,
  episodeCacheTtl,
  metadataCacheTtl,
  MEDIA_TTL,
  onMediaCacheClear,
  mediaCacheGeneration,
} from "@/lib/media-cache";

const BASE = "https://api4.thetvdb.com/v4";
const PROXY_V4 = `${HARBOR_TVDB_BASE}/api/tvdb/v4`;
const TOKEN_KEY = "harbor.tvdb.token.v1";
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

function tvdbImg(v: unknown): string | undefined {
  if (typeof v !== "string" || !v) return undefined;
  if (v.startsWith("http")) return v;
  return `https://artworks.thetvdb.com${v.startsWith("/") ? "" : "/"}${v}`;
}

export function isDisplayableName(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (
      (c >= 0x3040 && c <= 0x30ff) ||
      (c >= 0x3400 && c <= 0x9fff) ||
      (c >= 0xac00 && c <= 0xd7af)
    )
      return false;
  }
  return true;
}

type TokenCache = { token: string; t: number; key: string };

type SearchHit = {
  tvdb_id?: string;
  name?: string;
  type?: string;
  series?: { id?: number; name?: string };
  movie?: { id?: number; name?: string };
};

function seriesIdFromRemote(data: SearchHit[]): number | null {
  const hit =
    data.find((h) => h.series?.id != null) ?? data.find((h) => h.type === "series") ?? data[0];
  const raw = hit?.series?.id ?? hit?.tvdb_id;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export type TvdbEpisode = {
  id: number;
  number: number;
  seasonNumber: number;
  absoluteNumber?: number;
  name?: string;
  overview?: string;
  nameLanguage?: string;
  overviewLanguage?: string;
  aired?: string;
  runtime?: number;
  image?: string;
  imdbId?: string;
};

export type TvdbSeries = {
  id: number;
  name: string;
  slug?: string;
  overview?: string;
  network?: string;
  status?: string;
  firstAired?: string;
  lastAired?: string;
  averageRuntime?: number;
  aliases: string[];
  originalLanguage?: string;
  originalCountry?: string;
};

let tokenInflight: Promise<string | null> | null = null;
let cachedToken: TokenCache | null = null;

function loadCachedToken(): TokenCache | null {
  if (cachedToken) return cachedToken;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    cachedToken = JSON.parse(raw) as TokenCache;
    return cachedToken;
  } catch {
    return null;
  }
}

function saveCachedToken(tc: TokenCache) {
  cachedToken = tc;
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tc));
  } catch {
    /* ignore */
  }
}

async function getToken(apiKey: string): Promise<string | null> {
  if (!apiKey) return null;
  const cached = loadCachedToken();
  if (cached && cached.key === apiKey && Date.now() - cached.t < TOKEN_TTL_MS) {
    return cached.token;
  }
  if (tokenInflight) return tokenInflight;
  tokenInflight = (async () => {
    try {
      const res = await tauriFetch(`${BASE}/login`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ apikey: apiKey }),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { data?: { token?: string } };
      const token = j?.data?.token;
      if (!token) return null;
      saveCachedToken({ token, t: Date.now(), key: apiKey });
      return token;
    } catch {
      return null;
    } finally {
      tokenInflight = null;
    }
  })();
  return tokenInflight;
}

const RESPONSE_CACHE_MAX = 200;
// Providers correct episode data shortly after an episode airs (a "TBA"
// placeholder becomes the real name), so cached responses expire instead of
// pinning stale titles for the lifetime of a long-running session.
const RESPONSE_TTL_MS = 10 * 60 * 1000;
const responseCache = new Map<string, { t: number; v: unknown }>();
const responseInflight = new Map<string, Promise<unknown>>();
onMediaCacheClear(() => {
  responseCache.clear();
  responseInflight.clear();
});

registerCache("tvdb:response", () => responseCache.size);

async function getJson<T>(apiKey: string, path: string): Promise<T | null> {
  // Paginated catalogs are persisted only after every page succeeds.
  if (path.includes("/episodes/")) return fetchJson<T>(apiKey, path);
  return cachedMedia("tvdb-resource", [apiKey, path], () => fetchJson<T>(apiKey, path), {
    ttl: (value) => {
      if (!/\/seasons\//.test(path)) return metadataCacheTtl(value);
      const season = value as {
        image?: string;
        artwork?: unknown[];
        name?: string;
        overview?: string;
      };
      const populated = path.includes("/translations/")
        ? !!(season.name?.trim() || season.overview?.trim())
        : !!season.image || (Array.isArray(season.artwork) && season.artwork.length > 0);
      return populated ? MEDIA_TTL.settled : MEDIA_TTL.recent;
    },
  });
}

async function fetchJson<T>(apiKey: string, path: string): Promise<T | null> {
  const generation = mediaCacheGeneration();
  const useProxy = !apiKey;
  const key = JSON.stringify([apiKey, path]);
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.t < RESPONSE_TTL_MS) return hit.v as T;
  const existing = responseInflight.get(key);
  if (existing) return existing as Promise<T | null>;
  const p = (async (): Promise<T | null> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let url: string;
      let headers: Record<string, string>;
      if (useProxy) {
        url = `${PROXY_V4}${path}`;
        headers = { accept: "application/json" };
      } else {
        const token = await getToken(apiKey);
        if (!token) return null;
        url = `${BASE}${path}`;
        headers = { authorization: `Bearer ${token}`, accept: "application/json" };
      }
      try {
        const res = await tauriFetch(url, { headers });
        if (!useProxy && res.status === 401) {
          cachedToken = null;
          try {
            localStorage.removeItem(TOKEN_KEY);
          } catch {
            /* ignore */
          }
          if (attempt === 0) continue;
          return null;
        }
        if (res.status >= 500 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 350));
          continue;
        }
        if (!res.ok) return null;
        const j = (await res.json()) as { data?: T };
        const data = (j?.data ?? null) as T | null;
        if (data !== null)
          if (generation === mediaCacheGeneration())
            lruSet(responseCache, key, { t: Date.now(), v: data }, RESPONSE_CACHE_MAX);
        return data;
      } catch {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 350));
          continue;
        }
        return null;
      }
    }
    return null;
  })().finally(() => {
    if (responseInflight.get(key) === p) responseInflight.delete(key);
  });
  responseInflight.set(key, p as Promise<unknown>);
  return p;
}

export async function tvdbSeriesByImdb(apiKey: string, imdbId: string): Promise<number | null> {
  if (!imdbId.startsWith("tt")) return null;
  const data = await getJson<SearchHit[]>(apiKey, `/search/remoteid/${imdbId}`);
  if (!data) return null;
  return seriesIdFromRemote(data);
}

export async function tvdbSeriesByRemote(apiKey: string, remoteId: string): Promise<number | null> {
  if (!remoteId) return null;
  const data = await getJson<SearchHit[]>(apiKey, `/search/remoteid/${remoteId}`);
  if (!data) return null;
  return seriesIdFromRemote(data);
}

export async function tvdbSeries(apiKey: string, seriesId: number): Promise<TvdbSeries | null> {
  if (!seriesId) return null;
  const data = await getJson<any>(
    apiKey,
    `/series/${seriesId}/extended?meta=translations&short=false`,
  );
  if (!data) return null;
  const aliases: string[] = Array.from(
    new Set((data.aliases ?? []).map((a: any) => a?.name).filter(Boolean) as string[]),
  );
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    overview: data.overview,
    network: data.originalNetwork?.name ?? data.latestNetwork?.name,
    status: data.status?.name,
    firstAired: data.firstAired,
    lastAired: data.lastAired,
    averageRuntime: data.averageRuntime,
    aliases,
    originalLanguage: data.originalLanguage,
    originalCountry: data.originalCountry,
  };
}

export type TvdbOrderType =
  | "aired"
  | "dvd"
  | "absolute"
  | "tvdbabsolute"
  | "alternate"
  | "regional";
export type TvdbSeasonTypeOption = { value: TvdbOrderType; label: string };

const ORDER_PRIORITY: TvdbOrderType[] = [
  "aired",
  "dvd",
  "absolute",
  "tvdbabsolute",
  "alternate",
  "regional",
];

export function defaultOrderLabel(value: TvdbOrderType): string {
  const map: Record<TvdbOrderType, string> = {
    aired: "Aired Order",
    dvd: "DVD Order",
    absolute: "Absolute Order",
    tvdbabsolute: "TVDB Absolute Order",
    alternate: "Alternate Order",
    regional: "Regional Order",
  };
  return map[value];
}

export async function tvdbSeasonTypes(
  apiKey: string,
  seriesId: number,
): Promise<TvdbSeasonTypeOption[]> {
  if (!seriesId) return [];
  const data = await getJson<any>(apiKey, `/series/${seriesId}/extended?short=true`);
  const seasons = (data?.seasons ?? []) as any[];
  const labels = new Map<TvdbOrderType, string>();
  for (const s of seasons) {
    const slug = s?.type?.type as string | undefined;
    if (!slug) continue;
    const value = (slug === "official" ? "aired" : slug) as TvdbOrderType;
    if (!ORDER_PRIORITY.includes(value)) continue;
    if (!labels.has(value))
      labels.set(value, (s?.type?.name as string) || defaultOrderLabel(value));
  }
  if (labels.has("absolute")) labels.set("tvdbabsolute", defaultOrderLabel("tvdbabsolute"));
  return ORDER_PRIORITY.filter((v) => labels.has(v)).map((v) => ({
    value: v,
    label: labels.get(v)!,
  }));
}

export type TvdbSeasonInfo = {
  id: number | null;
  number: number;
  seriesId?: number;
  typeSlug?: string;
  /** Display name. The proxy already resolves this in English for /series/extended. */
  name: string;
  /** Overview from the same response; the proxy localizes it with overviewLang. */
  overview?: string;
  overviewLanguage?: string;
  image?: string;
};

export async function tvdbSeasons(
  apiKey: string,
  seriesId: number,
  typeSlug: string,
  lang?: string,
): Promise<Map<number, TvdbSeasonInfo>> {
  const map = new Map<number, TvdbSeasonInfo>();
  if (!seriesId) return map;
  const overviewLang = !apiKey.trim() && lang ? `&overviewLang=${encodeURIComponent(lang)}` : "";
  const data = await getJson<any>(apiKey, `/series/${seriesId}/extended?short=true${overviewLang}`);
  const seasons = (data?.seasons ?? []) as any[];
  for (const s of seasons) {
    if (s?.type?.type !== typeSlug) continue;
    const num = typeof s.number === "number" ? s.number : null;
    if (num == null) continue;
    const name = typeof s.name === "string" ? s.name.trim() : "";
    const overview = typeof s.overview === "string" ? s.overview.trim() || undefined : undefined;
    const id = typeof s.id === "number" ? s.id : null;
    // TVDB can pack several codes into one entry, e.g. ["eng,tur,fra"].
    const overviewTranslations = Array.isArray(s.overviewTranslations)
      ? s.overviewTranslations.flatMap((value: unknown) =>
          typeof value === "string"
            ? value
                .split(",")
                .map((code) => code.trim())
                .filter(Boolean)
            : [],
        )
      : undefined;
    const overviewLanguage =
      !apiKey.trim() && lang
        ? episodeTextLanguage(overview, lang, undefined, overviewTranslations)
        : "und";
    map.set(num, {
      id,
      number: num,
      seriesId,
      typeSlug,
      name,
      overview,
      overviewLanguage,
      image: pickSeasonPoster({ baseImage: s.image }),
    });
  }
  return map;
}

export type TvdbSeasonText = { name?: string; overview?: string };

export async function tvdbSeasonText(
  apiKey: string,
  seasonId: number,
  lang: string,
): Promise<TvdbSeasonText | null> {
  if (!seasonId || !lang) return null;
  const data = await getJson<{ name?: unknown; overview?: unknown }>(
    apiKey,
    `/seasons/${seasonId}/translations/${lang}`,
  );
  if (!data) return null;
  return {
    name: typeof data.name === "string" ? data.name.trim() || undefined : undefined,
    overview: typeof data.overview === "string" ? data.overview.trim() || undefined : undefined,
  };
}

export async function tvdbSeasonTranslation(
  apiKey: string,
  seasonId: number,
  lang: string,
): Promise<string | null> {
  return (await tvdbSeasonText(apiKey, seasonId, lang))?.name ?? null;
}

export function tvdbBaseSeasonNames(
  infos: ReadonlyMap<number, TvdbSeasonInfo>,
): Map<number, string> {
  const names = new Map<number, string>();
  for (const info of infos.values()) {
    if (info.number >= 0 && info.name && isDisplayableName(info.name))
      names.set(info.number, info.name);
  }
  return names;
}

export async function tvdbSeasonNames(
  apiKey: string,
  seriesId: number,
  typeSlug: string,
  lang?: string,
): Promise<Map<number, string>> {
  const infos = await tvdbSeasons(apiKey, seriesId, typeSlug, lang);
  // The proxy does not expose /seasons/*; it already enriches
  // /series/extended with the English season names.
  if (!apiKey.trim()) return tvdbBaseSeasonNames(infos);
  const names = new Map<number, string>();
  // Resolve English names with bounded concurrency for long-running series.
  const pending = [...infos.values()].filter((info) => info.number >= 0 && info.id != null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (next < pending.length) {
        const info = pending[next++];
        const name = await tvdbSeasonTranslation(apiKey, info.id!, "eng").catch(() => null);
        if (name && isDisplayableName(name)) names.set(info.number, name);
      }
    }),
  );
  return names;
}

export type TvdbSeasonArtwork = {
  seasonId?: number | null;
  width?: number | null;
  height?: number | null;
  image?: unknown;
  thumbnail?: unknown;
  language?: string | null;
  type?: number | null;
  score?: number | null;
  includesText?: boolean | null;
};

/** The proxy exposes season posters through series artwork, scoped by season ID. */
export async function tvdbSeriesSeasonArtwork(
  apiKey: string,
  seriesId: number,
  seasonId: number,
): Promise<TvdbSeasonArtwork[]> {
  if (!seriesId || !seasonId) return [];
  const data = await getJson<{ artworks?: TvdbSeasonArtwork[] }>(
    apiKey,
    `/series/${seriesId}/extended`,
  );
  return (Array.isArray(data?.artworks) ? data.artworks : []).filter(
    (art) => art && Number(art.seasonId) === seasonId && Number(art.type) === 7,
  );
}

export async function tvdbSeasonExtended(
  apiKey: string,
  seasonId: number,
): Promise<{
  image?: string;
  name?: string;
  overview?: string;
  artwork: TvdbSeasonArtwork[];
} | null> {
  if (!seasonId) return null;
  const data = await getJson<any>(apiKey, `/seasons/${seasonId}/extended`);
  if (!data) return null;
  const artwork = Array.isArray(data.artwork) ? (data.artwork as TvdbSeasonArtwork[]) : [];
  return {
    image: tvdbImg(data.image),
    name: typeof data.name === "string" ? data.name.trim() || undefined : undefined,
    overview: typeof data.overview === "string" ? data.overview.trim() || undefined : undefined,
    artwork,
  };
}

function normArtLang(v: unknown): string {
  return (typeof v === "string" ? v : "").trim().toLowerCase();
}

function seasonPosterImage(image: unknown, width?: number | null, height?: number | null) {
  const url = tvdbImg(image);
  if (!url || /\/(?:backgrounds|fanart|icons|clearlogos?)\//i.test(url)) return undefined;
  if (Number(width) > 0 && Number(height) > 0 && Number(width) >= Number(height)) return undefined;
  return url;
}

/**
 * Pick a season poster in the requested metadata language, falling back to
 * English. TVDB artwork carries a 3-letter `language` (e.g. `fra`, `eng`)
 * and `type === 7` for season posters (`2` for series posters).
 * Wrong-language text posters are avoided:
 * after `lang` -> `eng` we prefer textless/neutral art, then the season's
 * default image, and only then any poster rather than nothing.
 */
export function pickSeasonPoster(opts: {
  artwork?: TvdbSeasonArtwork[] | null;
  extendedImage?: unknown;
  baseImage?: unknown;
  lang?: string | null;
}): string | undefined {
  const langNorm = normArtLang(opts.lang) || "eng";
  const candidates = (opts.artwork ?? []).filter(
    (a) => a && [2, 7].includes(Number(a.type)) && seasonPosterImage(a.image, a.width, a.height),
  );
  // Prefer true season posters. Type 2 is a series poster, so it should only
  // stand in when TVDB has no season artwork at all.
  const seasonPosters = candidates.filter((a) => Number(a.type) === 7);
  const posters = (
    seasonPosters.length > 0 ? seasonPosters : candidates.filter((a) => Number(a.type) === 2)
  )
    .slice()
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const byLang = (code: string) => posters.find((a) => normArtLang(a.language) === code);
  const langHit = byLang(langNorm)?.image;
  if (typeof langHit === "string" && langHit) return tvdbImg(langHit);
  if (langNorm !== "eng") {
    const engHit = byLang("eng")?.image;
    if (typeof engHit === "string" && engHit) return tvdbImg(engHit);
  }
  const textlessHit = posters.find((a) => a.includesText === false)?.image;
  if (typeof textlessHit === "string" && textlessHit) return tvdbImg(textlessHit);
  const neutralHit = posters.find((a) => !normArtLang(a.language))?.image;
  if (typeof neutralHit === "string" && neutralHit) return tvdbImg(neutralHit);
  return (
    seasonPosterImage(opts.extendedImage) ??
    seasonPosterImage(opts.baseImage) ??
    tvdbImg(posters[0]?.image)
  );
}

export async function tvdbEpisodes(
  apiKey: string,
  seriesId: number,
  season: number,
  lang?: string,
): Promise<TvdbEpisode[]> {
  if (!seriesId) return [];
  const langSeg = lang ? `&language=${lang}` : "";
  const data = await getJson<any>(
    apiKey,
    `/series/${seriesId}/episodes/default?season=${season}${langSeg}`,
  );
  const arr = data?.episodes ?? [];
  return (arr as any[])
    .filter((e) => typeof e.number === "number" && typeof e.seasonNumber === "number")
    .map((e) => ({
      id: e.id,
      number: e.number,
      seasonNumber: e.seasonNumber,
      name: e.name,
      overview: e.overview,
      nameLanguage: lang ? episodeTextLanguage(e.name, lang, undefined, e.nameTranslations) : "und",
      overviewLanguage: lang
        ? episodeTextLanguage(e.overview, lang, undefined, e.overviewTranslations)
        : "und",
      aired: e.aired,
      runtime: e.runtime,
      image: tvdbImg(e.image),
      imdbId: undefined,
    }));
}

const ISO1_TO_TVDB: Record<string, string> = {
  en: "eng",
  es: "spa",
  fr: "fra",
  de: "deu",
  it: "ita",
  ja: "jpn",
  ko: "kor",
  ru: "rus",
  pt: "por",
  zh: "zho",
  ar: "ara",
  nl: "nld",
  pl: "pol",
  tr: "tur",
  sv: "swe",
  da: "dan",
  fi: "fin",
  no: "nor",
  cs: "ces",
  hu: "hun",
  el: "ell",
  he: "heb",
  th: "tha",
  vi: "vie",
  id: "ind",
  uk: "ukr",
  ro: "ron",
  hi: "hin",
};

export function tvdbLangFromIso1(iso1: string | null | undefined): string {
  const short = (iso1 ?? "").split("-")[0].toLowerCase();
  return ISO1_TO_TVDB[short] ?? "eng";
}

export async function tvdbEpisodesByType(
  apiKey: string,
  seriesId: number,
  seasonType: string,
  lang?: string,
): Promise<TvdbEpisode[]> {
  if (!seriesId) return [];
  const generation = mediaCacheGeneration();
  const episodes = await cachedMedia(
    "tvdb-episodes",
    [apiKey, seriesId, seasonType, lang ?? "und"],
    () => fetchEpisodesByType(apiKey, seriesId, seasonType, lang),
    {
      ttl: (rows) => (rows.length ? episodeCacheTtl(rows) : 60_000),
      valid: (rows) =>
        Array.isArray(rows) &&
        rows.every(
          (row) =>
            row &&
            Number.isFinite(row.id) &&
            Number.isFinite(row.number) &&
            Number.isFinite(row.seasonNumber),
        ),
    },
  );
  if (!episodes) throw new Error("TVDB episode catalog unavailable");
  if (!lang)
    void saveMedia(
      "tvdb-availability",
      [apiKey, seriesId, seasonType],
      episodes.length > 0,
      { ttl: episodes.length ? MEDIA_TTL.episodes : 60_000 },
      undefined,
      generation,
    ).catch(() => {});
  return episodes;
}

async function fetchEpisodesByType(
  apiKey: string,
  seriesId: number,
  seasonType: string,
  lang?: string,
): Promise<TvdbEpisode[]> {
  const out: TvdbEpisode[] = [];
  const langSeg = lang ? `/${lang}` : "";
  for (let page = 0; page < 20; page++) {
    const data = await getJson<any>(
      apiKey,
      `/series/${seriesId}/episodes/${seasonType}${langSeg}?page=${page}`,
    );
    if (!data || !Array.isArray(data.episodes)) throw new Error("Incomplete TVDB episode catalog");
    const arr = data.episodes as any[];
    if (arr.length === 0) return out;
    for (const e of arr) {
      // A single malformed special/translation row must not discard the rest
      // of the catalog; skip it and keep the usable episodes.
      if (!e || !Number.isFinite(e.number) || !Number.isFinite(e.id)) continue;
      out.push({
        id: e.id,
        number: e.number,
        seasonNumber: typeof e.seasonNumber === "number" ? e.seasonNumber : 0,
        absoluteNumber:
          typeof e.absoluteNumber === "number" && Number.isFinite(e.absoluteNumber)
            ? e.absoluteNumber
            : undefined,
        name: e.name,
        overview: e.overview,
        nameLanguage: lang
          ? episodeTextLanguage(e.name, lang, undefined, e.nameTranslations)
          : "und",
        overviewLanguage: lang
          ? episodeTextLanguage(e.overview, lang, undefined, e.overviewTranslations)
          : "und",
        aired: e.aired,
        runtime: e.runtime,
        image: tvdbImg(e.image),
      });
    }
    if (arr.length < 500) return out;
  }
  throw new Error("TVDB episode pagination limit reached");
}

export async function tvdbOrderTypeHasEpisodes(
  apiKey: string,
  seriesId: number,
  seasonType: string,
): Promise<boolean> {
  if (!seriesId) return false;
  const slug =
    seasonType === "aired" || seasonType === "absolute"
      ? "default"
      : seasonType === "tvdbabsolute"
        ? "absolute"
        : seasonType;
  return (
    (await cachedMedia(
      "tvdb-availability",
      [apiKey, seriesId, slug],
      async () => {
        const data = await getJson<any>(apiKey, `/series/${seriesId}/episodes/${slug}?page=0`);
        return Array.isArray(data?.episodes) ? data.episodes.length > 0 : null;
      },
      { ttl: (available) => (available ? MEDIA_TTL.episodes : 60_000) },
    )) ?? false
  );
}

export async function tvdbEpisodesAbsolute(
  apiKey: string,
  seriesId: number,
  lang?: string,
): Promise<TvdbEpisode[]> {
  return tvdbEpisodesByType(apiKey, seriesId, "absolute", lang);
}
