import { safeFetch } from "@/lib/safe-fetch";
import { kitsuToTvdb } from "./anime-mapping";
import { HARBOR_TVDB_BASE } from "@/lib/config/endpoints";
import { lruSet } from "@/lib/cache";

const PROXY = `${HARBOR_TVDB_BASE}/api/tvdb/images`;
const ART_PROXY = `${HARBOR_TVDB_BASE}/api/tvdb/artwork`;
const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
const TTL = 30 * 60_000;

async function cachedJson<T>(url: string): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const shared = inflight.get(url);
  if (shared) return shared as Promise<T | null>;
  const request = (async () => {
    try {
      const response = await safeFetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) return null;
      const value = (await response.json()) as T;
      if (value != null) lruSet(cache, url, { at: Date.now(), value }, 120);
      return value;
    } catch {
      return null;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, request);
  return request;
}

export type TvdbImageMap = Record<string, string>;

export type TvdbArtwork = { backgrounds: string[]; clearLogos: string[]; posters: string[] };

export async function fetchTvdbArtwork(opts: {
  imdb?: string | null;
  kitsuId?: number | null;
  series?: number | null;
}): Promise<TvdbArtwork> {
  const empty: TvdbArtwork = { backgrounds: [], clearLogos: [], posters: [] };
  let series: number | null = opts.series ?? null;
  if (series == null && opts.kitsuId != null) {
    series = await kitsuToTvdb(opts.kitsuId).catch(() => null);
  }
  const q = new URLSearchParams();
  if (series) q.set("series", String(series));
  else if (opts.imdb && opts.imdb.startsWith("tt")) q.set("imdb", opts.imdb);
  else return empty;
  try {
    const j = await cachedJson<Partial<TvdbArtwork>>(`${ART_PROXY}?${q.toString()}`);
    return {
      backgrounds: j?.backgrounds ?? [],
      clearLogos: j?.clearLogos ?? [],
      posters: j?.posters ?? [],
    };
  } catch {
    return empty;
  }
}

export async function fetchTvdbProxyImages(opts: {
  imdb?: string | null;
  kitsuId?: number | null;
  series?: number | null;
  type?: string;
}): Promise<TvdbImageMap> {
  let series: number | null = opts.series ?? null;
  if (series == null && opts.kitsuId != null)
    series = await kitsuToTvdb(opts.kitsuId).catch(() => null);
  const q = new URLSearchParams();
  if (series) q.set("series", String(series));
  else if (opts.imdb && opts.imdb.startsWith("tt")) q.set("imdb", opts.imdb);
  else return {};
  q.set("type", opts.type && opts.type !== "aired" ? opts.type : "default");
  try {
    const j = await cachedJson<{ images?: TvdbImageMap }>(`${PROXY}?${q.toString()}`);
    return j?.images ?? {};
  } catch {
    return {};
  }
}

export function pickTvdbImage(
  map: TvdbImageMap,
  ep: {
    seasonNumber?: number;
    number: number;
    absoluteNumber?: number;
    imdbSeason?: number;
    imdbEpisode?: number;
  },
): string | null {
  // TVDB specials share absolute-number placeholders, so only their exact
  // season/episode pair can identify artwork.
  if ((ep.imdbSeason ?? ep.seasonNumber) === 0) {
    return map[`s0e${ep.imdbEpisode ?? ep.number}`] ?? null;
  }
  const abs = ep.absoluteNumber;
  // A sequel cour's entry-local numbers restart at 1 while its IMDb identity
  // points at a later season (Kitsu labels every cour "season 1"), so the
  // seasonNumber:number pair would resolve to the first season's episode.
  const localPairUsable =
    ep.seasonNumber != null &&
    (ep.imdbSeason == null || ep.imdbSeason === ep.seasonNumber) &&
    (ep.imdbEpisode == null || ep.imdbEpisode === ep.number);
  return (
    (ep.imdbSeason != null && ep.imdbEpisode != null
      ? map[`s${ep.imdbSeason}e${ep.imdbEpisode}`]
      : undefined) ??
    (abs != null && Number.isInteger(abs) && abs > 0 ? map[`abs${abs}`] : undefined) ??
    (localPairUsable ? map[`s${ep.seasonNumber}e${ep.number}`] : undefined) ??
    null
  );
}
