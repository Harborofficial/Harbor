import { effectiveTmdbLanguage, get } from "./tmdb-client";
import { lruSet } from "../../cache";
import { loadStoredSettings } from "../../settings/load";
import { tmdbBackdropUrl, tmdbPosterUrl } from "./tmdb-image-rungs";
import {
  pickTmdbTitle,
  tmdbEnglishTitle,
  tmdbLanguageBase,
  type TmdbTranslations,
} from "./tmdb-title-fallback";

export type TmdbLiteMeta = {
  name: string | null;
  poster: string | null;
  background: string | null;
};

const cache = new Map<string, TmdbLiteMeta | null>();
const inflight = new Map<string, Promise<TmdbLiteMeta | null>>();

type RawLite = {
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  original_language?: string;
  translations?: TmdbTranslations;
  poster_path?: string | null;
  backdrop_path?: string | null;
};

const overviewCache = new Map<string, string>();
const overviewInflight = new Map<string, Promise<string | undefined>>();
export async function tmdbMetadataOverview(
  key: string,
  metaId: string,
  language = effectiveTmdbLanguage() || "en",
): Promise<string | undefined> {
  if (!key) return undefined;
  const m = metaId.match(/^tmdb:(movie|tv):(\d+)$/);
  if (!m) return undefined;
  const cacheKey = `${key}|${metaId}|${language}`;
  const hit = overviewCache.get(cacheKey);
  if (hit !== undefined) return hit || undefined;
  const pending = overviewInflight.get(cacheKey);
  if (pending) return pending;
  const request = get<{ overview?: string }>(key, `${m[1]}/${m[2]}`, { language })
    .then((raw) => {
      if (!raw) return undefined;
      const overview = raw.overview?.trim() || "";
      lruSet(overviewCache, cacheKey, overview, 300);
      return overview || undefined;
    })
    .catch(() => undefined)
    .finally(() => overviewInflight.delete(cacheKey));
  overviewInflight.set(cacheKey, request);
  return request;
}

export async function tmdbLiteMeta(key: string, metaId: string): Promise<TmdbLiteMeta | null> {
  if (!key) return null;
  const match = metaId.match(/^tmdb:(movie|tv):(\d+)$/);
  if (!match) return null;
  const language = effectiveTmdbLanguage();
  const translateTitles = loadStoredSettings().translateTitles;
  const cacheKey = `${metaId}|${language}|${translateTitles}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;
  const existing = inflight.get(cacheKey);
  if (existing) return existing;
  const p = (async () => {
    try {
      const languageBase = tmdbLanguageBase(language);
      const wantsEnglishFallback = translateTitles && !!languageBase && languageBase !== "en";
      const raw = await get<RawLite>(
        key,
        `${match[1]}/${match[2]}`,
        wantsEnglishFallback ? { append_to_response: "translations" } : {},
      );
      const localized = raw?.title ?? raw?.name ?? "";
      const original = raw?.original_title ?? raw?.original_name ?? "";
      const name = raw
        ? pickTmdbTitle({
            localized,
            original,
            english: tmdbEnglishTitle(raw.translations),
            originalLanguage: raw.original_language,
            targetLanguage: language,
            translateTitles,
          })
        : "";
      const out: TmdbLiteMeta | null = raw
        ? {
            name: name.trim() || null,
            poster: tmdbPosterUrl(raw.poster_path) ?? null,
            background: tmdbBackdropUrl(raw.backdrop_path) ?? null,
          }
        : null;
      cache.set(cacheKey, out);
      return out;
    } catch {
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();
  inflight.set(cacheKey, p);
  return p;
}
