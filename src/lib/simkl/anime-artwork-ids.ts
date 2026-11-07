import { lruSet } from "@/lib/cache";
import { getLocalCache } from "./activities/store";

export type SimklAnimeArtworkIds = {
  kitsu?: number;
  mal?: number;
  anidb?: number;
  imdb?: string;
  tvdb?: number;
  tmdb?: number;
};

const CACHE_MAX = 500;
const resolved = new Map<number, SimklAnimeArtworkIds>();
const inflight = new Map<number, Promise<SimklAnimeArtworkIds>>();

type SimklAnimeDetail = {
  ids?: {
    kitsu?: number | string;
    mal?: number;
    anidb?: number;
    imdb?: string;
    tvdb?: number;
    tmdb?: number | string;
  };
};

function reverseSimklKey(map: Record<string, number>, simklId: number): string | undefined {
  return Object.keys(map).find((key) => map[key] === simklId);
}

async function resolveSimklAnimeArtworkIds(simklId: number): Promise<SimklAnimeArtworkIds> {
  const out: SimklAnimeArtworkIds = {};
  const cache = getLocalCache();
  if (cache) {
    const kitsu = reverseSimklKey(cache.kitsuToSimkl, simklId);
    const mal = reverseSimklKey(cache.malToSimkl, simklId);
    const imdb = reverseSimklKey(cache.imdbToSimkl, simklId);
    const tmdb = reverseSimklKey(cache.tmdbToSimkl, simklId);
    const kitsuId = Number(kitsu);
    const malId = Number(mal);
    const tmdbId = tmdb ? /^(?:movie|tv):(\d+)$/.exec(tmdb)?.[1] : undefined;
    if (Number.isFinite(kitsuId) && kitsuId > 0) out.kitsu = kitsuId;
    if (Number.isFinite(malId) && malId > 0) out.mal = malId;
    if (imdb?.startsWith("tt")) out.imdb = imdb;
    if (tmdbId) out.tmdb = Number(tmdbId);
  }

  if (out.kitsu || out.mal || out.imdb || out.tvdb || out.tmdb) return out;

  const { simklRequest } = await import("./client");
  const detail = await simklRequest<SimklAnimeDetail>(`/anime/${simklId}`, {
    method: "GET",
    authed: false,
  }).catch(() => null);
  const ids = detail?.ids;
  const kitsuId = Number(ids?.kitsu);
  const tmdbId = Number(ids?.tmdb);
  if (Number.isFinite(kitsuId) && kitsuId > 0) out.kitsu = kitsuId;
  if (typeof ids?.mal === "number") out.mal = ids.mal;
  if (typeof ids?.anidb === "number") out.anidb = ids.anidb;
  if (ids?.imdb?.startsWith("tt")) out.imdb = ids.imdb;
  if (typeof ids?.tvdb === "number") out.tvdb = ids.tvdb;
  if (Number.isFinite(tmdbId) && tmdbId > 0) out.tmdb = tmdbId;
  return out;
}

/**
 * Resolve the artwork ids Harbor needs from a Simkl anime id. The activity
 * cache knows the mappings for titles the user has already synced; otherwise
 * Simkl's public anime endpoint fills in the rest. Results are cached because
 * a home rail can mount the same franchise in several places at once.
 */
export function simklAnimeArtworkIds(simklId: number): Promise<SimklAnimeArtworkIds> {
  const hit = resolved.get(simklId);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(simklId);
  if (pending) return pending;
  const request = resolveSimklAnimeArtworkIds(simklId)
    .then((ids) => {
      if (ids.kitsu || ids.mal || ids.imdb || ids.tvdb || ids.tmdb) {
        lruSet(resolved, simklId, ids, CACHE_MAX);
      }
      return ids;
    })
    .finally(() => {
      inflight.delete(simklId);
    });
  inflight.set(simklId, request);
  return request;
}
