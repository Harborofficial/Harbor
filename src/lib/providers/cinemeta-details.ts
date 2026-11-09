import { safeFetch as fetch } from "@/lib/safe-fetch";
import { addonOnlyMetadata } from "@/lib/metadata-policy";
import { resolveMeta, preferCustomMeta } from "@/lib/meta-resource";
import { readActiveStremioAuthKey } from "@/lib/auth";
import { topMovies, topSeries, type Meta, type MetaSeason } from "@/lib/cinemeta";
import { registerEvictable } from "@/lib/maintenance";
import type { CastEntry, ExtraVideo, Season, TmdbDetail } from "./tmdb/tmdb-details";
import type { PersonRef } from "./tmdb/tmdb-people";
import { isGenericSeasonName } from "@/lib/season-name";

const CINEMETA = "https://v3-cinemeta.strem.io";

type CinemetaMeta = {
  id?: string;
  imdb_id?: string;
  moviedb_id?: number;
  /** ID stamps some metadata addons send instead of the Stremio fields. */
  _imdbId?: string;
  _tmdbId?: string | number;
  _tvdbId?: string | number;
  name?: string;
  type?: string;
  cast?: string[];
  director?: string[];
  writer?: string[];
  country?: string;
  description?: string;
  releaseInfo?: string | number;
  year?: number;
  released?: string;
  runtime?: string;
  imdbRating?: string;
  logo?: string;
  poster?: string;
  background?: string;
  genre?: string[];
  genres?: string[];
  trailerStreams?: Array<{ ytId?: string; title?: string }>;
  trailers?: Array<{ source?: string; type?: string }>;
  seasons?: MetaSeason[];
  seasonPosters?: Record<string | number, string>;
  seasonBackdrops?: Record<string | number, string>;
  seasonOverviews?: Record<string | number, string>;
  app_extras?: Pick<Meta, "seasons" | "seasonPosters" | "seasonBackdrops" | "seasonOverviews">;
  videos?: Array<{
    id?: string;
    season?: number;
    episode?: number;
    released?: string;
    title?: string;
  }>;
};

function extractImdbId(id: string): string | null {
  if (id.startsWith("tt")) return id;
  return null;
}

function synthId(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h) ^ name.charCodeAt(i);
  return -(Math.abs(h) || 1);
}

function people(arr: string[] | undefined): PersonRef[] {
  const seen = new Set<string>();
  const out: PersonRef[] = [];
  for (const name of arr ?? []) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ id: synthId(name), name });
  }
  return out;
}

function seasonNumber(season: MetaSeason): number | null {
  const value = season.season ?? season.number ?? season.seasonNumber;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function seasonKey(value: string | number): number | null {
  const number = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function seasonRecords(m: CinemetaMeta): MetaSeason[] {
  return [...(m.seasons ?? []), ...(m.app_extras?.seasons ?? [])];
}

function addSeasonMap(
  target: Map<number, string>,
  source: Record<string | number, string> | undefined,
): void {
  for (const [key, value] of Object.entries(source ?? {})) {
    const number = seasonKey(key);
    if (number != null && typeof value === "string" && value.trim() && !target.has(number)) {
      target.set(number, value);
    }
  }
}

function seasonOverviewMap(m: CinemetaMeta): Map<number, string> {
  const out = new Map<number, string>();
  addSeasonMap(out, m.seasonOverviews);
  addSeasonMap(out, m.app_extras?.seasonOverviews);
  return out;
}

function addonSeasons(m: CinemetaMeta): Season[] {
  const firstAir = new Map<number, string>();
  const counts = new Map<number, number>();
  for (const video of m.videos ?? []) {
    if (typeof video.season !== "number" || video.season < 0) continue;
    counts.set(video.season, (counts.get(video.season) ?? 0) + 1);
    if (video.released && !firstAir.has(video.season)) firstAir.set(video.season, video.released);
  }
  const records = seasonRecords(m);
  const posters = seasonImages(m, "poster");
  const backdrops = seasonImages(m, "background");
  const overviews = seasonOverviewMap(m);
  const numbers = new Set<number>([
    ...records.map(seasonNumber).filter((number): number is number => number != null),
    ...Object.keys(posters ?? {})
      .map(seasonKey)
      .filter((number): number is number => number != null),
    ...Object.keys(backdrops ?? {})
      .map(seasonKey)
      .filter((number): number is number => number != null),
    ...overviews.keys(),
  ]);
  const out: Season[] = [];
  for (const number of numbers) {
    const record = records.find((season) => seasonNumber(season) === number);
    const name = record?.name?.trim() || (number === 0 ? "Specials" : `Season ${number}`);
    out.push({
      id: number,
      seasonNumber: number,
      name,
      isGenericName: isGenericSeasonName(name, number),
      overview: record?.overview ?? record?.description ?? overviews.get(number) ?? "",
      overviewLanguage: record?.overviewLanguage ?? record?.language,
      // Season posters can be absolute addon URLs; Season.posterPath is a TMDB path.
      posterPath: null,
      episodeCount: record?.episodeCount ?? counts.get(number) ?? 0,
      airDate: record?.airDate ?? record?.released ?? firstAir.get(number) ?? null,
    });
  }
  return out.sort((a, b) => a.seasonNumber - b.seasonNumber);
}

function seasonImages(
  m: CinemetaMeta,
  field: "poster" | "background",
): Record<number, string> | undefined {
  const out = new Map<number, string>();
  for (const season of seasonRecords(m)) {
    const number = seasonNumber(season);
    const value =
      field === "poster" ? (season.poster ?? season.image) : (season.background ?? season.backdrop);
    if (number != null && typeof value === "string" && value.trim() && !out.has(number)) {
      out.set(number, value);
    }
  }
  addSeasonMap(out, field === "poster" ? m.seasonPosters : m.seasonBackdrops);
  addSeasonMap(
    out,
    field === "poster" ? m.app_extras?.seasonPosters : m.app_extras?.seasonBackdrops,
  );
  return out.size > 0 ? Object.fromEntries(out) : undefined;
}

function toDetail(m: CinemetaMeta, kind: "movie" | "tv", related: Meta[]): TmdbDetail {
  const seasons = addonSeasons(m);
  const stampedTmdbId = Number(m._tmdbId);
  const stampedTvdbId = Number(m._tvdbId);
  const tmdbId =
    m.moviedb_id ??
    (Number.isInteger(stampedTmdbId) && stampedTmdbId > 0 ? stampedTmdbId : undefined);
  const tvdbId = Number.isInteger(stampedTvdbId) && stampedTvdbId > 0 ? stampedTvdbId : undefined;
  const cast: CastEntry[] = (m.cast ?? []).map((name, i) => ({
    id: synthId(name),
    name,
    character: "",
    profilePath: null,
    order: i,
  }));
  const directors = people(m.director);
  const writers = people(m.writer);
  const genres = m.genre ?? m.genres ?? [];
  const trailerVideos: ExtraVideo[] = (m.trailerStreams ?? []).flatMap((trailer) =>
    trailer.ytId
      ? [
          {
            ytId: trailer.ytId,
            name: trailer.title?.trim() || "Trailer",
            type: "Trailer",
          },
        ]
      : [],
  );
  const trailerCandidates = trailerVideos.map((video) => video.ytId);
  const trailerYtId = trailerCandidates[0] ?? null;
  const year =
    m.year != null
      ? String(m.year)
      : typeof m.releaseInfo === "string"
        ? m.releaseInfo.slice(0, 4)
        : typeof m.releaseInfo === "number"
          ? String(m.releaseInfo)
          : m.released
            ? m.released.slice(0, 4)
            : undefined;

  return {
    kind,
    id: tmdbId ?? 0,
    imdbId:
      m.imdb_id ?? (m._imdbId?.startsWith("tt") ? m._imdbId : m.id?.startsWith("tt") ? m.id : null),
    title: m.name ?? "",
    originalTitle: m.name ?? "",
    tagline: "",
    overview: m.description ?? "",
    poster: m.poster,
    backdrop: m.background,
    logo: m.logo,
    year,
    rating: m.imdbRating,
    ratingSource: "imdb",
    voteCount: 0,
    runtime: m.runtime,
    status: "",
    genres,
    originalLanguage: "",
    spokenLanguages: [],
    productionCountries: m.country
      ? m.country
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    productionCompanies: [],
    networks: [],
    productionCompaniesRich: [],
    productionCountriesRich: [],
    spokenLanguagesRich: [],
    networksRich: [],
    trailerYtId,
    trailerCandidates,
    trailerVideos,
    extraVideos: [],
    gallery: { backdrops: [], posters: [], logos: [] },
    cast,
    crew: [],
    directors,
    writers,
    creators: [],
    producers: [],
    composer: [],
    cinematography: [],
    editor: [],
    recommendations: [],
    similar: related,
    seasons,
    seasonPosters: seasonImages(m, "poster"),
    seasonBackdrops: seasonImages(m, "background"),
    tmdbTvId: kind === "tv" ? tmdbId : undefined,
    tvdbTvId: tvdbId,
    numberOfSeasons: new Set(seasons.map((season) => season.seasonNumber)).size,
    numberOfEpisodes:
      seasons.length > 0
        ? seasons.reduce((sum, season) => sum + season.episodeCount, 0)
        : (m.videos?.length ?? 0),
    keywords: [],
    firstAirDate: m.released?.slice(0, 10),
    lastAirDate: undefined,
    releaseDate: m.released?.slice(0, 10),
    lastEpisodeAir: undefined,
    budget: undefined,
    revenue: undefined,
    homepage: undefined,
  };
}

const detailCache = new Map<string, { v: TmdbDetail | null; t: number }>();
const TTL = 30 * 60 * 1000;

registerEvictable("cinemeta-details", (aggressive) => {
  if (aggressive) return detailCache.clear();
  const now = Date.now();
  for (const [k, e] of detailCache) if (now - e.t > TTL) detailCache.delete(k);
});

export async function cinemetaDetails(meta: Meta): Promise<TmdbDetail | null> {
  if (addonOnlyMetadata() || preferCustomMeta()) {
    const full = await resolveMeta(
      readActiveStremioAuthKey(),
      meta.type === "series" ? "series" : "movie",
      meta.id,
    );
    return full ? toDetail(full, meta.type === "series" ? "tv" : "movie", []) : null;
  }
  const imdbId = extractImdbId(meta.id);
  if (!imdbId) return null;
  const cacheKey = `${meta.type}:${imdbId}`;
  const hit = detailCache.get(cacheKey);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const kind: "movie" | "tv" = meta.type === "series" ? "tv" : "movie";
  const typePath = kind === "tv" ? "series" : "movie";
  try {
    const res = await fetch(`${CINEMETA}/meta/${typePath}/${imdbId}.json`);
    if (!res.ok) {
      detailCache.set(cacheKey, { v: null, t: Date.now() });
      return null;
    }
    const json = (await res.json()) as { meta?: CinemetaMeta };
    const m = json.meta;
    if (!m) {
      detailCache.set(cacheKey, { v: null, t: Date.now() });
      return null;
    }
    const primaryGenre = (m.genre ?? m.genres ?? [])[0];
    const relatedFetcher = kind === "movie" ? topMovies : topSeries;
    const related = primaryGenre
      ? await relatedFetcher(primaryGenre).catch(() => [] as Meta[])
      : [];
    const filtered = related.filter((r) => r.id !== imdbId).slice(0, 30);
    const out = toDetail(m, kind, filtered);
    detailCache.set(cacheKey, { v: out, t: Date.now() });
    return out;
  } catch {
    detailCache.set(cacheKey, { v: null, t: Date.now() });
    return null;
  }
}
