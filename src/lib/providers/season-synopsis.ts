import { lruSet } from "@/lib/cache";
import { registerCache } from "@/lib/memory-profiler";
import { episodeLanguageBase } from "@/lib/episode-text-language";
import { get } from "./tmdb/tmdb-client";

export type SeasonSynopsis = { overview?: string; overviewLanguage?: string };
type Translation = {
  iso_639_1?: string;
  iso_3166_1?: string;
  data?: { overview?: string };
};
const cache = new Map<string, { expires: number; translations: Translation[] | null }>();
const inflight = new Map<string, Promise<Translation[] | null>>();
registerCache("tmdb:seasonSynopsis", () => cache.size);

/** Provider order breaks ties only after the requested language and English. */
export function selectSeasonSynopsis(
  lang: string,
  ...candidates: (SeasonSynopsis | null | undefined)[]
): SeasonSynopsis {
  for (const language of new Set([episodeLanguageBase(lang), "en"])) {
    const candidate = candidates.find(
      (value) =>
        typeof value?.overview === "string" &&
        value.overview.trim() &&
        typeof value.overviewLanguage === "string" &&
        episodeLanguageBase(value.overviewLanguage) === language,
    );
    if (candidate) return { overview: candidate.overview!.trim(), overviewLanguage: language };
  }
  return {};
}

/** Explicit translation records avoid mistaking an original-language fallback for a translation. */
export async function fetchTmdbSeasonSynopsis(
  key: string,
  tvId: number,
  season: number,
  lang: string,
): Promise<SeasonSynopsis | null> {
  if (!key || !Number.isInteger(tvId) || tvId <= 0 || !Number.isInteger(season) || season < 0)
    return {};
  const language = episodeLanguageBase(lang);
  const cacheKey = JSON.stringify([key, tvId, season, lang]);
  const hit = cache.get(cacheKey);
  let translations: Translation[] | null;
  if (hit && hit.expires > Date.now()) {
    translations = hit.translations;
  } else {
    let request = inflight.get(cacheKey);
    if (!request) {
      request = get<{ translations?: Translation[] }>(
        key,
        `tv/${tvId}/season/${season}/translations`,
        {
          language: lang.includes("-") ? lang : language,
        },
      )
        .catch(() => null)
        .then((data) => {
          const value = data ? (Array.isArray(data.translations) ? data.translations : []) : null;
          lruSet(
            cache,
            cacheKey,
            {
              expires: Date.now() + (data ? 10 * 60_000 : 60_000),
              translations: value,
            },
            200,
          );
          return value;
        })
        .finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, request);
    }
    translations = await request;
  }
  if (translations == null) return null;
  const region = lang.split("-")[1]?.toUpperCase();
  const candidates = translations
    .slice()
    .sort((a, b) => Number(b?.iso_3166_1 === region) - Number(a?.iso_3166_1 === region))
    .map((translation): SeasonSynopsis => {
      const overview =
        typeof translation?.data?.overview === "string" ? translation.data.overview : undefined;
      const code = typeof translation?.iso_639_1 === "string" ? translation.iso_639_1 : undefined;
      return {
        overview,
        // The record identifies the translation; proper names can use other scripts.
        overviewLanguage: code?.trim() ? episodeLanguageBase(code) : "und",
      };
    });
  return selectSeasonSynopsis(language, ...candidates);
}
