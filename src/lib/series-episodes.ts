import { lruSet } from "@/lib/cache";
import { onMediaCacheClear, mediaCacheGeneration, MEDIA_TTL } from "@/lib/media-cache";
import { registerCache } from "@/lib/memory-profiler";
import { safeFetch as fetch } from "@/lib/safe-fetch";
import type { Meta } from "./cinemeta";
import type { PlayEpisode } from "./view";
import {
  applyTmdbEpisodeNames,
  needsTmdbEpisodeNames,
  tmdbDetails,
  tmdbEpisodeNames,
  tmdbSeasonEpisodes,
} from "./providers/tmdb";
import { effectiveTmdbLanguage, tmdbLanguageIso } from "./providers/tmdb/tmdb-client";
import { tmdbStillUrl } from "./providers/tmdb/tmdb-image-rungs";
import { pickLocalizedText } from "./localized-text";
import {
  PREFERRED_TEXT_SCORE,
  preferCustomMeta,
  preferredMeta,
  preferredVideoMap,
  preferredVideoName,
  preferredVideoOverview,
  resolveMeta,
} from "./meta-resource";
import { animeKitsuMeta, type AnimeKitsuMeta } from "./providers/anime-kitsu-addon";
import { kitsuToAnilist } from "./providers/anime-mapping";
import { nextAnimeEntry, resolveAnimeEntry } from "./providers/anime-entry";
import { parseKitsuId } from "./providers/kitsu";
import { aniZipByAnilist, aniZipByKitsu, pickEpisodeTitle } from "./providers/anizip";
import { fetchTvdbProxyImages, pickTvdbImage } from "./providers/tvdb-proxy";
import { franchiseRoot } from "./providers/anime-franchise-root";
import { foreignAnimeProviderSeasons } from "./streams/anime-identity";

async function filterForeignAnimeSeasons(
  metaId: string,
  imdbId: string | null,
  nums: number[],
): Promise<number[]> {
  try {
    const foreign = await foreignAnimeProviderSeasons(metaId, imdbId);
    if (!foreign) return nums;
    const out = nums.filter((n) => !foreign.has(n));
    return out.length > 0 ? out : nums;
  } catch {
    return nums;
  }
}

export function isAnimeId(id: string): boolean {
  return (
    id.startsWith("kitsu:") ||
    id.startsWith("mal:") ||
    id.startsWith("anilist:") ||
    id.startsWith("anidb:")
  );
}

export function animeSeriesFromStreamId(streamId: string | undefined): string | null {
  if (!streamId) return null;
  const m = /^(kitsu|mal|anilist|anidb):(\d+):/.exec(streamId);
  return m ? `${m[1]}:${m[2]}` : null;
}

async function getAnimeEpisodes(id: string): Promise<PlayEpisode[] | null> {
  const generation = mediaCacheGeneration();
  const cacheKey = `anime:${id}`;
  if (addonEpsCache.has(cacheKey)) return addonEpsCache.get(cacheKey)!;
  const entry = await resolveAnimeEntry(id).catch(() => null);
  if (!entry) return null;
  const { kitsuId } = entry;
  const addonMeta =
    entry.meta && entry.meta.videos.length > 0
      ? entry.meta
      : await animeKitsuMeta(`kitsu:${kitsuId}`).catch(() => null);
  const raw = addonMeta?.videos ?? [];
  const eps: PlayEpisode[] = [];
  for (const v of raw) {
    if (!Number.isFinite(v.episode)) continue;
    const season = v.season >= 0 ? v.season : 1;
    const ep: PlayEpisode = {
      season,
      episode: v.episode,
      name: v.title || undefined,
      still: v.thumbnail ?? undefined,
      overview: v.overview ?? undefined,
      airDate: v.released,
    };
    if (v.id) ep.kitsuStreamId = v.id;
    if (v.imdb_id ?? addonMeta?.imdb_id) ep.imdbId = v.imdb_id ?? addonMeta?.imdb_id;
    if (v.imdbSeason != null) ep.imdbSeason = v.imdbSeason;
    if (v.imdbEpisode != null) ep.imdbEpisode = v.imdbEpisode;
    eps.push(ep);
  }
  if (eps.length === 0) return null;

  const distinctReleased = new Set(eps.map((e) => e.airDate).filter(Boolean));
  const bogusAirdates = eps.length > 1 && distinctReleased.size <= 1;
  if (bogusAirdates) for (const ep of eps) ep.airDate = undefined;

  const seriesImdb = addonMeta?.imdb_id ?? eps.find((e) => e.imdbId)?.imdbId ?? undefined;
  const rootId = await franchiseRoot(id).catch(() => id);
  const rootKitsu = parseKitsuId(rootId) ?? kitsuId;
  let az = await aniZipByKitsu(kitsuId).catch(() => null);
  if (!az?.mappings?.thetvdb_id) {
    const anilistId = await kitsuToAnilist(kitsuId).catch(() => null);
    if (anilistId != null) {
      const alt = await aniZipByAnilist(anilistId).catch(() => null);
      if (alt?.mappings?.thetvdb_id || (alt?.episodes && !az?.episodes)) az = alt;
    }
  }
  const tvdbImages = await fetchTvdbProxyImages({
    series: az?.mappings?.thetvdb_id,
    kitsuId: rootKitsu,
    imdb: seriesImdb ?? az?.mappings?.imdb_id,
  }).catch(() => ({}) as Record<string, string>);
  if (az?.episodes) {
    for (const ep of eps) {
      const m = az.episodes[String(ep.episode)];
      if (!m) continue;
      if (ep.imdbSeason == null && m.seasonNumber != null && m.seasonNumber >= 1) {
        ep.imdbSeason = m.seasonNumber;
      }
      if (ep.imdbEpisode == null && m.episodeNumber != null) ep.imdbEpisode = m.episodeNumber;
      if (ep.absoluteNumber == null && m.absoluteEpisodeNumber)
        ep.absoluteNumber = m.absoluteEpisodeNumber;
      if (ep.tvdbEpisodeId == null && m.tvdbId) ep.tvdbEpisodeId = m.tvdbId;
      const air = m.airDateUtc ?? m.airDate ?? m.airdate;
      if (air && (!ep.airDate || bogusAirdates)) ep.airDate = air;
      if (!ep.overview && m.overview) ep.overview = m.overview;
      if (!ep.name) ep.name = pickEpisodeTitle(m) ?? undefined;
      if (!ep.still && m.image) ep.still = m.image;
      if (ep.runtime == null && m.runtime && m.runtime > 0) ep.runtime = m.runtime;
      if (ep.rating == null && m.rating) {
        const r = Number(m.rating);
        if (Number.isFinite(r) && r > 0) ep.rating = r;
      }
    }
  }
  if (Object.keys(tvdbImages).length > 0) {
    for (const ep of eps) {
      const img = pickTvdbImage(tvdbImages, {
        number: ep.episode,
        seasonNumber: ep.season,
        imdbSeason: ep.imdbSeason,
        imdbEpisode: ep.imdbEpisode,
      });
      if (img) ep.still = img;
    }
  }
  eps.sort((a, b) => a.season - b.season || a.episode - b.episode);
  if (generation === mediaCacheGeneration()) lruSet(addonEpsCache, cacheKey, eps, SEASON_CACHE_MAX);
  return eps;
}

async function getNonStandardEpisodes(meta: Meta): Promise<PlayEpisode[] | null> {
  if (isAnimeId(meta.id)) {
    const anime = await getAnimeEpisodes(meta.id);
    if (anime) return anime;
  }
  return getAddonEpisodes(meta.id);
}

type Adjacent = {
  prev: PlayEpisode | null;
  next: PlayEpisode | null;
  prevMeta?: Meta;
  nextMeta?: Meta;
};

const TT_CACHE_MAX = 800;
const SEASON_CACHE_MAX = 400;
class ProjectionCache<T> extends Map<string, T> {
  private expires = new Map<string, number>();
  constructor() {
    super();
    onMediaCacheClear(() => this.clear());
  }
  override get(key: string) {
    if ((this.expires.get(key) ?? 0) <= Date.now()) {
      this.delete(key);
      return undefined;
    }
    return super.get(key);
  }
  override has(key: string) {
    return this.get(key) !== undefined;
  }
  override set(key: string, value: T) {
    this.expires.set(key, Date.now() + MEDIA_TTL.recent);
    return super.set(key, value);
  }
  override delete(key: string) {
    this.expires.delete(key);
    return super.delete(key);
  }
  override clear() {
    this.expires.clear();
    super.clear();
  }
}
const ttCache = new ProjectionCache<Adjacent>();
const tmdbSeasonCache = new ProjectionCache<PlayEpisode[]>();
const addonEpsCache = new ProjectionCache<PlayEpisode[]>();
const cinemetaListCache = new ProjectionCache<PlayEpisode[]>();

registerCache("episodes:tt", () => ttCache.size);
registerCache("episodes:tmdbSeason", () => tmdbSeasonCache.size);
registerCache("episodes:addon", () => addonEpsCache.size);
registerCache("episodes:cinemetaList", () => cinemetaListCache.size);

function readAuthKey(): string | null {
  try {
    const raw = localStorage.getItem("harbor.auth");
    return raw ? ((JSON.parse(raw) as { authKey?: string }).authKey ?? null) : null;
  } catch {
    return null;
  }
}

async function getAddonEpisodes(id: string): Promise<PlayEpisode[] | null> {
  const generation = mediaCacheGeneration();
  const authKey = readAuthKey();
  const cacheKey = JSON.stringify([id, authKey]);
  if (addonEpsCache.has(cacheKey)) return addonEpsCache.get(cacheKey)!;
  const m = await resolveMeta(authKey, "series", id).catch(() => null);
  const raw = m?.videos ?? [];
  const eps: PlayEpisode[] = [];
  for (const v of raw) {
    const season = typeof v.season === "number" ? v.season : null;
    const episode =
      typeof v.episode === "number" ? v.episode : typeof v.number === "number" ? v.number : null;
    if (season == null || episode == null || season < 1) continue;
    const ep: PlayEpisode = {
      season,
      episode,
      name: v.title || v.name || undefined,
      still: v.thumbnail,
      airDate: v.released || v.firstAired,
    };
    const vid = (v as { id?: string }).id;
    if (vid && (vid.startsWith("kitsu:") || vid.startsWith("mal:"))) ep.kitsuStreamId = vid;
    else if (vid) ep.videoId = vid;
    eps.push(ep);
  }
  if (eps.length === 0) return null;
  eps.sort((a, b) => a.season - b.season || a.episode - b.episode);
  if (generation === mediaCacheGeneration()) lruSet(addonEpsCache, cacheKey, eps, SEASON_CACHE_MAX);
  return eps;
}

export async function fetchAdjacentEpisodes(
  meta: Meta,
  current: { season: number; episode: number },
  opts: {
    tmdbKey: string;
    kitsuStreamId?: string;
    imdbSeason?: number;
    imdbEpisode?: number;
    episodeEndOffset?: number;
    skip?: (season: number, episode: number, metaId?: string) => boolean;
  },
): Promise<Adjacent> {
  const generation = mediaCacheGeneration();
  const animeSeries = animeSeriesFromStreamId(opts.kitsuStreamId);
  if (animeSeries) {
    const eps = await getAnimeEpisodes(animeSeries);
    if (eps) return animeAdjacent(animeSeries, eps, current, opts);
  }

  if (meta.type !== "series" && !isAnimeId(meta.id)) return { prev: null, next: null };

  if (meta.id.startsWith("tt")) {
    const key = JSON.stringify([
      meta.id,
      current.season,
      current.episode,
      opts.tmdbKey,
      effectiveTmdbLanguage(),
      readAuthKey(),
      preferCustomMeta(),
    ]);
    if (!opts.skip && ttCache.has(key)) return ttCache.get(key)!;
    const eps = await loadCinemetaEpisodes(meta.id, opts.tmdbKey);
    if (!eps) return { prev: null, next: null };
    const result = computeAdjacent(eps, current, opts.skip);
    if (!opts.skip && generation === mediaCacheGeneration())
      lruSet(ttCache, key, result, TT_CACHE_MAX);
    return result;
  }

  if (meta.id.startsWith("tmdb:tv:") && opts.tmdbKey) {
    const tvId = parseInt(meta.id.split(":")[2] ?? "", 10);
    if (!Number.isFinite(tvId)) return { prev: null, next: null };
    return tmdbAdjacent(opts.tmdbKey, tvId, current, opts.skip);
  }

  const eps = await getNonStandardEpisodes(meta);
  if (!eps) return { prev: null, next: null };
  if (isAnimeId(meta.id)) return animeAdjacent(meta.id, eps, current, opts);
  return computeAdjacent(eps, current, opts.skip);
}

export async function fetchUpcomingEpisodes(
  meta: Meta,
  current: { season: number; episode: number },
  count: number,
  opts: { tmdbKey: string },
): Promise<PlayEpisode[]> {
  if ((meta.type !== "series" && !isAnimeId(meta.id)) || count <= 0) return [];
  if (meta.id.startsWith("tt")) {
    const eps = await loadCinemetaEpisodes(meta.id, opts.tmdbKey);
    if (!eps) return [];
    const idx = eps.findIndex((v) => v.season === current.season && v.episode === current.episode);
    if (idx === -1) return eps.slice(0, count);
    return eps.slice(idx + 1, idx + 1 + count);
  }
  if (meta.id.startsWith("tmdb:tv:") && opts.tmdbKey) {
    const tvId = parseInt(meta.id.split(":")[2] ?? "", 10);
    if (!Number.isFinite(tvId)) return [];
    const out: PlayEpisode[] = [];
    let season = current.season;
    let cursor = current.episode;
    while (out.length < count && season <= current.season + 3) {
      const eps = await tmdbSeason(opts.tmdbKey, tvId, season);
      const start = season === current.season ? eps.findIndex((e) => e.episode === cursor) + 1 : 0;
      if (start < 0) break;
      for (let i = start; i < eps.length && out.length < count; i++) out.push(eps[i]);
      season += 1;
      cursor = 0;
    }
    return out;
  }
  const eps = await getNonStandardEpisodes(meta);
  if (!eps) return [];
  const idx = eps.findIndex((v) => v.season === current.season && v.episode === current.episode);
  if (idx === -1) return eps.slice(0, count);
  return eps.slice(idx + 1, idx + 1 + count);
}

async function overlayPreferredEpisodes(id: string, eps: PlayEpisode[]): Promise<void> {
  const full = await preferredMeta("series", id);
  const byKey = preferredVideoMap(full?.videos);
  if (byKey.size === 0) return;
  const lang = tmdbLanguageIso();
  for (const ep of eps) {
    const v = byKey.get(`${ep.season}:${ep.episode}`);
    if (!v) continue;
    const name = pickLocalizedText(
      [{ text: preferredVideoName(v), score: PREFERRED_TEXT_SCORE }, { text: ep.name ?? "" }],
      { forName: true, lang },
    );
    if (name) ep.name = name;
    const overview = pickLocalizedText(
      [
        { text: preferredVideoOverview(v), score: PREFERRED_TEXT_SCORE },
        { text: ep.overview ?? "" },
      ],
      { lang },
    );
    if (overview) ep.overview = overview;
    if (v.thumbnail) ep.still = v.thumbnail;
  }
}

async function overlayTmdbEpisodeNames(
  id: string,
  tmdbKey: string,
  eps: PlayEpisode[],
): Promise<PlayEpisode[]> {
  const bySeason = new Map<number, PlayEpisode[]>();
  for (const e of eps) {
    const group = bySeason.get(e.season);
    if (group) group.push(e);
    else bySeason.set(e.season, [e]);
  }
  const wanted = [...bySeason].filter(([s, g]) => s >= 1 && needsTmdbEpisodeNames(g));
  if (wanted.length === 0) return eps;
  const patched = new Map<PlayEpisode, PlayEpisode>();
  await Promise.all(
    wanted.map(async ([season, group]) => {
      const names = await tmdbEpisodeNames(tmdbKey, id, season).catch(() => null);
      if (!names || names.size === 0) return;
      const out = applyTmdbEpisodeNames(group, names);
      if (out === group) return;
      for (let i = 0; i < group.length; i++) {
        if (out[i] !== group[i]) patched.set(group[i], out[i]);
      }
    }),
  );
  if (patched.size === 0) return eps;
  return eps.map((e) => patched.get(e) ?? e);
}

async function loadCinemetaEpisodes(id: string, tmdbKey?: string): Promise<PlayEpisode[] | null> {
  const generation = mediaCacheGeneration();
  const prefer = preferCustomMeta();
  const cacheKey = JSON.stringify([id, prefer, tmdbKey, effectiveTmdbLanguage(), readAuthKey()]);
  if (cinemetaListCache.has(cacheKey)) return cinemetaListCache.get(cacheKey)!;
  const res = await fetch(`https://v3-cinemeta.strem.io/meta/series/${id}.json`);
  if (!res.ok) return null;
  const json = await res.json();
  const raw = (json?.meta?.videos ?? []) as Array<{
    season?: number;
    episode?: number;
    number?: number;
    title?: string;
    name?: string;
    thumbnail?: string;
    overview?: string;
    description?: string;
    released?: string;
    firstAired?: string;
  }>;
  const eps: PlayEpisode[] = [];
  for (const v of raw) {
    const season = typeof v.season === "number" ? v.season : null;
    const episode =
      typeof v.episode === "number" ? v.episode : typeof v.number === "number" ? v.number : null;
    if (season == null || episode == null) continue;
    if (season < 1) continue;
    eps.push({
      season,
      episode,
      name: v.title || v.name || undefined,
      still: v.thumbnail,
      overview: v.overview || v.description,
      airDate: v.released || v.firstAired,
    });
  }
  eps.sort((a, b) => a.season - b.season || a.episode - b.episode);
  if (prefer) await overlayPreferredEpisodes(id, eps);
  const named = tmdbKey ? await overlayTmdbEpisodeNames(id, tmdbKey, eps) : eps;
  if (generation === mediaCacheGeneration())
    lruSet(cinemetaListCache, cacheKey, named, SEASON_CACHE_MAX);
  return named;
}

function uniqueSeasons(eps: PlayEpisode[] | null): number[] {
  if (!eps) return [];
  const set = new Set<number>();
  for (const e of eps) if (e.season >= 1) set.add(e.season);
  return [...set].sort((a, b) => a - b);
}

function animeSeasonKey(e: PlayEpisode): number {
  if (e.imdbSeason === 0) return 0;
  return e.imdbSeason != null && e.imdbSeason >= 1 ? e.imdbSeason : e.season;
}

function uniqueAnimeSeasons(eps: PlayEpisode[] | null): number[] {
  if (!eps) return [];
  const set = new Set<number>();
  for (const e of eps) {
    const s = animeSeasonKey(e);
    if (s >= 1) set.add(s);
  }
  return [...set].sort((a, b) => a - b);
}

export async function fetchSeasonList(meta: Meta, opts: { tmdbKey: string }): Promise<number[]> {
  if (meta.type !== "series" && !isAnimeId(meta.id)) return [];
  if (meta.id.startsWith("tt")) {
    const nums = uniqueSeasons(await loadCinemetaEpisodes(meta.id, opts.tmdbKey));
    return filterForeignAnimeSeasons(meta.id, meta.id, nums);
  }
  if (meta.id.startsWith("tmdb:tv:") && opts.tmdbKey) {
    const detail = await tmdbDetails(opts.tmdbKey, meta).catch(() => null);
    const nums = (detail?.seasons ?? []).map((s) => s.seasonNumber).filter((n) => n >= 1);
    const deduped = [...new Set(nums)].sort((a, b) => a - b);
    return filterForeignAnimeSeasons(meta.id, null, deduped);
  }
  return uniqueAnimeSeasons(await getNonStandardEpisodes(meta));
}

export async function fetchSeasonEpisodes(
  meta: Meta,
  season: number,
  opts: { tmdbKey: string },
): Promise<PlayEpisode[]> {
  if ((meta.type !== "series" && !isAnimeId(meta.id)) || season < 1) return [];
  if (meta.id.startsWith("tt")) {
    const eps = await loadCinemetaEpisodes(meta.id, opts.tmdbKey);
    return (eps ?? []).filter((e) => e.season === season);
  }
  if (meta.id.startsWith("tmdb:tv:") && opts.tmdbKey) {
    const tvId = parseInt(meta.id.split(":")[2] ?? "", 10);
    if (!Number.isFinite(tvId)) return [];
    return tmdbSeason(opts.tmdbKey, tvId, season);
  }
  const eps = await getNonStandardEpisodes(meta);
  return (eps ?? []).filter((e) => animeSeasonKey(e) === season);
}

export async function fetchEpisodeList(
  meta: Meta,
  opts: { tmdbKey: string },
): Promise<PlayEpisode[]> {
  if (meta.type !== "series" && !isAnimeId(meta.id)) return [];
  if (meta.id.startsWith("tt")) return (await loadCinemetaEpisodes(meta.id, opts.tmdbKey)) ?? [];
  if (meta.id.startsWith("tmdb:tv:") && opts.tmdbKey) {
    const seasons = await fetchSeasonList(meta, opts);
    const all: PlayEpisode[] = [];
    for (const s of seasons) all.push(...(await fetchSeasonEpisodes(meta, s, opts)));
    return all;
  }
  return (await getNonStandardEpisodes(meta)) ?? [];
}

export function nextUnwatchedAfter(
  eps: PlayEpisode[],
  from: { season: number; episode: number },
  isWatched: (season: number, episode: number) => boolean,
  skip?: (season: number, episode: number) => boolean,
): PlayEpisode | null {
  const sorted = eps
    .filter((e) => e.season >= 1)
    .slice()
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
  let idx = sorted.findIndex((e) => e.season === from.season && e.episode === from.episode);
  if (idx < 0) idx = 0;
  for (let i = idx; i < sorted.length; i++) {
    if (skip?.(sorted[i].season, sorted[i].episode)) continue;
    if (!isWatched(sorted[i].season, sorted[i].episode)) return sorted[i];
  }
  return null;
}

function computeAdjacent(
  eps: PlayEpisode[],
  current: { season: number; episode: number },
  skip?: (season: number, episode: number) => boolean,
): Adjacent {
  const idx = eps.findIndex((v) => v.season === current.season && v.episode === current.episode);
  if (idx === -1) return { prev: null, next: null };
  let prev: PlayEpisode | null = null;
  let next: PlayEpisode | null = null;
  for (let i = idx - 1; i >= 0; i--) {
    if (skip?.(eps[i].season, eps[i].episode)) continue;
    prev = eps[i];
    break;
  }
  for (let i = idx + 1; i < eps.length; i++) {
    if (skip?.(eps[i].season, eps[i].episode)) continue;
    next = eps[i];
    break;
  }
  return { prev, next };
}

function animeCurrentIndex(
  eps: PlayEpisode[],
  current: { season: number; episode: number },
  hint: { kitsuStreamId?: string; imdbSeason?: number; imdbEpisode?: number },
): number {
  if (hint.kitsuStreamId) {
    const exact = eps.findIndex((ep) => ep.kitsuStreamId === hint.kitsuStreamId);
    if (exact >= 0) return exact;
  }
  if (hint.imdbSeason != null && hint.imdbEpisode != null) {
    const mapped = eps.findIndex(
      (ep) => ep.imdbSeason === hint.imdbSeason && ep.imdbEpisode === hint.imdbEpisode,
    );
    if (mapped >= 0) return mapped;
  }
  return eps.findIndex((ep) => ep.season === current.season && ep.episode === current.episode);
}

function animeMetaForEntry(id: string, meta: AnimeKitsuMeta | null): Meta | undefined {
  if (!meta) return undefined;
  return {
    id,
    type: "series",
    name: meta.name,
    poster: meta.poster,
    background: meta.background,
    logo: meta.logo,
  };
}

async function animeAdjacent(
  entryId: string,
  eps: PlayEpisode[],
  current: { season: number; episode: number },
  opts: {
    kitsuStreamId?: string;
    imdbSeason?: number;
    imdbEpisode?: number;
    episodeEndOffset?: number;
    skip?: (season: number, episode: number, metaId?: string) => boolean;
  },
): Promise<Adjacent> {
  const offset = opts.episodeEndOffset ?? 0;
  const idx = animeCurrentIndex(
    eps,
    {
      season: current.season,
      episode: current.episode - offset,
    },
    opts,
  );
  if (idx < 0) return { prev: null, next: null };
  const start = eps[idx];
  // Identity hints name the file's first episode; spans end relative to that entry.
  const at =
    offset > 0
      ? eps.find((ep) => ep.season === start.season && ep.episode === start.episode + offset)
      : start;
  if (!at) return { prev: null, next: null };
  const result = computeAdjacent(eps, { season: at.season, episode: at.episode }, opts.skip);
  if (result.next) return result;
  const sequel = await nextAnimeEntry(entryId);
  if (!sequel || sequel.id === entryId) return result;
  const nextEps = await getAnimeEpisodes(sequel.id);
  const first = nextEps?.find((ep) => !opts.skip?.(ep.season, ep.episode, sequel.id));
  if (!first) return result;
  return {
    ...result,
    next: { ...first, sourceMetaId: sequel.id },
    nextMeta: animeMetaForEntry(sequel.id, sequel.meta),
  };
}

async function tmdbSeason(key: string, tvId: number, season: number): Promise<PlayEpisode[]> {
  const generation = mediaCacheGeneration();
  const cacheKey = `${key}:${tvId}:${season}:${effectiveTmdbLanguage()}`;
  if (tmdbSeasonCache.has(cacheKey)) return tmdbSeasonCache.get(cacheKey)!;
  if (season < 1) return [];
  const raw = await tmdbSeasonEpisodes(key, tvId, season);
  const eps: PlayEpisode[] = raw
    .map((e) => ({
      season: e.seasonNumber,
      episode: e.episodeNumber,
      name: e.name || undefined,
      still: tmdbStillUrl(e.stillPath),
      overview: e.overview || undefined,
      rating: e.voteAverage && e.voteAverage > 0 ? e.voteAverage : undefined,
      airDate: e.airDate || undefined,
      runtime: e.runtime && e.runtime > 0 ? e.runtime : undefined,
    }))
    .sort((a, b) => a.episode - b.episode);
  if (eps.length > 0 && generation === mediaCacheGeneration())
    lruSet(tmdbSeasonCache, cacheKey, eps, SEASON_CACHE_MAX);
  return eps;
}

async function tmdbAdjacent(
  key: string,
  tvId: number,
  current: { season: number; episode: number },
  skip?: (season: number, episode: number) => boolean,
): Promise<Adjacent> {
  const cur = await tmdbSeason(key, tvId, current.season);
  const idx = cur.findIndex((e) => e.episode === current.episode);
  let prev: PlayEpisode | null = null;
  let next: PlayEpisode | null = null;
  if (idx >= 0) {
    for (let i = idx - 1; i >= 0; i--) {
      if (skip?.(cur[i].season, cur[i].episode)) continue;
      prev = cur[i];
      break;
    }
    for (let i = idx + 1; i < cur.length; i++) {
      if (skip?.(cur[i].season, cur[i].episode)) continue;
      next = cur[i];
      break;
    }
  }
  if (!prev && current.season > 1) {
    const before = await tmdbSeason(key, tvId, current.season - 1);
    for (let i = before.length - 1; i >= 0; i--) {
      if (skip?.(before[i].season, before[i].episode)) continue;
      prev = before[i];
      break;
    }
  }
  if (!next) {
    const after = await tmdbSeason(key, tvId, current.season + 1);
    for (let i = 0; i < after.length; i++) {
      if (skip?.(after[i].season, after[i].episode)) continue;
      next = after[i];
      break;
    }
  }
  return { prev, next };
}
