import { lruSet } from "@/lib/cache";
import { registerCache } from "@/lib/memory-profiler";
import { episodeLanguageBase } from "@/lib/episode-text-language";
import { get } from "./tmdb/tmdb-client";
import { tmdbPosterUrl } from "./tmdb/tmdb-image-rungs";

type Poster = { file_path?: string; iso_639_1?: string | null; vote_average?: number };
const cache = new Map<string, { expires: number; posters: Poster[] }>();
const inflight = new Map<string, Promise<Poster[]>>();
const MAX_ENTRIES = 200;
registerCache("tmdb:seasonArtwork", () => cache.size);

export async function resolveSeasonArtworkTmdbId(
  key: string,
  metaId: string,
  imdbId?: string | null,
  tmdbTvId?: number | null,
): Promise<number | null> {
  const explicit = tmdbTvId ?? Number(/^tmdb:tv:(\d+)$/.exec(metaId)?.[1]);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const imdb = imdbId?.startsWith("tt") ? imdbId : /^tt\d+$/.test(metaId) ? metaId : null;
  if (!key || !imdb) return null;
  const data = await get<{ tv_results?: { id: number }[] }>(key, `find/${imdb}`, {
    external_source: "imdb_id",
  }).catch(() => null);
  const matches = data?.tv_results ?? [];
  const id = matches.length === 1 ? matches[0].id : null;
  return id != null && Number.isInteger(id) && id > 0 ? id : null;
}

export async function fetchTmdbSeasonPoster(
  key: string,
  tvId: number,
  season: number,
  lang: string,
  rejected: ReadonlySet<string> = new Set(),
): Promise<string | undefined> {
  if (!key || !Number.isInteger(tvId) || tvId <= 0 || !Number.isInteger(season) || season < 0)
    return undefined;
  const language = episodeLanguageBase(lang);
  const languages = [...new Set([language, "en", "null"])];
  const cacheKey = JSON.stringify([key, tvId, season, language]);
  const hit = cache.get(cacheKey);
  let posters: Poster[];
  if (hit && hit.expires > Date.now()) {
    posters = hit.posters;
  } else {
    let request = inflight.get(cacheKey);
    if (!request) {
      request = get<{ posters?: Poster[] }>(key, `tv/${tvId}/season/${season}/images`, {
        language,
        include_image_language: languages.join(","),
      })
        .catch(() => null)
        .then((data) => {
          const value = Array.isArray(data?.posters) ? data.posters : [];
          lruSet(
            cache,
            cacheKey,
            {
              expires: Date.now() + (data ? 10 * 60_000 : 60_000),
              posters: value,
            },
            MAX_ENTRIES,
          );
          return value;
        })
        .finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, request);
    }
    posters = await request;
  }
  const rank = (poster: Poster) => languages.indexOf(poster.iso_639_1 || "null");
  const candidates = posters
    .filter((poster) => rank(poster) >= 0 && poster.file_path)
    .slice()
    .sort((a, b) => rank(a) - rank(b) || (b.vote_average ?? 0) - (a.vote_average ?? 0));
  for (const candidate of candidates) {
    const url = tmdbPosterUrl(candidate.file_path);
    if (url && !rejected.has(url)) return url;
  }
  return undefined;
}
