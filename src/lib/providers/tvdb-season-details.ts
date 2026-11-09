import { episodeLanguageBase, episodeTextLanguage } from "@/lib/episode-text-language";
import {
  pickSeasonPoster,
  tvdbLangFromIso1,
  tvdbSeasons,
  tvdbSeasonExtended,
  tvdbSeriesSeasonArtwork,
  tvdbSeasonText,
  type TvdbSeasonInfo,
} from "./tvdb";

export type TvdbSeasonDetails = {
  name?: string;
  overview?: string;
  overviewLanguage?: string;
};

export type TvdbSeasonArtwork = {
  poster?: string;
  background?: string;
};

/** Text is only needed for the selected season. */
export async function fetchTvdbSeasonDetails(
  apiKey: string,
  season: TvdbSeasonInfo,
  lang: string,
): Promise<TvdbSeasonDetails | null> {
  const language = episodeLanguageBase(lang);
  // The proxy blocks /seasons/*; use only its series-level overviewLang route.
  if (!apiKey.trim()) {
    if (season.overview?.trim() && season.overviewLanguage === language)
      return { name: season.name, overview: season.overview.trim(), overviewLanguage: language };
    const english =
      language === "en" || season.overviewLanguage === "en"
        ? season
        : season.seriesId && season.typeSlug
          ? (await tvdbSeasons("", season.seriesId, season.typeSlug, "eng").catch(() => null))?.get(
              season.number,
            )
          : undefined;
    const overview = english?.overview;
    return {
      name: season.name,
      overview: episodeTextLanguage(overview, "en") === "en" ? overview?.trim() : undefined,
      overviewLanguage:
        overview?.trim() && episodeTextLanguage(overview, "en") === "en" ? "en" : undefined,
    };
  }
  if (season.id == null) return {};
  const tvdbLang = tvdbLangFromIso1(language);
  const englishRequest = tvdbSeasonText(apiKey, season.id, "eng").catch(() => null);
  const [requested, english] = await Promise.all([
    tvdbLang === "eng"
      ? englishRequest
      : tvdbSeasonText(apiKey, season.id, tvdbLang).catch(() => null),
    englishRequest,
  ]);
  if (!requested && !english) return null;
  const requestedOverview = requested?.overview?.trim();
  const englishOverview = english?.overview?.trim();
  // Translation endpoints establish language even when the text quotes foreign names.
  const localized =
    !!requestedOverview &&
    episodeLanguageBase(tvdbLang) === language &&
    (language === "en" || requestedOverview !== englishOverview);
  const overview = localized ? requestedOverview : englishOverview;
  return {
    // Original-language names are not a safe fallback for an English title.
    name: english?.name,
    overview,
    overviewLanguage: overview ? (localized ? language : "en") : undefined,
  };
}

export async function fetchTvdbSeasonArtwork(
  apiKey: string,
  season: TvdbSeasonInfo,
  lang: string,
): Promise<TvdbSeasonArtwork> {
  if (season.id == null) return { poster: pickSeasonPoster({ baseImage: season.image }) };
  let extended: Awaited<ReturnType<typeof tvdbSeasonExtended>> = null;
  if (apiKey.trim()) {
    extended = await tvdbSeasonExtended(apiKey, season.id).catch(() => null);
  } else if (season.seriesId) {
    // The proxy blocks /seasons/* but the supported series endpoint includes
    // real season posters; its default season image can be a landscape background.
    extended = {
      artwork: await tvdbSeriesSeasonArtwork("", season.seriesId, season.id).catch(() => []),
    };
  }
  const background = [...(extended?.artwork ?? [])]
    // Landscape artwork keeps posters, square icons, and wide banners out of the backdrop.
    .filter((art) => {
      const ratio = Number(art.width) / Number(art.height);
      return ratio >= 1.4 && ratio <= 2 && typeof art.image === "string" && art.image;
    })
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))[0]?.image;
  return {
    poster: pickSeasonPoster({
      artwork: extended?.artwork,
      extendedImage: extended?.image,
      baseImage: season.image,
      lang: tvdbLangFromIso1(episodeLanguageBase(lang)),
    }),
    background:
      typeof background === "string"
        ? background.startsWith("http")
          ? background
          : `https://artworks.thetvdb.com${background.startsWith("/") ? "" : "/"}${background}`
        : undefined,
  };
}

/** One loader belongs to one explorer scope; changing selection only reprioritizes its queue. */
export function createSeasonArtworkLoader(
  apiKey: string,
  lang: string,
  onLoaded: (season: number, artwork: TvdbSeasonArtwork) => void,
  options: {
    titlePoster?: string;
    loadFallback?: (
      season: number,
      rejected: ReadonlySet<string>,
      signal: AbortSignal,
    ) => Promise<string | undefined>;
  } = {},
) {
  const queued = new Map<number, TvdbSeasonInfo>();
  const seasons = new Map<number, TvdbSeasonInfo>();
  const requested = new Set<number>();
  const originals = new Map<number, TvdbSeasonArtwork>();
  const resolved = new Map<number, TvdbSeasonArtwork>();
  const rejected = new Map<number, Set<string>>();
  const controller = new AbortController();
  let activeSeason: number | undefined;
  let running = 0;
  let stopped = false;
  const resolve = async (season: TvdbSeasonInfo): Promise<TvdbSeasonArtwork> => {
    const basePoster = pickSeasonPoster({ baseImage: season.image });
    let artwork = originals.get(season.number);
    if (!artwork) {
      artwork = await fetchTvdbSeasonArtwork(apiKey, season, lang).catch(() => ({
        poster: basePoster,
      }));
      originals.set(season.number, artwork);
    }
    const failed = rejected.get(season.number) ?? new Set<string>();
    let poster = [artwork.poster, basePoster].find((url) => url && !failed.has(url));
    if (!poster && !stopped)
      poster = await options
        .loadFallback?.(season.number, failed, controller.signal)
        .catch(() => undefined);
    if (!poster || failed.has(poster))
      poster =
        options.titlePoster && !failed.has(options.titlePoster) ? options.titlePoster : undefined;
    return { ...artwork, poster };
  };
  const pump = () => {
    while (!stopped && running < 3 && queued.size > 0) {
      const season =
        (activeSeason == null ? undefined : queued.get(activeSeason)) ??
        queued.values().next().value!;
      queued.delete(season.number);
      requested.add(season.number);
      running++;
      void resolve(season)
        .then((artwork) => {
          if (stopped) return;
          resolved.set(season.number, artwork);
          onLoaded(season.number, artwork);
        })
        .finally(() => {
          running--;
          pump();
        });
    }
  };
  return {
    request(infos: TvdbSeasonInfo[], selected?: number) {
      if (stopped) return;
      activeSeason = selected;
      queued.clear();
      for (const season of infos) {
        seasons.set(season.number, season);
        if (season.number >= 0 && !requested.has(season.number)) queued.set(season.number, season);
      }
      pump();
    },
    reject(number: number, url: string) {
      const season = seasons.get(number);
      const current = resolved.get(number);
      if (stopped || !season || current?.poster !== url) return;
      const failed = rejected.get(number) ?? new Set<string>();
      if (failed.has(url)) return;
      failed.add(url);
      rejected.set(number, failed);
      const pending = { ...current, poster: undefined };
      resolved.set(number, pending);
      onLoaded(number, pending);
      requested.delete(number);
      queued.set(number, season);
      pump();
    },
    dispose() {
      stopped = true;
      controller.abort();
      queued.clear();
    },
  };
}
