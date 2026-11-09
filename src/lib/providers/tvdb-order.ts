import type { Episode, Season } from "@/lib/providers/tmdb";
import {
  tvdbBaseSeasonNames,
  tvdbEpisodesByType,
  tvdbSeasonNames,
  tvdbSeasons,
  tvdbSeriesByRemote,
  type TvdbEpisode,
} from "./tvdb";
import { loadOrderCache, persistOrderCache } from "./tvdb-order-cache";
import { mediaCacheGeneration, onMediaCacheClear } from "@/lib/media-cache";
import { firstRealEpisodeText } from "./episode-placeholder";
import { episodeTextLanguage } from "@/lib/episode-text-language";

export type OrderedEpisode = Episode & {
  nameEn?: string;
  overviewEn?: string;
  nameEnLanguage?: string;
  overviewEnLanguage?: string;
};

export type TvdbOrder = {
  seasons: Season[];
  seasonNamesResolved?: boolean;
  textComplete?: boolean;
  bySeason: Map<number, OrderedEpisode[]>;
  absByEpId: Map<number, number>;
  imageByAbs: Map<number, string>;
};

/**
 * True when a TVDB order season carries no real name — only the English
 * fallbacks built in build() below. Callers may substitute another source
 * (e.g. the TMDB season name) for these. "All Episodes" is deliberately
 * excluded: that single bucket spans many seasons, so a per-season name
 * from elsewhere would be wrong.
 */
export function isGenericTvdbSeasonName(name: string, seasonNumber: number): boolean {
  if (seasonNumber === 0) return name === "Specials";
  if (seasonNumber < 0) return true;
  return name === `Season ${seasonNumber}`;
}

export function seasonDateRange(eps: Episode[]): { from?: string; to?: string } {
  let from: string | undefined;
  let to: string | undefined;
  for (const e of eps) {
    if (!e.airDate) continue;
    if (!from || e.airDate < from) from = e.airDate;
    if (!to || e.airDate > to) to = e.airDate;
  }
  return { from, to };
}

const orderInflight = new Map<string, Promise<TvdbOrder | null>>();
onMediaCacheClear(() => orderInflight.clear());
const nameInflight = new WeakMap<TvdbOrder, Promise<TvdbOrder>>();

/** The core order is immediately usable; callers can apply names when ready. */
export function waitForTvdbSeasonNames(order: TvdbOrder): Promise<TvdbOrder> {
  return nameInflight.get(order) ?? Promise.resolve(order);
}

export async function fetchTvdbOrder(
  apiKey: string,
  remoteId: string,
  seasonType: string,
  lang?: string,
  allowProxyNames = false,
): Promise<TvdbOrder | null> {
  if (!remoteId) return null;
  const seriesId = await tvdbSeriesByRemote(apiKey, remoteId);
  if (!seriesId) return null;
  return fetchTvdbOrderBySeriesId(apiKey, seriesId, seasonType, lang, allowProxyNames);
}

export async function fetchTvdbOrderBySeriesId(
  apiKey: string,
  seriesId: number,
  seasonType: string,
  lang?: string,
  allowProxyNames = false,
): Promise<TvdbOrder | null> {
  if (!seriesId) return null;
  const started = typeof performance !== "undefined" ? performance.now() : 0;
  const mode = apiKey.trim() ? "direct" : "proxy";
  const typeKey = `${mode}:${seasonType}${lang ? `:${lang}` : ""}`;
  const cacheKey = `${apiKey}:${seriesId}:${typeKey}:${mode === "direct" || allowProxyNames}`;
  const running = orderInflight.get(cacheKey);
  if (running) return running;
  const load = (async () => {
    const generation = mediaCacheGeneration();
    const cached = await loadOrderCache(
      apiKey,
      seriesId,
      typeKey,
      () => build(apiKey, seriesId, seasonType, lang, allowProxyNames),
      allowProxyNames,
    );
    const result = cached.value;
    if (!result) return null;
    if (typeof window !== "undefined")
      window.__harborProfiler?.mark("tvdb-order:metadata-ready", {
        elapsedMs: Math.round(performance.now() - started),
        seasons: result.seasons.length,
        order: seasonType,
      });
    const enrich = async (result: TvdbOrder, storedAt = Date.now()): Promise<TvdbOrder> => {
      if (result.seasonNamesResolved || !(mode === "direct" || allowProxyNames)) return result;
      const nameType =
        seasonType === "aired" || seasonType === "official" ? "official" : seasonType;
      return tvdbSeasonNames(apiKey, seriesId, nameType, lang)
        .then(async (names) => {
          const enriched: TvdbOrder = {
            ...result,
            seasonNamesResolved: true,
            seasons: result.seasons.map((season) => {
              const translated = names.get(season.seasonNumber);
              // A generic English fallback must not hide a real season title.
              const name =
                translated && !isGenericTvdbSeasonName(translated, season.seasonNumber)
                  ? translated
                  : season.name;
              return {
                ...season,
                name,
                nameLanguage: "en",
                isGenericName: isGenericTvdbSeasonName(name, season.seasonNumber),
              };
            }),
          };
          await persistOrderCache(
            apiKey,
            seriesId,
            typeKey,
            enriched,
            storedAt,
            generation,
            allowProxyNames,
          );
          return enriched;
        })
        .catch(() => result);
    };
    const enrichment = cached.refresh
      ? cached.refresh.then((fresh) => (fresh ? enrich(fresh) : result))
      : enrich(result, cached.storedAt);
    nameInflight.set(result, enrichment);
    return result;
  })();
  orderInflight.set(cacheKey, load);
  try {
    return await load;
  } finally {
    if (orderInflight.get(cacheKey) === load) orderInflight.delete(cacheKey);
  }
}

async function build(
  apiKey: string,
  seriesId: number,
  seasonType: string,
  lang?: string,
  allowProxyNames = false,
): Promise<TvdbOrder | null> {
  const joinedClean = seasonType === "absolute";
  const rawAbsolute = seasonType === "tvdbabsolute";
  const slug =
    seasonType === "aired" || seasonType === "official" || joinedClean
      ? "default"
      : rawAbsolute
        ? "absolute"
        : seasonType;
  const nameTypeSlug =
    seasonType === "aired" || joinedClean || rawAbsolute ? "official" : seasonType;
  const defaults = tvdbEpisodesByType(apiKey, seriesId, "default");
  const requestedLang = lang && lang !== "eng" ? lang : undefined;
  const [defaultEps, seasonInfos, altEps, transAlt, transEn] = await Promise.all([
    defaults,
    joinedClean || rawAbsolute
      ? Promise.resolve(new Map())
      : tvdbSeasons(apiKey, seriesId, nameTypeSlug, lang),
    slug === "default" ? defaults : tvdbEpisodesByType(apiKey, seriesId, slug),
    requestedLang
      ? tvdbEpisodesByType(apiKey, seriesId, slug, requestedLang).catch(() => [])
      : Promise.resolve<TvdbEpisode[]>([]),
    tvdbEpisodesByType(apiKey, seriesId, slug, "eng").catch(() => []),
  ]);
  const names = tvdbBaseSeasonNames(seasonInfos);
  if (altEps.length === 0) return null;
  // Translations in the requested language. When a translation is missing, TVDB falls back to
  // the original (e.g. Japanese for anime) name, which we keep so users see text in their
  // requested language first. The English translation is always fetched as the base/fallback —
  // the language-less default fetch returns the series' original language (Japanese for anime),
  // so without this English users would see original-language names — and is carried alongside
  // as nameEn/overviewEn for consumers that need an English fallback when no localized text exists.
  const transById = new Map(transAlt.map((e) => [e.id, e] as const));
  const transEnById = new Map(transEn.map((e) => [e.id, e] as const));

  const canonical = new Map<number, { season: number; episode: number }>();
  for (const e of defaultEps) {
    if (e.seasonNumber >= 1) canonical.set(e.id, { season: e.seasonNumber, episode: e.number });
  }

  const bySeason = new Map<number, OrderedEpisode[]>();
  const altBySeason = new Map<number, Array<{ season: number; episode: number }>>();
  const seenEpisodeId = new Set<number>();
  for (const e of altEps) {
    if (seenEpisodeId.has(e.id)) continue;
    seenEpisodeId.add(e.id);
    const c = canonical.get(e.id) ?? { season: e.seasonNumber, episode: e.number };
    if (joinedClean && c.season < 1) continue;
    const bucketKey = joinedClean || rawAbsolute ? 1 : e.seasonNumber;
    const bucket = bySeason.get(bucketKey) ?? [];
    const altBucket = altBySeason.get(bucketKey) ?? [];
    altBucket.push({ season: e.seasonNumber, episode: e.number });
    altBySeason.set(bucketKey, altBucket);
    const tr = transById.get(e.id);
    const trEn = transEnById.get(e.id);
    const name = firstRealEpisodeText([tr?.name, trEn?.name, e.name]) ?? "";
    const overview = firstRealEpisodeText([tr?.overview, trEn?.overview, e.overview]) ?? "";
    const nameEn = firstRealEpisodeText([trEn?.name, e.name]);
    const overviewEn = firstRealEpisodeText([trEn?.overview, e.overview]);
    const fieldLanguage = (value: string | undefined, field: "name" | "overview") => {
      const languageField = field === "name" ? "nameLanguage" : "overviewLanguage";
      if (value && value === tr?.[field]) {
        return episodeTextLanguage(
          value,
          lang,
          trEn?.[languageField] === "und" ? undefined : trEn?.[field],
          tr?.[languageField] ? [tr[languageField]] : undefined,
        );
      }
      if (value && value === trEn?.[field])
        return trEn?.[languageField] ?? episodeTextLanguage(value, "en");
      return e[languageField] ?? "und";
    };
    // A localized "TBA" must not shadow a real name in another list: an aired
    // episode often has its English title while the requested-language or
    // original-language row still carries the placeholder. Keep the placeholder
    // only when no list has a real name yet (unaired episodes).
    bucket.push({
      id: e.id,
      seasonNumber: c.season,
      episodeNumber: c.episode,
      name,
      overview,
      nameEn,
      overviewEn,
      nameLanguage: fieldLanguage(name, "name"),
      overviewLanguage: fieldLanguage(overview, "overview"),
      nameEnLanguage:
        nameEn === trEn?.name
          ? (trEn?.nameLanguage ?? episodeTextLanguage(nameEn, "en"))
          : (e.nameLanguage ?? "und"),
      overviewEnLanguage:
        overviewEn === trEn?.overview
          ? (trEn?.overviewLanguage ?? episodeTextLanguage(overviewEn, "en"))
          : (e.overviewLanguage ?? "und"),
      stillPath: null,
      stillUrl: e.image ?? undefined,
      airDate: e.aired ?? null,
      runtime: e.runtime ?? null,
      voteAverage: null,
    });
    bySeason.set(bucketKey, bucket);
  }
  for (const [key, bucket] of bySeason) {
    const keys = bucket.map((x) => `${x.seasonNumber}:${x.episodeNumber}`);
    if (new Set(keys).size === keys.length) continue;
    const alt = altBySeason.get(key);
    if (!alt || alt.length !== bucket.length) continue;
    const altKeys = alt.map((x) => `${x.season}:${x.episode}`);
    if (new Set(altKeys).size !== altKeys.length) continue;
    bucket.forEach((ep, i) => {
      ep.seasonNumber = alt[i].season;
      ep.episodeNumber = alt[i].episode;
    });
  }
  if (bySeason.size === 0) return null;
  if (joinedClean) {
    bySeason
      .get(1)
      ?.sort((x, y) => x.seasonNumber - y.seasonNumber || x.episodeNumber - y.episodeNumber);
  }

  const absByEpId = new Map<number, number>();
  const imageByAbs = new Map<number, string>();
  for (const e of altEps) {
    if (e.absoluteNumber != null && Number.isFinite(e.absoluteNumber)) {
      absByEpId.set(e.id, e.absoluteNumber);
      if (e.image && Number.isInteger(e.absoluteNumber) && e.absoluteNumber > 0) {
        imageByAbs.set(e.absoluteNumber, e.image);
      }
    }
  }

  const seasons: Season[] = [...bySeason.keys()]
    .sort((a, b) => (a <= 0 ? 1 : b <= 0 ? -1 : a - b))
    .map((n) => {
      const name =
        joinedClean || rawAbsolute
          ? "All Episodes"
          : names.get(n) || (n === 0 ? "Specials" : `Season ${n}`);
      return {
        id: n,
        seasonNumber: n,
        name,
        nameLanguage: "en",
        isGenericName: joinedClean || rawAbsolute || isGenericTvdbSeasonName(name, n),
        overview: joinedClean || rawAbsolute ? "" : (seasonInfos.get(n)?.overview ?? ""),
        overviewLanguage:
          joinedClean || rawAbsolute ? undefined : seasonInfos.get(n)?.overviewLanguage,
        // TVDB artwork uses absolute URLs, unlike TMDB poster paths.
        posterPath: joinedClean || rawAbsolute ? null : (seasonInfos.get(n)?.image ?? null),
        episodeCount: bySeason.get(n)!.length,
        airDate: bySeason.get(n)![0]?.airDate ?? null,
      };
    });
  return {
    seasons,
    textComplete: transEn.length > 0 && (!requestedLang || transAlt.length > 0),
    bySeason,
    absByEpId,
    imageByAbs,
    seasonNamesResolved: joinedClean || rawAbsolute || (!apiKey.trim() && !allowProxyNames),
  };
}
