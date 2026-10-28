import type { Meta } from "../../cinemeta";
import { effectiveTmdbLanguage, get } from "./tmdb-client";
import {
  movieMeta,
  seriesMeta,
  type Page,
  type RawMovie,
  type RawSeries,
} from "./tmdb-meta-mappers";
import { loadStoredSettings } from "../../settings/load";
import { shouldUseEnglishTitle } from "./tmdb-title-fallback";

// When "Translate titles" is off, request TMDB in English so row titles are
// the untranslated English names instead of the original language.
function titleRequestLanguage(): string | undefined {
  return loadStoredSettings().translateTitles ? undefined : "en-US";
}

type RawTitle = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  original_language?: string;
};

/**
 * TMDB list endpoints never include translations. When a page contains at least
 * one title TMDB could not translate, fetch the same page in English once and
 * map the names by id. The existing TMDB request dedupe/cache applies here too.
 */
async function englishNameMap<T extends RawTitle>(
  key: string,
  path: string,
  params: Record<string, string>,
  results: T[],
): Promise<Map<number, string> | null> {
  if (!key || results.length === 0) return null;
  if (!loadStoredSettings().translateTitles) return null;
  const language = params.language || effectiveTmdbLanguage() || "en";
  const missing = results.some((item) =>
    shouldUseEnglishTitle({
      localized: item.title ?? item.name ?? "",
      original: item.original_title ?? item.original_name ?? "",
      originalLanguage: item.original_language,
      targetLanguage: language,
      translateTitles: true,
    }),
  );
  if (!missing) return null;
  const english = await get<Page<T>>(key, path, { ...params, language: "en-US" });
  const names = new Map<number, string>();
  for (const item of english?.results ?? []) {
    const name = item.title ?? item.name;
    if (typeof item.id === "number" && typeof name === "string" && name.trim()) {
      names.set(item.id, name.trim());
    }
  }
  return names.size > 0 ? names : null;
}

async function movieMetas(
  key: string,
  path: string,
  params: Record<string, string>,
): Promise<Meta[]> {
  const data = await get<Page<RawMovie>>(key, path, params);
  const results = data?.results ?? [];
  const english = await englishNameMap(key, path, params, results);
  return results.map((movie) => movieMeta(movie, english?.get(movie.id), params.language));
}

async function seriesMetas(
  key: string,
  path: string,
  params: Record<string, string>,
): Promise<Meta[]> {
  const data = await get<Page<RawSeries>>(key, path, params);
  const results = data?.results ?? [];
  const english = await englishNameMap(key, path, params, results);
  return results.map((series) => seriesMeta(series, english?.get(series.id), params.language));
}

export async function tmdbMovieRow(
  key: string,
  endpoint: "popular" | "top_rated" | "now_playing" | "upcoming",
  region = "US",
  page = 1,
): Promise<Meta[]> {
  if (endpoint === "now_playing") return tmdbInCinema(key, region, page);
  const lang = titleRequestLanguage();
  return movieMetas(key, `movie/${endpoint}`, {
    region,
    page: String(page),
    ...(lang ? { language: lang } : {}),
  });
}

async function tmdbInCinema(key: string, region: string, page = 1): Promise<Meta[]> {
  const day = 24 * 60 * 60 * 1000;
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
  const lang = titleRequestLanguage();
  const metas = await movieMetas(key, "discover/movie", {
    region,
    with_release_type: "3",
    "release_date.gte": fmt(Date.now() - 75 * day),
    "release_date.lte": fmt(Date.now() + 7 * day),
    "with_runtime.gte": "60",
    sort_by: "popularity.desc",
    page: String(page),
    ...(lang ? { language: lang } : {}),
  });
  return metas.map((meta) => ({ ...meta, inTheaters: true }));
}

export async function tmdbSeriesRow(
  key: string,
  endpoint: "popular" | "top_rated" | "airing_today" | "on_the_air",
  page = 1,
): Promise<Meta[]> {
  const lang = titleRequestLanguage();
  return seriesMetas(key, `tv/${endpoint}`, {
    page: String(page),
    ...(lang ? { language: lang } : {}),
  });
}

export async function tmdbTrending(
  key: string,
  type: "movie" | "tv",
  window: "day" | "week" = "week",
  page = 1,
): Promise<Meta[]> {
  const lang = titleRequestLanguage();
  const path = `trending/${type}/${window}`;
  const params: Record<string, string> = {
    page: String(page),
    ...(lang ? { language: lang } : {}),
  };
  const data = await get<Page<RawMovie | RawSeries>>(key, path, params);
  const results = data?.results ?? [];
  const english = await englishNameMap(key, path, params, results);
  return type === "movie"
    ? (results as RawMovie[]).map((movie) =>
        movieMeta(movie, english?.get(movie.id), params.language),
      )
    : (results as RawSeries[]).map((series) =>
        seriesMeta(series, english?.get(series.id), params.language),
      );
}

export async function tmdbDiscover(
  key: string,
  type: "movie" | "tv",
  params: Record<string, string>,
): Promise<Meta[]> {
  if (!key) return [];
  const lang = titleRequestLanguage();
  const path = `discover/${type}`;
  const requestParams: Record<string, string> = {
    ...params,
    ...(lang ? { language: lang } : {}),
  };
  const data = await get<Page<RawMovie | RawSeries>>(key, path, requestParams);
  const results = data?.results ?? [];
  const english = await englishNameMap(key, path, requestParams, results);
  return type === "movie"
    ? (results as RawMovie[]).map((movie) =>
        movieMeta(movie, english?.get(movie.id), requestParams.language),
      )
    : (results as RawSeries[]).map((series) =>
        seriesMeta(series, english?.get(series.id), requestParams.language),
      );
}

export async function tmdbSearchMovie(
  key: string,
  query: string,
  year?: number,
): Promise<Meta | null> {
  if (!key || !query.trim()) return null;
  const lang = titleRequestLanguage();
  const params: Record<string, string> = { query, include_adult: "false" };
  if (year) params.year = String(year);
  if (lang) params.language = lang;
  const data = await get<Page<RawMovie>>(key, "search/movie", params);
  const hit = (data?.results ?? [])[0];
  if (!hit) return null;
  const english = await englishNameMap(key, "search/movie", params, [hit]);
  return movieMeta(hit, english?.get(hit.id), params.language);
}

export async function tmdbSearchTitle(
  key: string,
  type: "movie" | "series",
  query: string,
  year?: number,
): Promise<Meta | null> {
  if (!key || !query.trim()) return null;
  const lang = titleRequestLanguage();
  if (type === "movie") {
    const params: Record<string, string> = { query, include_adult: "false" };
    if (year) params.year = String(year);
    if (lang) params.language = lang;
    const data = await get<Page<RawMovie>>(key, "search/movie", params);
    const hit = (data?.results ?? [])[0];
    if (!hit) return null;
    const english = await englishNameMap(key, "search/movie", params, [hit]);
    return movieMeta(hit, english?.get(hit.id), params.language);
  }
  const params: Record<string, string> = { query, include_adult: "false" };
  if (year) params.first_air_date_year = String(year);
  if (lang) params.language = lang;
  const data = await get<Page<RawSeries>>(key, "search/tv", params);
  const hit = (data?.results ?? [])[0];
  if (!hit) return null;
  const english = await englishNameMap(key, "search/tv", params, [hit]);
  return seriesMeta(hit, english?.get(hit.id), params.language);
}
