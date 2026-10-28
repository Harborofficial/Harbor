import { onMediaCacheClear, mediaCacheGeneration } from "@/lib/media-cache";
import type { Meta } from "@/lib/cinemeta";
import {
  buildKitsuEpisodes,
  mergeAniZipEpisodes,
  mergeTvdbEpisodes,
  mergeTmdbEpisodes,
  isTextInLanguage,
} from "@/lib/providers/anime-episode-build";
import {
  animeKitsuMeta,
  animeKitsuMetaVersion,
  animeKitsuMetaFreshUntil,
  type AnimeKitsuMeta,
} from "@/lib/providers/anime-kitsu-addon";
import { resolveAnimeEntry } from "@/lib/providers/anime-entry";
import {
  applyAnidbSeasonWindow,
  kitsuToTvdb,
  kitsuToImdb,
  kitsuToMal,
  externalToKitsu,
  kitsuToAnilist,
  animeMappingByKitsu,
} from "@/lib/providers/anime-mapping";
import { applyMalEpisodeTitles, episodesMissingTitle } from "@/lib/providers/episode-placeholder";
import { malEpisodeTitles } from "@/lib/providers/mal-episodes";
import { anilistFranchise, type AnilistFranchiseNode } from "@/lib/anilist/relations";
import { anilistArtById } from "@/lib/anilist/browse";
import { animeRecommendations } from "./anime-recommendations";
import { enrichEpisodes } from "@/lib/providers/anime-episode-enrich";
import { harborImdbEpisodes } from "@/lib/providers/harbor-imdb";
import { fanartMovie, fanartTv } from "@/lib/providers/fanart";
import { fetchTvdbArtwork } from "@/lib/providers/tvdb-proxy";
import { tvdbEpisodesByType, tvdbEpisodesAbsolute, tvdbLangFromIso1 } from "@/lib/providers/tvdb";
import {
  kitsuAnime,
  kitsuEpisodeSourceVersion,
  kitsuEpisodeSourceFreshUntil,
  kitsuCharacters,
  kitsuEpisodes,
  kitsuMainTvSeries,
  kitsuRelated,
  kitsuStreamingLinks,
  kitsuStudios,
  parseKitsuId,
  type KitsuEpisode,
  type KitsuStreamer,
} from "@/lib/providers/kitsu";
import { tmdbAnimeLogo, tmdbDetails, tmdbSeasonEpisodes } from "@/lib/providers/tmdb";
import type { Episode as TmdbEpisode } from "@/lib/providers/tmdb/tmdb-details";
import type { CastEntry, TmdbDetail } from "@/lib/providers/tmdb";
import type { Settings } from "@/lib/settings";

export type FranchiseEntry = {
  meta: Meta;
  year: number;
  startDate?: string;
  episodeCount?: number;
  subtype?: string;
  isCurrent: boolean;
  isUpcoming: boolean;
};

export type AnimeDetailExtras = Partial<TmdbDetail> & {
  /** Localized TMDB overviews keyed by TMDB season number (only populated when localization is active). */
  seasonOverviews?: Record<number, string>;
};

export type AnimeDetailResult = {
  detail: TmdbDetail;
  episodes: KitsuEpisode[];
  streamers: KitsuStreamer[];
  backdrops: string[];
  imdbId?: string;
  franchisePromise: Promise<FranchiseEntry[]>;
  enrichPromise: Promise<KitsuEpisode[]>;
  extrasPromise: Promise<AnimeDetailExtras>;
  heroBgPromise: Promise<string | undefined>;
  kitsuId: number;
  /** Entry requested before any single-episode special was redirected to a TV parent. */
  requestedKitsuId: number;
};

export function animeDetailUnavailable(result: AnimeDetailResult): boolean {
  // A movie legitimately has no episode rows. For a TV entry, an empty list is
  // an unavailable episode source even when the Kitsu record itself resolved.
  return result.detail.kind === "tv" && result.episodes.length === 0;
}

function emptyDetail(kind: "movie" | "tv"): TmdbDetail {
  return {
    kind,
    id: 0,
    imdbId: null,
    title: "",
    originalTitle: "",
    tagline: "",
    overview: "",
    voteCount: 0,
    status: "",
    genres: [],
    originalLanguage: "",
    spokenLanguages: [],
    productionCountries: [],
    productionCompanies: [],
    networks: [],
    productionCompaniesRich: [],
    productionCountriesRich: [],
    spokenLanguagesRich: [],
    networksRich: [],
    trailerYtId: null,
    trailerCandidates: [],
    extraVideos: [],
    gallery: { backdrops: [], posters: [], logos: [] },
    cast: [],
    crew: [],
    directors: [],
    writers: [],
    creators: [],
    producers: [],
    composer: [],
    cinematography: [],
    editor: [],
    recommendations: [],
    similar: [],
    seasons: [],
    numberOfSeasons: 0,
    numberOfEpisodes: 0,
    keywords: [],
  };
}

const STATUS_LABELS: Record<string, string> = {
  current: "Currently Airing",
  finished: "Finished Airing",
  tba: "TBA",
  unreleased: "Unreleased",
  upcoming: "Upcoming",
};

const STUDIO_ROLE_RANK: Record<string, number> = {
  studio: 0,
  production: 1,
  licensor: 2,
};

const FRANCHISE_ROLES = new Set(["sequel", "prequel", "parent_story"]);
const FRANCHISE_MAX_DEPTH = 3;
const SIDE_ENTRY_SUBTYPES = new Set(["ova", "ona", "special", "music"]);

function makeFranchiseMeta(id: number, anime: import("./kitsu").KitsuAnimeDetail): Meta {
  return {
    id: `kitsu:${id}`,
    type: anime.subtype === "movie" ? "movie" : "series",
    name: anime.title,
    poster: anime.poster,
    background: anime.backdrop,
    description: anime.synopsis,
    releaseInfo: anime.year,
    imdbRating: anime.rating,
  };
}

function isAnimeUpcoming(anime: import("./kitsu").KitsuAnimeDetail | null, now: number): boolean {
  if (!anime) return false;
  const status = (anime.status ?? "").toLowerCase();
  if (status === "unreleased" || status === "upcoming" || status === "tba") return true;
  if (anime.startDate) {
    const t = new Date(anime.startDate).getTime();
    if (Number.isFinite(t) && t > now) return true;
  }
  return false;
}

async function buildFranchise(
  rootId: number,
  rootAnime: import("./kitsu").KitsuAnimeDetail,
): Promise<FranchiseEntry[]> {
  const now = Date.now();
  const anilistPromise = anilistFranchise(rootId).catch(() => [] as AnilistFranchiseNode[]);
  const items = new Map<number, FranchiseEntry>();
  items.set(rootId, {
    meta: makeFranchiseMeta(rootId, rootAnime),
    year: parseInt(rootAnime.year ?? "", 10) || 0,
    startDate: rootAnime.startDate,
    episodeCount: rootAnime.episodeCount,
    subtype: rootAnime.subtype,
    isCurrent: true,
    isUpcoming: isAnimeUpcoming(rootAnime, now),
  });

  const visited = new Set<number>([rootId]);
  let relatedWave: Promise<{ id: number; related: Awaited<ReturnType<typeof kitsuRelated>> }[]> =
    kitsuRelated(rootId).then((related) => [{ id: rootId, related }]);
  let depth = 0;

  while (depth < FRANCHISE_MAX_DEPTH) {
    const relatedLists = await relatedWave;
    const newIds: number[] = [];
    for (const { related } of relatedLists) {
      for (const r of related) {
        if (!FRANCHISE_ROLES.has(r.role.toLowerCase())) continue;
        const m = parseKitsuId(r.meta.id);
        if (!m || items.has(m) || visited.has(m)) continue;
        if (!newIds.includes(m)) newIds.push(m);
      }
    }
    if (newIds.length === 0) break;
    for (const id of newIds) visited.add(id);
    const nextWave = Promise.all(
      newIds.map((id) => kitsuRelated(id).then((related) => ({ id, related }))),
    );
    const animes = await Promise.all(newIds.map((id) => kitsuAnime(id)));
    const alive = new Set<number>();
    for (let i = 0; i < newIds.length; i++) {
      const id = newIds[i];
      const a = animes[i];
      if (!a) continue;
      items.set(id, {
        meta: makeFranchiseMeta(id, a),
        year: parseInt(a.year ?? "", 10) || 0,
        startDate: a.startDate,
        episodeCount: a.episodeCount,
        subtype: a.subtype,
        isCurrent: false,
        isUpcoming: isAnimeUpcoming(a, now),
      });
      alive.add(id);
    }
    if (alive.size === 0) break;
    relatedWave = nextWave.then((lists) => lists.filter((l) => alive.has(l.id)));
    depth++;
  }

  const rootAnilist = await anilistPromise;
  const siblingIds = [...items.values()]
    .filter((e) => !e.isCurrent)
    .sort((a, b) => (a.year || 9999) - (b.year || 9999))
    .map((e) => parseKitsuId(e.meta.id))
    .filter((x): x is number => x != null)
    .slice(0, 2);
  const siblingBatches = await Promise.all(
    siblingIds.map((id) => anilistFranchise(id).catch(() => [] as AnilistFranchiseNode[])),
  );
  const anilistById = new Map<number, AnilistFranchiseNode>();
  for (const n of [rootAnilist, ...siblingBatches].flat()) anilistById.set(n.id, n);
  const anilistNodes = [...anilistById.values()];
  const anilistEntries: FranchiseEntry[] = anilistNodes.map((n) => ({
    meta: {
      id: `anilist:${n.id}`,
      type: n.type,
      name: n.name,
      poster: n.poster,
      background: n.banner,
      description: n.description,
      releaseInfo: n.year != null ? String(n.year) : undefined,
      imdbRating: n.rating,
    },
    year: n.year ?? 0,
    startDate: n.startDate,
    episodeCount: n.episodes,
    subtype: n.format,
    isCurrent: false,
    isUpcoming: n.upcoming,
  }));

  const score = (e: FranchiseEntry) =>
    (e.isCurrent ? 1000 : 0) +
    (e.meta.id.startsWith("kitsu:") ? 4 : 0) +
    (e.startDate ? 2 : 0) +
    ((e.episodeCount ?? 0) > 0 ? 1 : 0);
  const ORD: Record<string, string> = {
    first: "1",
    second: "2",
    third: "3",
    fourth: "4",
    fifth: "5",
    sixth: "6",
    seventh: "7",
    eighth: "8",
  };
  const norm = (s: string) => {
    let x = s
      .trim()
      .replace(/^[A-Z][A-Z0-9]{1,5}:\s*/, "")
      .toLowerCase();
    for (const w in ORD) x = x.replace(new RegExp(`\\b${w}\\b`, "g"), ORD[w]);
    const seasonM = x.match(/(\d+)\s*(?:st|nd|rd|th)?\s*season|season\s*(\d+)/);
    const partM = x.match(/(\d+)\s*(?:st|nd|rd|th)?\s*(?:part|cour)|(?:part|cour)\s*(\d+)/);
    const seasonNum = seasonM ? (seasonM[1] ?? seasonM[2] ?? "") : "";
    const partNum = partM ? (partM[1] ?? partM[2] ?? "") : "";
    const trailNum = !seasonNum && !partNum ? (x.match(/\s(\d{1,2})\s*$/)?.[1] ?? "") : "";
    const num = [seasonNum, partNum].filter(Boolean).join("p") || trailNum;
    const base = x
      .replace(/\d+\s*(?:st|nd|rd|th)?\s*(?:season|part|cour)|(?:season|part|cour)\s*\d+/g, " ")
      .replace(/\s+\d{1,2}\s*$/, " ")
      .replace(/[^a-z0-9]+/g, "")
      .replace(/ou/g, "o")
      .replace(/oo/g, "o")
      .replace(/uu/g, "u");
    return num ? `${base}#${num}` : base;
  };
  const byName = new Map<string, FranchiseEntry>();
  for (const e of [...items.values(), ...anilistEntries]) {
    const key = norm(e.meta.name);
    if (!key) continue;
    const prev = byName.get(key);
    if (!prev || score(e) > score(prev)) byName.set(key, e);
  }
  const survivors = Array.from(byName.values()).filter(
    (e) => e.isCurrent || e.isUpcoming || !!e.startDate || (e.episodeCount ?? 0) > 0,
  );
  const resolved: FranchiseEntry[] = [];
  const seenId = new Set<string>();
  for (const e of survivors) {
    let id = e.meta.id;
    if (parseKitsuId(id) == null) {
      const ext = id.match(/^(anilist|mal|anidb):(\d+)$/);
      if (ext) {
        const source = ext[1] === "mal" ? "myanimelist" : ext[1];
        const k = await externalToKitsu(source, Number(ext[2])).catch(() => null);
        if (k != null) id = `kitsu:${k}`;
      }
    }
    if (seenId.has(id)) continue;
    seenId.add(id);
    resolved.push(id === e.meta.id ? e : { ...e, meta: { ...e.meta, id } });
  }
  return resolved.sort((a, b) => {
    const ad = a.startDate ?? "9999";
    const bd = b.startDate ?? "9999";
    return ad.localeCompare(bd);
  });
}

export type FranchiseTag = { kind: "season" | "movie"; seasonNum: number; short: string };

const SHORT_SUBTYPES = new Set(["ona", "ova", "special", "music", "one_shot"]);

export function isFranchiseExtra(f: FranchiseEntry): boolean {
  if (f.meta.type === "movie") return true;
  const sub = (f.subtype ?? "").toLowerCase();
  if (sub === "ona" && f.meta.type === "series" && (f.episodeCount ?? 0) > 1) return false;
  if (SHORT_SUBTYPES.has(sub)) return true;
  const airingSeason = f.meta.type === "series" && (f.isCurrent || f.isUpcoming);
  return (f.episodeCount ?? 0) === 1 && !airingSeason;
}

export function franchiseTags(franchise: FranchiseEntry[]): FranchiseTag[] {
  let s = 0;
  return franchise.map((f) => {
    if (isFranchiseExtra(f)) {
      return { kind: "movie", seasonNum: 0, short: "MOV" };
    }
    s += 1;
    return { kind: "season", seasonNum: s, short: `S${s}` };
  });
}

const FRANCHISE_CAST_CACHE = new Map<string, CastEntry[]>();

function buildSimilarRails(
  anilistRecs: Meta[],
  genreSimilar: Meta[],
  franchiseIds: Set<string>,
): { moreLikeThis: Meta[]; youMightLike: Meta[] } {
  const similarPool: Meta[] = [];
  const poolSeen = new Set<string>();
  const poolNames = new Set<string>();
  for (const m of [...anilistRecs, ...genreSimilar]) {
    const nameKey = m.name.trim().toLowerCase();
    if (franchiseIds.has(m.id) || poolSeen.has(m.id) || poolNames.has(nameKey)) continue;
    poolSeen.add(m.id);
    poolNames.add(nameKey);
    similarPool.push(m);
  }
  return { moreLikeThis: similarPool.slice(0, 14), youMightLike: similarPool.slice(14, 28) };
}

type EpisodeSubscriber = (episodes: KitsuEpisode[], kitsuId: number) => void;
const DETAIL_MAX_AGE = 5 * 60_000;
const DETAIL_RETRIES = 2;
const loadedSourceVersions = new WeakMap<AnimeDetailResult, string>();
const detailCache = new Map<
  string,
  { expires: number; sourceVersion: string; value: AnimeDetailResult }
>();
function sourceFreshness(metaId: string, kitsuId: number): number[] {
  return [
    animeKitsuMetaFreshUntil?.(metaId),
    animeKitsuMetaFreshUntil?.(`kitsu:${kitsuId}`),
    kitsuEpisodeSourceFreshUntil?.(kitsuId),
  ].filter((time): time is number => typeof time === "number" && Number.isFinite(time) && time > 0);
}
function sourceVersion(metaId: string, kitsuId: number): string {
  return JSON.stringify([
    animeKitsuMetaVersion?.(metaId),
    animeKitsuMetaVersion?.(`kitsu:${kitsuId}`),
    kitsuEpisodeSourceVersion?.(kitsuId),
  ]);
}
function sourceExpiry(metaId: string, kitsuId: number): number | undefined {
  const freshness = sourceFreshness(metaId, kitsuId);
  return freshness.length === 0 ? undefined : Math.min(...freshness);
}
function detailExpiry(metaId: string, kitsuId: number): number {
  const now = Date.now();
  const expiry = sourceExpiry(metaId, kitsuId);
  if (expiry === undefined) return now + DETAIL_MAX_AGE;
  // An outage may return usable stale sources; do not grant them a new full TTL.
  return expiry <= now ? now + 30_000 : expiry;
}

const detailInflight = new Map<
  string,
  {
    promise: Promise<AnimeDetailResult | null>;
    listeners: Set<EpisodeSubscriber>;
    early?: { episodes: KitsuEpisode[]; kitsuId: number };
  }
>();

onMediaCacheClear(() => {
  detailCache.clear();
  detailInflight.clear();
});

function detailKey(settings: Settings, meta: Meta): string {
  return JSON.stringify([
    meta.id,
    meta.imdbRating,
    settings.tmdbLanguage,
    settings.uiLanguage,
    settings.tmdbKey,
    settings.tvdbKey,
    settings.fanartKey,
    settings.tmdbImageLangs,
  ]);
}

function publish(listener: EpisodeSubscriber, episodes: KitsuEpisode[], kitsuId: number): void {
  try {
    listener(episodes, kitsuId);
  } catch {
    /* A view cannot reject a shared provider load. */
  }
}

function beginDetailLoad(
  settings: Settings,
  meta: Meta,
  key: string,
  listeners: Set<EpisodeSubscriber>,
  retry: number,
  maxAge?: number,
): Promise<AnimeDetailResult | null> {
  const shared = detailInflight.get(key);
  if (shared) {
    for (const listener of listeners) {
      shared.listeners.add(listener);
      if (shared.early) publish(listener, shared.early.episodes, shared.early.kitsuId);
    }
    return shared.promise;
  }
  const generation = mediaCacheGeneration();
  const pending: NonNullable<ReturnType<typeof detailInflight.get>> = {
    listeners,
    promise: Promise.resolve(null),
  };
  pending.promise = loadAnimeDetails(
    settings,
    meta,
    (episodes, kitsuId) => {
      if (generation !== mediaCacheGeneration()) return;
      pending.early = { episodes, kitsuId };
      for (const listener of pending.listeners) publish(listener, episodes, kitsuId);
    },
    maxAge,
  )
    .then((result) => {
      if (!result || result.episodes.length === 0 || generation !== mediaCacheGeneration())
        return result;
      const loadedVersion =
        loadedSourceVersions.get(result) ?? sourceVersion(meta.id, result.kitsuId);
      if (loadedVersion !== sourceVersion(meta.id, result.kitsuId)) {
        // A provider updated while this request was in flight. Retry once or
        // twice so the caller receives the new snapshot, but never recurse
        // forever when caches are being evicted concurrently.
        if (detailInflight.get(key) === pending) detailInflight.delete(key);
        if (retry >= DETAIL_RETRIES) return result;
        return beginDetailLoad(settings, meta, key, new Set(pending.listeners), retry + 1);
      }
      const previous = detailCache.get(key);
      if (previous && previous.sourceVersion === loadedVersion) {
        // A provider TTL expired but its content fingerprint did not change.
        // Keep the mounted snapshot and only extend its reuse deadline.
        previous.expires = detailExpiry(meta.id, result.kitsuId);
        return previous.value;
      }
      const entry = {
        expires: detailExpiry(meta.id, result.kitsuId),
        sourceVersion: loadedVersion,
        value: result,
      };
      detailCache.set(key, entry);
      while (detailCache.size > 16) detailCache.delete(detailCache.keys().next().value!);
      void result.enrichPromise
        .then((episodes) => {
          if (
            detailCache.get(key) !== entry ||
            entry.sourceVersion !== sourceVersion(meta.id, result.kitsuId)
          )
            return;
          entry.value = { ...result, episodes };
          entry.expires = detailExpiry(meta.id, result.kitsuId);
        })
        .catch(() => {});
      return result;
    })
    .finally(() => {
      if (detailInflight.get(key) === pending) detailInflight.delete(key);
      listeners.clear();
    });
  detailInflight.set(key, pending);
  return pending.promise;
}

export function animeDetailsNeedRefresh(settings: Settings, meta: Meta): boolean {
  const hit = detailCache.get(detailKey(settings, meta));
  if (!hit || hit.sourceVersion !== sourceVersion(meta.id, hit.value.kitsuId)) return true;
  const expiry = sourceExpiry(meta.id, hit.value.kitsuId);
  return expiry === undefined ? hit.expires <= Date.now() : expiry <= Date.now();
}

export function animeDetails(
  settings: Settings,
  meta: Meta,
  onEpisodesReady?: EpisodeSubscriber,
  retry = 0,
  maxAge?: number,
): Promise<AnimeDetailResult | null> {
  const key = detailKey(settings, meta);
  if (maxAge === 0) detailCache.delete(key);
  const hit = detailCache.get(key);
  if (hit) {
    if (onEpisodesReady) publish(onEpisodesReady, hit.value.episodes, hit.value.kitsuId);
    if (hit.sourceVersion === sourceVersion(meta.id, hit.value.kitsuId)) {
      const now = Date.now();
      if (hit.expires > now) return Promise.resolve(hit.value);
      const expiry = sourceExpiry(meta.id, hit.value.kitsuId);
      if (expiry !== undefined && expiry > now) {
        // Another consumer already refreshed the provider sources; extend the
        // snapshot instead of rebuilding it again for the same content.
        hit.expires = expiry;
        return Promise.resolve(hit.value);
      }
    } else {
      detailCache.delete(key);
    }
  }
  const listeners = new Set<EpisodeSubscriber>(onEpisodesReady ? [onEpisodesReady] : []);
  return beginDetailLoad(settings, meta, key, listeners, retry, maxAge);
}

async function loadAnimeDetails(
  settings: Settings,
  meta: Meta,
  onEpisodesReady?: (episodes: KitsuEpisode[], kitsuId: number) => void,
  maxAge?: number,
): Promise<AnimeDetailResult | null> {
  let kitsuId = parseKitsuId(meta.id);
  let directMeta: AnimeKitsuMeta | null = null;
  let originalAddonVersion = animeKitsuMetaVersion?.(meta.id);
  if (kitsuId == null) {
    const entry = await resolveAnimeEntry(meta.id, maxAge).catch(() => null);
    if (entry) {
      kitsuId = entry.kitsuId;
      directMeta = entry.meta;
      originalAddonVersion = animeKitsuMetaVersion?.(meta.id);
    }
  }
  if (kitsuId == null) return null;
  const requestedKitsuId = kitsuId;

  let anime = await kitsuAnime(kitsuId, maxAge);
  if (
    anime &&
    (anime.episodeCount == null || anime.episodeCount <= 1) &&
    SIDE_ENTRY_SUBTYPES.has((anime.subtype ?? "").toLowerCase())
  ) {
    const mainTv = await kitsuMainTvSeries(kitsuId).catch(() => null);
    if (mainTv != null && mainTv !== kitsuId) {
      const mainAnime = await kitsuAnime(mainTv);
      if (mainAnime) {
        kitsuId = mainTv;
        anime = mainAnime;
      }
    }
  }
  if (!anime) return null;
  let addonVersion: number | undefined;
  let kitsuVersion: number | undefined;
  const addonMetaPromise = (
    directMeta && parseKitsuId(directMeta.id) === kitsuId && directMeta.videos.length > 0
      ? Promise.resolve(directMeta)
      : animeKitsuMeta(`kitsu:${kitsuId}`, maxAge).catch(() => null)
  ).then((addon) => {
    if (meta.id === `kitsu:${kitsuId}`) originalAddonVersion = animeKitsuMetaVersion?.(meta.id);
    addonVersion = animeKitsuMetaVersion?.(`kitsu:${kitsuId}`);
    return addon;
  });
  // The addon's video IDs are immediately playable. Publish them before waiting
  // for characters, translations, mappings, and the full TVDB episode catalog.
  void addonMetaPromise
    .then((addon) => {
      if (addon?.videos.length) onEpisodesReady?.(buildKitsuEpisodes(addon, []), kitsuId);
    })
    .catch(() => {});

  const kind: "movie" | "tv" = anime.subtype === "movie" ? "movie" : "tv";
  const iso1 = settings.tmdbLanguage || settings.uiLanguage || "en";
  const localized = iso1.split("-")[0]?.toLowerCase() !== "en";

  // Queue the episode work before optional franchise/character requests.
  const rawEpisodesPromise = kitsuEpisodes(kitsuId, 100, maxAge).then((rows) => {
    kitsuVersion = kitsuEpisodeSourceVersion?.(kitsuId);
    return rows;
  });
  const streamersPromise = kitsuStreamingLinks(kitsuId).catch(() => []);
  const franchisePromise = buildFranchise(kitsuId, anime).catch(() => [] as FranchiseEntry[]);

  // Start the optional rails alongside the main batch, but do not await them
  // here: the episode grid only needs the values below.
  const recommendationPoolPromise = animeRecommendations(kitsuId).catch(() => [] as Meta[]);

  const charactersPromise = kitsuCharacters(kitsuId, 30).catch(() => []);
  const relatedPromise = kitsuRelated(kitsuId).catch(() => []);
  const studiosPromise = kitsuStudios(kitsuId).catch(() => []);
  const aniZipPromise = animeMappingByKitsu(kitsuId, ["themoviedb_id", "mal_id"]).catch(() => null);
  const tvdbEpisodesPromise = kitsuToTvdb(kitsuId)
    .then((tid) => {
      if (!tid) return null;
      const lang = tvdbLangFromIso1(settings.tmdbLanguage || settings.uiLanguage);
      const fetchAll = (l: string) =>
        Promise.all([
          tvdbEpisodesByType(settings.tvdbKey ?? "", tid, "default", l),
          tvdbEpisodesAbsolute(settings.tvdbKey ?? "", tid, l),
        ]).then(([def, abs]) => {
          const all = [...def, ...abs];
          const unique = new Map(all.map((e) => [e.id, e]));
          return Array.from(unique.values());
        });
      return Promise.all([
        fetchAll(lang),
        lang !== "eng" ? fetchAll("eng").catch(() => null) : Promise.resolve(null),
      ]).then(([loc, en]) => ({ loc, en }));
    })
    .catch(() => null);
  const [addonMeta, kitsuRawEpisodes, streamers, aniZip] = await Promise.all([
    addonMetaPromise,
    rawEpisodesPromise,
    streamersPromise,
    aniZipPromise,
  ]);

  const episodes = buildKitsuEpisodes(addonMeta, kitsuRawEpisodes);
  const tmdbEpisodesPromise = (async () => {
    let tmdbEpsRaw: TmdbEpisode[] | null = null;
    let tmdbEnRaw: TmdbEpisode[] | null = null;
    if (localized && settings.tmdbKey && kind === "tv") {
      const tmdbEpisodesId = Number(aniZip?.mappings?.themoviedb_id);
      if (tmdbEpisodesId > 0) {
        // TMDB sometimes merges multiple cours into a single generalized season (e.g. a 25-episode
        // "season 1" covering two 12/13-episode seasons). AniZip carries the real per-cour season
        // numbers, so fetch every season it reports plus season 1 (where TMDB may have merged them)
        // and concatenate, letting the merge match by absolute episode number.
        const seasons = new Set<number>([1]);
        for (const az of Object.values(aniZip?.episodes ?? {})) {
          if (az.seasonNumber != null && az.seasonNumber > 0) seasons.add(az.seasonNumber);
        }
        const fetchTmdb = (l: string) =>
          Promise.all(
            Array.from(seasons).map((s) =>
              tmdbSeasonEpisodes(settings.tmdbKey, tmdbEpisodesId, s, l).catch(() => null),
            ),
          ).then((arr) => {
            const merged = arr.flat().filter((e): e is TmdbEpisode => e != null);
            return merged.length > 0 ? merged : null;
          });
        const isoBase = iso1.split("-")[0]?.toLowerCase();
        const [loc, en] = await Promise.all([
          fetchTmdb(iso1),
          isoBase && isoBase !== "en"
            ? fetchTmdb("en").catch(() => null)
            : Promise.resolve<TmdbEpisode[] | null>(null),
        ]);
        tmdbEpsRaw = loc;
        tmdbEnRaw = en;
      }
    }
    return { loc: tmdbEpsRaw, en: tmdbEnRaw };
  })();
  mergeAniZipEpisodes(episodes, aniZip, { lang: localized ? iso1 : undefined, targetLang: iso1 });
  // AniZip often carries a new season's ids before its episode records, and
  // the addon labels the cour "season 1" — the window must land before the
  // TVDB merge or the cour's identity-less rows match franchise season 1.
  await applyAnidbSeasonWindow(episodes, kitsuId);
  let seriesImdb = aniZip?.mappings?.imdb_id ?? episodes.find((e) => e.imdbId)?.imdbId ?? null;
  if (!seriesImdb) seriesImdb = await kitsuToImdb(kitsuId).catch(() => null);
  // Fetch ratings independently of translations, title fallbacks and artwork.
  if (seriesImdb) void harborImdbEpisodes(seriesImdb).catch(() => {});
  if (seriesImdb?.startsWith("tt")) {
    for (const ep of episodes) {
      if (ep.thumbnailFallback) continue;
      const s = ep.imdbSeason ?? 1;
      const e = ep.imdbEpisode ?? ep.absoluteNumber ?? ep.number;
      ep.thumbnailFallback = `https://episodes.metahub.space/${seriesImdb}/${s}/${e}/w780.jpg`;
    }
  }
  // Publish the mapped base once. Optional translations and artwork work on a
  // private snapshot, so React never observes partially mutated episode rows.
  const enrichedEpisodes = episodes.map((episode) => ({ ...episode }));
  const enrichMetadataPromise = (async () => {
    const [tvdbEpsRaw, tmdb] = await Promise.all([tvdbEpisodesPromise, tmdbEpisodesPromise]);
    mergeTvdbEpisodes(enrichedEpisodes, tvdbEpsRaw?.loc ?? null, {
      lang: localized ? iso1 : undefined,
      targetLang: iso1,
      englishEpisodes: tvdbEpsRaw?.en,
    });
    mergeTmdbEpisodes(enrichedEpisodes, tmdb.loc, {
      lang: localized ? iso1 : undefined,
      targetLang: iso1,
      englishEpisodes: tmdb.en,
    });
    // Fall back to English titles/overviews when the localized translation is missing (providers
    // otherwise fall back to the original, e.g. Japanese for anime). `targetLang` keeps this pass
    // from overwriting a title the user already has in their own language.
    if (localized) {
      if (tvdbEpsRaw?.en)
        mergeTvdbEpisodes(enrichedEpisodes, tvdbEpsRaw.en, {
          targetLang: iso1,
          fallbackOnly: true,
        });
      if (tmdb.en) mergeTmdbEpisodes(enrichedEpisodes, tmdb.en, { targetLang: iso1 });
    }
    // Last resort: MAL names episodes the other providers leave unnamed (it
    // carries English and romaji early). Only rows with no real title are filled.
    if (episodesMissingTitle(enrichedEpisodes)) {
      const malId = aniZip?.mappings?.mal_id ?? (await kitsuToMal(kitsuId).catch(() => null));
      if (malId != null) {
        const malEps = await malEpisodeTitles(malId).catch(() => null);
        applyMalEpisodeTitles(enrichedEpisodes, malEps);
      }
    }
  })().catch(() => {});

  // AniZip has no mapping for not-yet-indexed cours (e.g. Bleach TYBW cour 4).
  // applyAnidbSeasonWindow above already attached the AniDB id (ARM) plus the
  // anime-lists season window to any episode AniZip left without coordinates.

  const toCast = (chars: Awaited<ReturnType<typeof kitsuCharacters>>): CastEntry[] =>
    chars.map((c, i) => ({
      id: c.id,
      name: c.name,
      character: c.voiceActor ?? (c.role === "main" ? "Main" : "Supporting"),
      profilePath: c.image ?? null,
      order: i,
    }));
  const castKeys = [meta.id, `kitsu:${kitsuId}`];

  // Recommendation rails are optional chrome: they settle in the background so
  // a slow or rate-limited AniList response cannot hold the episode grid.
  const recommendationsPromise = Promise.all([recommendationPoolPromise, relatedPromise])
    .then(([pool, related]) =>
      buildSimilarRails(
        pool,
        [],
        new Set([meta.id, `kitsu:${kitsuId}`, ...related.map((r) => r.meta.id)]),
      ),
    )
    .catch(() => ({ moreLikeThis: [] as Meta[], youMightLike: [] as Meta[] }));

  const networks = Array.from(new Set(streamers.map((s) => s.service)));

  const detail: TmdbDetail = {
    ...emptyDetail(kind),
    id: anime.id,
    imdbId: seriesImdb ?? addonMeta?.imdb_id ?? null,
    title: anime.title,
    originalTitle: anime.title,
    overview: anime.synopsis,
    poster: anime.poster,
    backdrop: anime.backdrop,
    year: anime.year,
    rating: meta.imdbRating ?? anime.rating,
    voteCount: anime.popularityRank ?? 0,
    runtime: anime.episodeLength ? `${anime.episodeLength}m` : undefined,
    status: anime.status ? (STATUS_LABELS[anime.status] ?? anime.status) : "",
    genres: anime.genres,
    originalLanguage: "ja",
    spokenLanguages: ["Japanese"],
    productionCountries: ["Japan"],
    productionCompanies: [],
    networks,
    trailerYtId: anime.trailerYtId ?? null,
    trailerCandidates: anime.trailerYtId ? [anime.trailerYtId] : [],
    gallery: { backdrops: anime.backdrop ? [anime.backdrop] : [], posters: [], logos: [] },
    cast: [],
    recommendations: [],
    similar: [],
    numberOfEpisodes: anime.episodeCount ?? 0,
    numberOfSeasons: kind === "tv" ? 1 : 0,
    firstAirDate: anime.startDate,
    lastAirDate: anime.endDate,
  };

  const enrichPromise = enrichMetadataPromise
    .then(() => enrichEpisodes(enrichedEpisodes, settings, kitsuId, seriesImdb))
    .then(() =>
      enrichedEpisodes.every((ep, i) =>
        Object.keys(ep).every(
          (key) => ep[key as keyof KitsuEpisode] === episodes[i][key as keyof KitsuEpisode],
        ),
      )
        ? episodes
        : enrichedEpisodes,
    )
    .catch(() => episodes);

  const anilistArtPromise: Promise<{ banner?: string; cover?: string }> = kitsuToAnilist(kitsuId)
    .then((aid) => (aid ? anilistArtById(aid) : {}))
    .catch(() => ({}));

  const firstArtBatch = Promise.all([
    settings.tmdbKey
      ? tmdbAnimeLogo(settings.tmdbKey, anime.title, anime.year, kind).catch(() => null)
      : Promise.resolve(null),
    settings.fanartKey && kind === "tv"
      ? kitsuToTvdb(kitsuId).catch(() => null)
      : Promise.resolve(null),
    fetchTvdbArtwork({ kitsuId }).catch(() => null),
  ]);

  const heroBgPromise: Promise<string | undefined> = Promise.all([firstArtBatch, anilistArtPromise])
    .then(
      ([[tmdbHit, , tvdbArt], aniArt]) =>
        aniArt.banner ?? anime.backdrop ?? tmdbHit?.backdrop ?? tvdbArt?.backgrounds?.[0],
    )
    .catch(() => anime.backdrop);

  const extrasPromise: Promise<AnimeDetailExtras> = (async () => {
    const [tmdbHit, tvdbId, tvdbArt] = await firstArtBatch;
    const aniArt = await anilistArtPromise;
    let logo: string | undefined =
      addonMeta?.logo ?? tvdbArt?.clearLogos?.[0] ?? tmdbHit?.logo ?? undefined;
    let poster = anime.poster;
    const backdrop = aniArt.banner ?? anime.backdrop;
    const gallery: string[] = [];
    const addBackdrop = (b?: string | null) => {
      if (b && !gallery.includes(b)) gallery.push(b);
    };
    addBackdrop(backdrop);
    addBackdrop(anime.backdrop);
    addBackdrop(tmdbHit?.backdrop);
    const fanartPromise =
      settings.fanartKey && kind === "movie" && tmdbHit?.tmdbId
        ? fanartMovie(settings.fanartKey, tmdbHit.tmdbId).catch(() => null)
        : settings.fanartKey && kind === "tv" && tvdbId
          ? fanartTv(settings.fanartKey, tvdbId).catch(() => null)
          : Promise.resolve(null);
    const tmdbFullId = Number(aniZip?.mappings?.themoviedb_id) || tmdbHit?.tmdbId || 0;
    const tmdbFullFromMapping = Number(aniZip?.mappings?.themoviedb_id) > 0;
    const tmdbFullPromise =
      settings.tmdbKey && tmdbFullId
        ? tmdbDetails(
            settings.tmdbKey,
            {
              id: `tmdb:${kind === "movie" ? "movie" : "tv"}:${tmdbFullId}`,
              type: kind === "movie" ? "movie" : "series",
              name: anime.title,
            } as Meta,
            localized ? iso1 : undefined,
          ).catch(() => null)
        : Promise.resolve(null);
    const [fa, fullRaw] = await Promise.all([fanartPromise, tmdbFullPromise]);
    if (fa) {
      if (!logo && fa.logo) logo = fa.logo;
      if (fa.poster) poster = fa.poster;
      for (const b of fa.backdrops) addBackdrop(b);
    }
    for (const b of tvdbArt?.backgrounds ?? []) addBackdrop(b);
    const backdrops = gallery;
    let tmdbFull: TmdbDetail | null = null;
    if (fullRaw) {
      // AniZip's themoviedb_id is authoritative per entry; the title-search id can false-positive, so it keeps the year gate.
      if (tmdbFullFromMapping) {
        tmdbFull = fullRaw;
      } else {
        const ay = Number(anime.year);
        const ty = Number(fullRaw.year);
        if (!Number.isFinite(ay) || !Number.isFinite(ty) || Math.abs(ty - ay) <= 1)
          tmdbFull = fullRaw;
      }
    }
    const [rails, characters, studios] = await Promise.all([
      recommendationsPromise,
      charactersPromise,
      studiosPromise,
    ]);
    const cast = toCast(characters);
    if (cast.length > 0) {
      for (const k of castKeys) {
        FRANCHISE_CAST_CACHE.delete(k);
        FRANCHISE_CAST_CACHE.set(k, cast);
      }
      while (FRANCHISE_CAST_CACHE.size > 100)
        FRANCHISE_CAST_CACHE.delete(FRANCHISE_CAST_CACHE.keys().next().value!);
    }
    const sortedStudios = [...studios].sort(
      (a, b) => (STUDIO_ROLE_RANK[a.role] ?? 9) - (STUDIO_ROLE_RANK[b.role] ?? 9),
    );
    const patch: AnimeDetailExtras = {
      cast,
      productionCompanies: Array.from(new Set(sortedStudios.map((studio) => studio.name))),
      logo,
      backdrop,
      poster,
      imdbId: seriesImdb ?? addonMeta?.imdb_id ?? tmdbFull?.imdbId ?? null,
      tmdbTvId: tmdbFull?.tmdbTvId,
      seasonPosters: tmdbFull?.seasonPosters,
      extraVideos: tmdbFull?.extraVideos ?? [],
      recommendations: rails.moreLikeThis,
      similar: rails.youMightLike,
      gallery: {
        backdrops: Array.from(new Set([...backdrops, ...(tmdbFull?.gallery.backdrops ?? [])])),
        posters: tmdbFull?.gallery.posters ?? [],
        logos: tmdbFull?.gallery.logos ?? [],
      },
      crew: tmdbFull?.crew ?? [],
      directors: tmdbFull?.directors ?? [],
      writers: tmdbFull?.writers ?? [],
      creators: tmdbFull?.creators ?? [],
      producers: tmdbFull?.producers ?? [],
      composer: tmdbFull?.composer ?? [],
      cinematography: tmdbFull?.cinematography ?? [],
      editor: tmdbFull?.editor ?? [],
      keywords: tmdbFull?.keywords ?? [],
    };
    if (localized && tmdbFull) {
      const overviewOk = !!tmdbFull.overview && isTextInLanguage(tmdbFull.overview, iso1);
      const titleOk = !!tmdbFull.title && isTextInLanguage(tmdbFull.title, iso1);
      if (overviewOk) patch.overview = tmdbFull.overview;
      if (titleOk) patch.title = tmdbFull.title;
      // TMDB's tv/{id} response carries per-season localized overviews; surface them so the season
      // hero can vary per season instead of showing the static series overview everywhere.
      const seasonOverviews: Record<number, string> = {};
      for (const s of tmdbFull.seasons ?? []) {
        if (s.overview && isTextInLanguage(s.overview, iso1))
          seasonOverviews[s.seasonNumber] = s.overview;
      }
      patch.seasonOverviews = seasonOverviews;
    }
    if (cast.length === 0) {
      let fallback: CastEntry[] | undefined;
      for (const k of castKeys) {
        const c = FRANCHISE_CAST_CACHE.get(k);
        if (c?.length) {
          fallback = c;
          break;
        }
      }
      if (!fallback && tmdbFull?.cast?.length) {
        fallback = tmdbFull.cast;
        for (const k of castKeys) FRANCHISE_CAST_CACHE.set(k, tmdbFull.cast);
        while (FRANCHISE_CAST_CACHE.size > 100)
          FRANCHISE_CAST_CACHE.delete(FRANCHISE_CAST_CACHE.keys().next().value!);
      }
      if (fallback) patch.cast = fallback;
    }
    return patch;
  })().catch(() => ({}) as AnimeDetailExtras);

  const result: AnimeDetailResult = {
    detail,
    episodes,
    streamers,
    backdrops: anime.backdrop ? [anime.backdrop] : [],
    imdbId: seriesImdb ?? addonMeta?.imdb_id,
    franchisePromise,
    enrichPromise,
    extrasPromise,
    heroBgPromise,
    kitsuId,
    requestedKitsuId,
  };
  loadedSourceVersions.set(
    result,
    JSON.stringify([originalAddonVersion, addonVersion, kitsuVersion]),
  );
  return result;
}
