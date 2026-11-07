import {
  pullWatchProgressFromNuvio,
  isNuvioProviderActive,
  readCachedWatchProgress,
  resolveNuvioProfileIndex,
  pullWatchedItemsFromNuvio,
  readCachedWatchedItems,
  pullDismissedNextUpKeysFromNuvio,
  readCachedDismissedNextUpKeys,
  isDismissedNextUp,
  cwKeepsCaughtUpForTimer,
} from "./nuvio-sync";
import { getNuvioAccountId, isNuvioSignedIn } from "./nuvio-client";
import type { LibraryItem } from "@/lib/stremio";
import { readResumeEntry, saveResumeMs } from "@/lib/resume";
import { isCwDismissed } from "@/lib/cw-dismiss";
import type { NuvioWatchProgress, NuvioWatchedItem } from "./nuvio-types";
import { setMovieWatchedLocal } from "@/lib/movie-watched";
import { readCachedNuvioLibrary } from "./nuvio-library";
import { localCwEntry, listLocalCw, saveLocalCw, clearLocalCw } from "@/lib/local-cw";
import { manualWatchedState } from "@/lib/manual-watched";
import { tmdbImdbCached, tmdbFromImdbCached } from "@/lib/providers/tmdb/tmdb-imdb-resolve";

const DURATION_MS = { movie: 6_300_000, series: 2_640_000 };
const PLAYBACK_ITEMS_CACHE_PREFIX = "harbor.nuvio.playback_items.";

type AliasResolver = {
  getCanonicalId: (id: string) => string;
  getAliases: (id: string) => Set<string>;
};

type NuvioIdType = "movie" | "series";

function explicitNuvioIdType(rawId: string): NuvioIdType | undefined {
  if (rawId.startsWith("series:") || rawId.startsWith("tmdb:tv:")) return "series";
  if (rawId.startsWith("movie:") || rawId.startsWith("tmdb:movie:")) return "movie";
  return undefined;
}

/**
 * Aliases for a Nuvio content ID. Numeric TMDB IDs are shared by the movie and
 * TV namespaces, so typed aliases are only generated from an explicit prefix
 * or a type known from the owning record.
 */
export function nuvioAliasVariants(rawId: string, type?: "movie" | "series"): string[] {
  if (!rawId) return [];
  const clean = rawId.replace(/^(series|movie|tmdb:tv|tmdb:movie|tmdb):/, "").trim();
  if (!clean) return [];
  const resolved = explicitNuvioIdType(rawId) ?? type;
  const variants = new Set<string>([rawId, clean]);
  if (resolved === "series") {
    variants.add(`series:${clean}`);
    if (/^\d+$/.test(clean)) variants.add(`tmdb:tv:${clean}`);
  } else if (resolved === "movie") {
    variants.add(`movie:${clean}`);
    if (/^\d+$/.test(clean)) variants.add(`tmdb:movie:${clean}`);
  }
  if (/^\d+$/.test(clean)) variants.add(`tmdb:${clean}`);
  return [...variants];
}

function buildSeriesAliasResolver(
  records: NuvioWatchProgress[],
  watched: NuvioWatchedItem[],
  libMap: Map<string, any>,
  customAliasMap?: Map<string, string> | Record<string, string>,
): AliasResolver {
  const parent = new Map<string, string>();
  const find = (i: string): string => {
    if (!parent.has(i)) parent.set(i, i);
    let p = parent.get(i)!;
    if (p !== i) {
      p = find(p);
      parent.set(i, p);
    }
    return p;
  };
  const union = (a: string, b: string) => {
    if (!a || !b) return;
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootA, rootB);
    }
  };

  const registerVariants = (rawId: string, type?: NuvioIdType) => {
    if (!rawId) return;
    for (const variant of nuvioAliasVariants(rawId, type)) union(rawId, variant);
  };

  // 1. Explicit / custom aliases
  if (customAliasMap) {
    const entries =
      customAliasMap instanceof Map ? customAliasMap.entries() : Object.entries(customAliasMap);
    for (const [k, v] of entries) {
      registerVariants(k);
      registerVariants(v);
      union(k, v);
    }
  }

  // 2. Register IDs with the type each owner knows, so numeric movie and TV
  // namespaces never merge through manufactured aliases.
  for (const r of records) {
    if (r.content_id)
      registerVariants(r.content_id, r.season != null || r.episode != null ? "series" : undefined);
  }
  for (const w of watched) {
    if (!w.content_id) continue;
    const type =
      w.content_type === "movie" || w.content_type === "series"
        ? w.content_type
        : w.season != null || w.episode != null
          ? "series"
          : undefined;
    registerVariants(w.content_id, type);
  }
  const registeredLibraryIds = new Set<string>();
  for (const lib of libMap.values()) {
    if (registeredLibraryIds.has(lib.content_id)) continue;
    registeredLibraryIds.add(lib.content_id);
    const type =
      lib.content_type === "movie" || lib.content_type === "series" ? lib.content_type : undefined;
    registerVariants(lib.content_id, type);
  }

  // 3. Cached TMDB <-> IMDb lookups
  const allIds = Array.from(parent.keys());
  for (const id of allIds) {
    if (id.startsWith("tt")) {
      const tmdb = tmdbFromImdbCached(id);
      if (tmdb) {
        registerVariants(tmdb);
        union(id, tmdb);
      }
    } else if (id.startsWith("tmdb:") || /^\d+$/.test(id)) {
      const clean = id.replace(/^(series|movie|tmdb|tmdb:tv|tmdb:movie):/, "");
      const imdb =
        tmdbImdbCached(`tmdb:${clean}`) || tmdbImdbCached(`tmdb:tv:${clean}`) || tmdbImdbCached(id);
      if (imdb && imdb.startsWith("tt")) {
        registerVariants(imdb);
        union(id, imdb);
      }
    }
  }

  // 4. Build component sets and select canonical ID per group.
  // Titles alone never union IDs: two distinct shows can share a name, and the
  // explicit TMDB <-> IMDb cache above is the only safe evidence for a twin.
  const components = new Map<string, Set<string>>();
  for (const key of parent.keys()) {
    const root = find(key);
    let set = components.get(root);
    if (!set) {
      set = new Set();
      components.set(root, set);
    }
    set.add(key);
  }

  const canonicalMap = new Map<string, string>();
  const aliasSets = new Map<string, Set<string>>();

  for (const [, set] of components) {
    const items = Array.from(set);
    // Prefer IMDb ID (tt...) as canonical
    const imdb = items.find((x) => /^tt\d+$/.test(x));
    // Otherwise prefer clean tmdb (tmdb:digits) or clean ID
    const tmdb = items.find((x) => /^tmdb:\d+$/.test(x));
    const canonical = imdb || tmdb || items[0];

    for (const item of items) {
      canonicalMap.set(item, canonical);
      aliasSets.set(item, set);
    }
  }

  return {
    getCanonicalId: (id: string): string => {
      const clean = id.replace(/^(series|movie|tmdb|tmdb:tv|tmdb:movie):/, "").trim();
      return (
        canonicalMap.get(id) ??
        canonicalMap.get(clean) ??
        canonicalMap.get(`tmdb:${clean}`) ??
        canonicalMap.get(`tmdb:tv:${clean}`) ??
        id
      );
    },
    getAliases: (id: string): Set<string> => {
      const clean = id.replace(/^(series|movie|tmdb|tmdb:tv|tmdb:movie):/, "").trim();
      const s =
        aliasSets.get(id) ??
        aliasSets.get(clean) ??
        aliasSets.get(`tmdb:${clean}`) ??
        aliasSets.get(`tmdb:tv:${clean}`);
      if (s) return s;
      const cleanId = clean;
      return new Set([
        id,
        cleanId,
        `tmdb:${cleanId}`,
        `tmdb:tv:${cleanId}`,
        `tmdb:movie:${cleanId}`,
        `series:${cleanId}`,
      ]);
    },
  };
}

type EpisodeResume = { ms: number; t: number; pct?: number };

function readEpisodeResume(
  ids: Iterable<string>,
  season: number | undefined,
  episode: number | undefined,
  ownerId: string,
): EpisodeResume | null {
  let best: EpisodeResume | null = null;
  for (const id of ids) {
    const entry = readResumeEntry(id, season, episode, ownerId);
    if (!entry || !(entry.ms > 0)) continue;
    if (!best || entry.t > best.t) best = { ms: entry.ms, t: entry.t, pct: entry.pct };
  }
  return best;
}

/**
 * Nuvio's watch_progress can lag behind Harbor's resume entry. When the
 * generated Next Up card has no progress for its own episode, use that exact
 * episode's resume instead. Episode identity and timestamps decide; progress
 * percentage never selects a different episode.
 */
function reconcileResumeProgress(
  items: LibraryItem[],
  records: NuvioWatchProgress[],
  watched: NuvioWatchedItem[],
  aliasResolver: AliasResolver,
  ownerId: string,
  activeProfile: boolean,
): void {
  const durations = new Map<string, number>();
  const completions = new Map<string, number>();
  const note = (
    map: Map<string, number>,
    rawId: string,
    season: number,
    episode: number,
    value: number,
  ) => {
    for (const id of [rawId, ...aliasResolver.getAliases(rawId)]) {
      const key = `${id}|${season}|${episode}`;
      map.set(key, Math.max(map.get(key) ?? 0, value));
    }
  };

  for (const record of records) {
    if (!record.content_id || record.season == null || record.episode == null) continue;
    const duration = (record.duration_seconds || 0) * 1000;
    if (duration > 0) note(durations, record.content_id, record.season, record.episode, duration);
    const position = (record.progress_seconds || 0) * 1000;
    const finished =
      (duration > 0 && position / duration >= 0.9) ||
      (record as Record<string, unknown>).watched === true;
    if (!finished || !(record.last_watched && record.last_watched > 0)) continue;
    note(completions, record.content_id, record.season, record.episode, record.last_watched);
  }
  for (const item of watched) {
    if (!item.content_id || item.season == null || item.episode == null) continue;
    const at = item.watched_at
      ? typeof item.watched_at === "number"
        ? item.watched_at
        : Date.parse(item.watched_at)
      : 0;
    if (at > 0) note(completions, item.content_id, item.season, item.episode, at);
  }

  for (const item of items) {
    if (item.type !== "series" || !item.state) continue;
    const season = item.state.season;
    const episode = item.state.episode;
    if (season == null || episode == null) continue;
    if (!item.upNext && (item.state.timeOffset ?? 0) > 0) continue;

    const ids = new Set<string>([
      item._id,
      ...(item.altIds ?? []),
      ...aliasResolver.getAliases(item._id),
    ]);
    const resume = readEpisodeResume(ids, season, episode, ownerId);
    if (!resume) continue;
    if (activeProfile && [...ids].some((id) => manualWatchedState(id, season, episode) === false)) {
      continue;
    }
    const completedAt = [...ids].reduce(
      (latest, id) => Math.max(latest, completions.get(`${id}|${season}|${episode}`) ?? 0),
      0,
    );
    if (completedAt > resume.t) continue;
    const seedAt =
      typeof (item as Record<string, unknown>).nextUpSeedAt === "number"
        ? ((item as Record<string, unknown>).nextUpSeedAt as number)
        : 0;
    if (seedAt > 0 && resume.t <= seedAt) continue;

    const pct = resume.pct;
    const percentageDuration = pct != null && pct > 0 && pct < 1 ? Math.round(resume.ms / pct) : 0;
    const knownDuration = [...ids].reduce(
      (found, id) => found || durations.get(`${id}|${season}|${episode}`) || 0,
      0,
    );
    item.state.timeOffset = resume.ms;
    item.state.duration =
      percentageDuration > 0
        ? percentageDuration
        : knownDuration > 0
          ? knownDuration
          : item.state.duration || DURATION_MS.series;
    item.state.lastWatched = new Date(resume.t).toISOString();
    if (!item.state.video_id) item.state.video_id = `${item._id}:${season}:${episode}`;
    item.upNext = false;
    if (item.waitingForAir) {
      item.waitingForAir = undefined;
      delete (item as Record<string, unknown>).keptForTimer;
    }
  }
}

export function getPlaybackItemsKey(slot: number, accountId?: string): string {
  const acc = accountId || getNuvioAccountId() || "anon";
  return `${PLAYBACK_ITEMS_CACHE_PREFIX}${acc}.slot.${slot}`;
}

/**
 * Loads cached Nuvio playback LibraryItems for a slot from memory/localStorage.
 */
export function readCachedNuvioPlaybackItems(
  slot?: number,
  accountId?: string,
  clearMissingLocal = false,
): LibraryItem[] {
  const profileIndex = slot ?? resolveNuvioProfileIndex();
  const records = readCachedWatchProgress(profileIndex, accountId);
  const watched = readCachedWatchedItems(profileIndex, accountId);
  try {
    const raw = localStorage.getItem(getPlaybackItemsKey(profileIndex, accountId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {}

  const built = buildNuvioPlaybackItems(
    records,
    profileIndex,
    watched,
    undefined,
    cwKeepsCaughtUpForTimer(),
    undefined,
    { clearMissingLocal },
  );
  writeCachedNuvioPlaybackItems(profileIndex, built, accountId);
  return built;
}

/**
 * Saves Nuvio playback LibraryItems for a slot into localStorage.
 */
export function writeCachedNuvioPlaybackItems(
  slot: number,
  items: LibraryItem[],
  accountId?: string,
): void {
  try {
    const key = getPlaybackItemsKey(slot, accountId);
    const serialized = JSON.stringify(items);
    if (localStorage.getItem(key) === serialized) return;
    localStorage.setItem(key, serialized);
  } catch {}
}

export function clearCachedPlaybackItems(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith("harbor.nuvio.playback_items.") ||
          key.startsWith("harbor.nuvio.playback_items.slot."))
      ) {
        toRemove.push(key);
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
}

/**
 * Pure builder function that transforms NuvioWatchProgress[] records and
 * NuvioWatchedItem[] history into Harbor LibraryItem[] shape, enriched with library metadata.
 */
export function buildNuvioPlaybackItems(
  records: NuvioWatchProgress[],
  profileIndex: number,
  watchedItems?: NuvioWatchedItem[],
  dismissedKeys?: Set<string>,
  keepCaughtUpForTimer = false,
  customAliasMap?: Map<string, string> | Record<string, string>,
  options?: { clearMissingLocal?: boolean },
): LibraryItem[] {
  const safeRecords = Array.isArray(records) ? records : [];
  const ownerId = `nuvio-${profileIndex}`;
  const libraryItems = readCachedNuvioLibrary(profileIndex);
  const libMap = new Map<string, (typeof libraryItems)[0]>();
  for (const lib of libraryItems) {
    libMap.set(lib.content_id, lib);
    const clean = lib.content_id.replace(/^(series|movie|tmdb|tmdb:tv|tmdb:movie):/, "");
    libMap.set(clean, lib);
    libMap.set(`tmdb:${clean}`, lib);
    libMap.set(`tmdb:tv:${clean}`, lib);
    libMap.set(`series:${clean}`, lib);
  }

  const dismissed = dismissedKeys ?? readCachedDismissedNextUpKeys(profileIndex);
  const watched = watchedItems ?? readCachedWatchedItems(profileIndex);
  const aliasResolver = buildSeriesAliasResolver(safeRecords, watched, libMap, customAliasMap);

  const isCandidateDismissed = (
    contentId: string,
    season?: number | null,
    episode?: number | null,
  ): boolean => {
    if (!contentId || dismissed.size === 0) return false;
    const aliases = aliasResolver.getAliases(contentId);
    return (
      Array.from(aliases).some((a) => isDismissedNextUp(a, season, episode, dismissed)) ||
      Array.from(aliases).some((a) => isDismissedNextUp(a, -1, -1, dismissed)) ||
      Array.from(aliases).some((a) => dismissed.has(a))
    );
  };

  // Group records by content_id so each series/movie has a single consolidated Continue Watching card
  const byContent = new Map<string, NuvioWatchProgress[]>();
  for (const r of safeRecords) {
    if (!r.content_id) continue;
    const list = byContent.get(r.content_id) ?? [];
    list.push(r);
    byContent.set(r.content_id, list);
  }

  const items: LibraryItem[] = [];
  const activeSeriesIds = new Set<string>();
  const fullyWatchedSeriesIds = new Set<string>();

  // Identify fully-watched series from watched items (whole series marked watched)
  for (const w of watched) {
    if (!w.content_id) continue;
    if (w.season == null && w.episode == null) {
      fullyWatchedSeriesIds.add(w.content_id);
      const clean = w.content_id.replace(/^(series|movie|tmdb|tmdb:tv|tmdb:movie):/, "");
      fullyWatchedSeriesIds.add(clean);
      fullyWatchedSeriesIds.add(`tmdb:${clean}`);
      fullyWatchedSeriesIds.add(`tmdb:tv:${clean}`);
      fullyWatchedSeriesIds.add(`series:${clean}`);
    }
  }

  // 1. Process active in-progress items from watch_progress
  for (const [contentId, list] of byContent) {
    list.sort((a, b) => {
      const ta = a.last_watched || (a.updated_at ? Date.parse(a.updated_at) : 0);
      const tb = b.last_watched || (b.updated_at ? Date.parse(b.updated_at) : 0);
      if (Math.abs(tb - ta) > 1000) return tb - ta;
      const sa = a.season ?? 0;
      const sb = b.season ?? 0;
      if (sa !== sb) return sb - sa;
      const ea = a.episode ?? 0;
      const eb = b.episode ?? 0;
      if (ea !== eb) return eb - ea;
      return (b.progress_seconds || 0) - (a.progress_seconds || 0);
    });

    const cleanId = contentId.replace(/^(series|movie|tmdb|tmdb:tv|tmdb:movie):/, "");
    const libMatch =
      libMap.get(contentId) ||
      libMap.get(cleanId) ||
      libMap.get(`tmdb:${cleanId}`) ||
      libMap.get(`tmdb:tv:${cleanId}`);
    const isSeries =
      libMatch?.content_type === "series" ||
      list.some(
        (r) =>
          (r.season != null && r.season > 0 && r.episode != null && r.episode > 0) ||
          (r.progress_key && (r.progress_key.includes("_s") || r.progress_key.includes(":"))),
      );

    const localMatch =
      localCwEntry(contentId, true, ownerId) || localCwEntry(contentId, false, ownerId);
    const resolvedName =
      libMatch?.name || list[0]?.name || list[0]?.title || localMatch?.name || contentId;
    const resolvedPoster = libMatch?.poster || list[0]?.poster || localMatch?.poster || undefined;
    const resolvedBackground =
      libMatch?.background || list[0]?.background || localMatch?.background || undefined;

    if (!isSeries) {
      // Movie
      const r = list[0];
      const progressSec = Math.max(0, r.progress_seconds || 0);
      const durationSec = Math.max(0, r.duration_seconds || 0);
      const durMs =
        durationSec > 0
          ? durationSec * 1000
          : localMatch?.durationMs && localMatch.durationMs > 0
            ? localMatch.durationMs
            : DURATION_MS.movie;
      let offsetMs = progressSec * 1000;

      const when =
        r.updated_at ||
        (r.last_watched ? new Date(r.last_watched).toISOString() : new Date().toISOString());
      const remoteT = r.last_watched || 0;

      // Prefer newer local playback offset if available
      const existing = readEpisodeResume(
        aliasResolver.getAliases(contentId),
        undefined,
        undefined,
        ownerId,
      );
      if (existing && existing.t > remoteT && existing.ms > 0) {
        offsetMs = existing.ms;
      }

      // Filter out movies that are finished (> 92%) or barely started (< 5 seconds)
      if (durMs > 0 && offsetMs / durMs >= 0.92) {
        if (isNuvioProviderActive() && profileIndex === resolveNuvioProfileIndex()) {
          setMovieWatchedLocal(contentId, true);
        }
        continue;
      }
      if (offsetMs < 5000 && durMs > 60000) continue;

      const item: LibraryItem = {
        _id: contentId,
        type: "movie",
        name: resolvedName,
        poster: resolvedPoster,
        background: resolvedBackground,
        state: {
          timeOffset: offsetMs,
          duration: durMs,
          lastWatched: when,
        },
        removed: false,
        temp: false,
        _ctime: when,
        _mtime: when,
        external: "nuvio",
      };

      if (isCwDismissed(item) || isCandidateDismissed(contentId, undefined, undefined)) continue;

      const shouldWrite =
        !existing || remoteT >= existing.t || (!existing.t && offsetMs > existing.ms);

      if (shouldWrite) {
        const pct01 = durMs > 0 ? Math.min(1, offsetMs / durMs) : undefined;
        saveResumeMs(
          item._id,
          offsetMs,
          undefined,
          undefined,
          undefined,
          pct01,
          "nuvio",
          ownerId,
          remoteT,
        );
      }

      items.push(item);
      continue;
    }

    // Series
    const latest = list[0];
    const latestSeason = latest.season ?? 1;
    const latestEpisode = latest.episode ?? 1;
    const latestProgressSec = Math.max(0, latest.progress_seconds || 0);
    const latestDurationSec = Math.max(0, latest.duration_seconds || 0);
    const latestDurMs =
      latestDurationSec > 0
        ? latestDurationSec * 1000
        : localMatch?.durationMs && localMatch.durationMs > 0
          ? localMatch.durationMs
          : DURATION_MS.series;
    const latestOffsetMs = latestProgressSec * 1000;
    const isLatestFinished =
      (latestDurMs > 0 && latestOffsetMs / latestDurMs >= 0.9) ||
      (latest as Record<string, unknown>).watched === true;

    // If the latest episode is unfinished, it is actively in progress
    if (!isLatestFinished && latestOffsetMs >= 5000) {
      let targetOffsetMs = latestOffsetMs;
      const targetSeason = latestSeason;
      const targetEpisode = latestEpisode;
      const when =
        latest.updated_at ||
        (latest.last_watched
          ? new Date(latest.last_watched).toISOString()
          : new Date().toISOString());
      const remoteT = latest.last_watched || 0;

      const existing = readEpisodeResume(
        aliasResolver.getAliases(contentId),
        targetSeason,
        targetEpisode,
        ownerId,
      );
      if (existing && existing.t > remoteT && existing.ms > 0) {
        targetOffsetMs = existing.ms;
      }

      const item: LibraryItem = {
        _id: contentId,
        type: "series",
        name: resolvedName,
        poster: resolvedPoster,
        background: resolvedBackground,
        state: {
          timeOffset: targetOffsetMs,
          duration: latestDurMs,
          season: targetSeason,
          episode: targetEpisode,
          video_id: `${contentId}:${targetSeason}:${targetEpisode}`,
          flaggedWatched: 0,
          lastWatched: when,
        },
        upNext: false,
        removed: false,
        temp: false,
        _ctime: when,
        _mtime: when,
        external: "nuvio",
      };

      if (!isCwDismissed(item) && !isCandidateDismissed(contentId, targetSeason, targetEpisode)) {
        const pct01 = latestDurMs > 0 ? Math.min(1, targetOffsetMs / latestDurMs) : undefined;
        saveResumeMs(
          item._id,
          targetOffsetMs,
          targetSeason,
          targetEpisode,
          undefined,
          pct01,
          "nuvio",
          ownerId,
          remoteT,
        );
        items.push(item);
        activeSeriesIds.add(contentId);
        activeSeriesIds.add(cleanId);
        activeSeriesIds.add(`tmdb:${cleanId}`);
        activeSeriesIds.add(`series:${cleanId}`);
      }
      continue;
    }

    // If finished, check if there is an unfinished subsequent episode in watch_progress
    if (isLatestFinished) {
      const subsequent = list.find((r) => {
        if (r.season == null || r.episode == null) return false;
        const dur = (r.duration_seconds || 0) * 1000 || DURATION_MS.series;
        const pos = (r.progress_seconds || 0) * 1000;
        const finished = dur > 0 && pos / dur >= 0.9;
        return (
          !finished &&
          (r.season > latestSeason || (r.season === latestSeason && r.episode > latestEpisode))
        );
      });

      if (subsequent) {
        const subSeason = subsequent.season!;
        const subEpisode = subsequent.episode!;
        const subDur = (subsequent.duration_seconds || 0) * 1000 || DURATION_MS.series;
        const subOffset = (subsequent.progress_seconds || 0) * 1000;
        const when =
          subsequent.updated_at ||
          (subsequent.last_watched
            ? new Date(subsequent.last_watched).toISOString()
            : new Date().toISOString());

        const item: LibraryItem = {
          _id: contentId,
          type: "series",
          name: resolvedName,
          poster: resolvedPoster,
          background: resolvedBackground,
          state: {
            timeOffset: subOffset,
            duration: subDur,
            season: subSeason,
            episode: subEpisode,
            video_id: `${contentId}:${subSeason}:${subEpisode}`,
            flaggedWatched: 0,
            lastWatched: when,
          },
          upNext: subOffset < 5000,
          removed: false,
          temp: false,
          _ctime: when,
          _mtime: when,
          external: "nuvio",
        };

        if (!isCwDismissed(item) && !isCandidateDismissed(contentId, subSeason, subEpisode)) {
          (item as Record<string, unknown>).nextUpSeedAt = subsequent.last_watched || 0;
          items.push(item);
          for (const alias of aliasResolver.getAliases(contentId)) {
            activeSeriesIds.add(alias);
          }
        }
      }
    }
  }

  // 2. Next Up Candidate Generation (matching Nuvio Mobile's buildHomeNextUpSeedCandidates)
  // Gather all completed series seeds from watched_items and completed watch_progress records
  const completedSeedsBySeries = new Map<
    string,
    { season: number; episode: number; markedAt: number; title?: string }
  >();

  const registerSeed = (cid: string, s: number, e: number, markedAt: number, title?: string) => {
    const prev = completedSeedsBySeries.get(cid);
    const order = (sn: number, ep: number) => sn * 100000 + ep;
    if (
      !prev ||
      order(s, e) > order(prev.season, prev.episode) ||
      (order(s, e) === order(prev.season, prev.episode) && markedAt > prev.markedAt)
    ) {
      completedSeedsBySeries.set(cid, { season: s, episode: e, markedAt, title });
    }
  };

  for (const w of watched) {
    if (!w.content_id || w.season == null || w.episode == null) continue;
    if (w.content_type === "movie") continue;
    const t = w.watched_at
      ? typeof w.watched_at === "number"
        ? w.watched_at
        : Date.parse(w.watched_at)
      : 0;
    const canonical = aliasResolver.getCanonicalId(w.content_id);
    registerSeed(canonical, w.season, w.episode, t, w.title);
  }

  for (const r of safeRecords) {
    if (!r.content_id || r.season == null || r.episode == null) continue;
    const dur = (r.duration_seconds || 0) * 1000 || DURATION_MS.series;
    const pos = (r.progress_seconds || 0) * 1000;
    const isFinished =
      (dur > 0 && pos / dur >= 0.9) || (r as Record<string, unknown>).watched === true;
    if (!isFinished) continue;
    const clean = r.content_id.replace(/^(series|movie|tmdb|tmdb:tv|tmdb:movie):/, "");
    if (
      manualWatchedState(r.content_id, r.season, r.episode) === false ||
      manualWatchedState(clean, r.season, r.episode) === false
    ) {
      continue;
    }
    const t = r.last_watched || 0;
    const canonical = aliasResolver.getCanonicalId(r.content_id);
    registerSeed(canonical, r.season, r.episode, t, r.name || r.title || undefined);
  }

  const processedNextUpSeries = new Set<string>();

  for (const [seriesId, seed] of completedSeedsBySeries) {
    const canonical = aliasResolver.getCanonicalId(seriesId);
    const aliases = aliasResolver.getAliases(seriesId);
    if (
      processedNextUpSeries.has(canonical) ||
      Array.from(aliases).some((a) => processedNextUpSeries.has(a) || activeSeriesIds.has(a))
    ) {
      continue;
    }
    processedNextUpSeries.add(canonical);
    for (const a of aliases) processedNextUpSeries.add(a);

    // Skip if seed is dismissed on any alias
    if (isCandidateDismissed(canonical, seed.season, seed.episode)) {
      continue;
    }

    // Resolve next episode:
    // Check if local CW has a newer or advanced target episode
    let localMatch: any = null;
    for (const a of aliases) {
      const m = localCwEntry(a, true, ownerId) || localCwEntry(a, false, ownerId);
      if (m) {
        localMatch = m;
        break;
      }
    }
    const isFullyWatched = Array.from(aliases).some((a) => fullyWatchedSeriesIds.has(a));
    let keptForTimer = false;
    if (isFullyWatched) {
      if (!localMatch || localMatch.season == null || localMatch.episode == null) {
        if (!keepCaughtUpForTimer) continue;
        keptForTimer = true;
      } else {
        const order = (s: number, e: number) => s * 100000 + e;
        if (order(localMatch.season, localMatch.episode) <= order(seed.season, seed.episode)) {
          if (!keepCaughtUpForTimer) continue;
          keptForTimer = true;
        }
      }
    }
    let nextSeason = seed.season;
    let nextEpisode = seed.episode + 1;

    if (!keptForTimer && localMatch && localMatch.season != null && localMatch.episode != null) {
      const order = (s: number, e: number) => s * 100000 + e;
      const seedNextOrder = seed.season * 100000 + (seed.episode + 1);
      const localOrder = localMatch.season * 100000 + localMatch.episode;
      if (
        (localMatch.positionMs > 0 && localOrder > order(seed.season, seed.episode)) ||
        localOrder === seedNextOrder ||
        (localMatch.season > seed.season && localMatch.episode === 1)
      ) {
        nextSeason = localMatch.season;
        nextEpisode = localMatch.episode;
      }
    }

    // The timer card keeps the last watched episode: the tray's advancer resolves
    // the real next episode from the episode list, so an unaired follow-up shows
    // its countdown instead of a fabricated "next" number.
    if (keptForTimer) {
      nextSeason = seed.season;
      nextEpisode = seed.episode;
    }

    // Skip if target episode or seed episode is dismissed on any alias
    if (
      isCandidateDismissed(canonical, nextSeason, nextEpisode) ||
      isCandidateDismissed(canonical, seed.season, seed.episode)
    ) {
      continue;
    }

    const libMatch =
      Array.from(aliases)
        .map((a) => libMap.get(a))
        .find(Boolean) || null;
    const title = seed.title || libMatch?.name || localMatch?.name || canonical;
    const poster = libMatch?.poster || localMatch?.poster || undefined;
    const background = libMatch?.background || localMatch?.background || undefined;
    const when = new Date(seed.markedAt || Date.now()).toISOString();

    const nextUpItem: LibraryItem = {
      _id: canonical,
      altIds: Array.from(aliases).filter((a) => a !== canonical),
      type: "series",
      name: title,
      poster,
      background,
      state: {
        timeOffset: 0,
        duration: DURATION_MS.series,
        season: nextSeason,
        episode: nextEpisode,
        video_id: `${canonical}:${nextSeason}:${nextEpisode}`,
        flaggedWatched: 0,
        lastWatched: when,
      },
      upNext: true,
      waitingForAir: keptForTimer ? true : undefined,
      removed: false,
      temp: false,
      _ctime: when,
      _mtime: when,
      external: "nuvio",
    };
    if (keptForTimer) {
      (nextUpItem as Record<string, unknown>).keptForTimer = true;
    }
    (nextUpItem as Record<string, unknown>).nextUpSeedAt = seed.markedAt || 0;

    if (isCwDismissed(nextUpItem)) continue;
    items.push(nextUpItem);
  }

  // 3. Seamlessly merge recent local continue watching items for this slot
  try {
    const localList = listLocalCw(true, ownerId);
    for (const loc of localList) {
      const existingItem = items.find(
        (it) =>
          it._id === loc.id ||
          it._id.replace(/^(series|movie|tmdb|tmdb:tv|tmdb:movie):/, "") ===
            loc.id.replace(/^(series|movie|tmdb|tmdb:tv|tmdb:movie):/, "") ||
          it.altIds?.includes(loc.id) ||
          aliasResolver.getCanonicalId(it._id) === aliasResolver.getCanonicalId(loc.id),
      );
      if (existingItem) {
        // If local record has advanced to a higher episode or is newer, reconcile it
        const locT = loc.t || 0;
        const itemT = Date.parse(existingItem.state?.lastWatched ?? "") || 0;
        if (loc.season != null && loc.episode != null && existingItem.state) {
          const curSeason = existingItem.state.season ?? 0;
          const curEpisode = existingItem.state.episode ?? 0;
          if (
            (loc.positionMs > 0 &&
              (loc.season > curSeason || (loc.season === curSeason && loc.episode > curEpisode))) ||
            (loc.season === curSeason &&
              loc.episode === curEpisode &&
              locT > itemT &&
              loc.positionMs > 0)
          ) {
            existingItem.state.season = loc.season;
            existingItem.state.episode = loc.episode;
            existingItem.state.video_id = loc.videoId ?? `${loc.id}:${loc.season}:${loc.episode}`;
            existingItem.state.timeOffset = loc.positionMs;
            existingItem.state.duration =
              loc.durationMs > 0 ? loc.durationMs : existingItem.state.duration;
            existingItem.state.lastWatched = new Date(locT).toISOString();
            existingItem.upNext = false;
          } else if (
            loc.positionMs === 0 &&
            (loc.season !== curSeason || loc.episode !== curEpisode)
          ) {
            saveLocalCw(
              {
                ...loc,
                season: curSeason,
                episode: curEpisode,
                positionMs: 0,
                external: "nuvio" as const,
              },
              ownerId,
            );
          }
        }
        continue;
      }

      if (isCandidateDismissed(loc.id, loc.season, loc.episode)) {
        clearLocalCw(loc.id, ownerId);
        continue;
      }

      // If cloud progress has been retrieved and does not contain this content,
      // and this item has no active presence in watched history, it was removed remotely on mobile.
      const hasCloudProgress = safeRecords.some((r) => {
        if (!r.content_id) return false;
        return (
          r.content_id === loc.id ||
          aliasResolver.getCanonicalId(r.content_id) === aliasResolver.getCanonicalId(loc.id) ||
          aliasResolver.getAliases(loc.id).has(r.content_id)
        );
      });
      const hasWatchedHistory = (watched ?? []).some((w) => {
        if (!w.content_id) return false;
        return (
          w.content_id === loc.id ||
          aliasResolver.getCanonicalId(w.content_id) === aliasResolver.getCanonicalId(loc.id) ||
          aliasResolver.getAliases(loc.id).has(w.content_id)
        );
      });

      if (
        options?.clearMissingLocal &&
        !hasCloudProgress &&
        !hasWatchedHistory &&
        safeRecords.length > 0
      ) {
        clearLocalCw(loc.id, ownerId);
        continue;
      }

      const dur =
        loc.durationMs > 0
          ? loc.durationMs
          : loc.type === "movie"
            ? DURATION_MS.movie
            : DURATION_MS.series;
      if (dur > 0 && loc.positionMs / dur >= 0.92 && loc.type === "movie") continue;
      // Only discard movies that were barely started, NEVER discard Next Up series with positionMs === 0!
      if (loc.type === "movie" && loc.positionMs < 5000 && dur > 60000) continue;
      const when = new Date(loc.t).toISOString();
      const localItem: LibraryItem = {
        _id: loc.id,
        type: loc.type,
        name: loc.name || loc.id,
        poster: loc.poster,
        background: loc.background,
        state: {
          timeOffset: loc.positionMs,
          duration: dur,
          season: loc.season,
          episode: loc.episode,
          video_id:
            loc.videoId ??
            (loc.season != null && loc.episode != null
              ? `${loc.id}:${loc.season}:${loc.episode}`
              : undefined),
          lastWatched: when,
        },
        upNext: loc.type === "series" && loc.positionMs === 0,
        removed: false,
        temp: false,
        _ctime: when,
        _mtime: when,
        external: "nuvio",
      };
      if (localItem.upNext) {
        (localItem as Record<string, unknown>).nextUpSeedAt = loc.t || 0;
      }
      if (!isCwDismissed(localItem)) {
        items.push(localItem);
      }
    }
  } catch {}

  // Deduplicate by content ID (preferring earlier entries)
  const seenIds = new Set<string>();
  const deduped: LibraryItem[] = [];
  for (const it of items) {
    const clean = it._id.replace(/^(series|movie|tmdb|tmdb:tv|tmdb:movie):/, "");
    if (
      seenIds.has(it._id) ||
      seenIds.has(clean) ||
      (it.altIds && it.altIds.some((a) => seenIds.has(a)))
    )
      continue;
    seenIds.add(it._id);
    seenIds.add(clean);
    seenIds.add(`tmdb:${clean}`);
    seenIds.add(`tmdb:tv:${clean}`);
    if (it.altIds) for (const a of it.altIds) seenIds.add(a);
    deduped.push(it);
  }

  reconcileResumeProgress(
    deduped,
    safeRecords,
    watched,
    aliasResolver,
    ownerId,
    profileIndex === resolveNuvioProfileIndex(),
  );

  deduped.sort((a, b) => {
    const ta = Date.parse(a.state?.lastWatched ?? a._mtime ?? "") || 0;
    const tb = Date.parse(b.state?.lastWatched ?? b._mtime ?? "") || 0;
    return tb - ta;
  });

  return deduped;
}

/**
 * Fetches Nuvio playback items for a profile slot, pulling latest from cloud
 * and safely falling back to local cache if network is unavailable.
 */
export async function fetchNuvioPlaybackItems(
  targetSlot?: number,
  force = false,
): Promise<LibraryItem[]> {
  if (!isNuvioSignedIn()) return [];

  const accountId = getNuvioAccountId();
  const activeSlot = resolveNuvioProfileIndex();
  const profileIndex = targetSlot ?? resolveNuvioProfileIndex();
  let records: NuvioWatchProgress[] | null = null;
  let watched: NuvioWatchedItem[] | null = null;
  let dismissedKeys: Set<string> | null = null;
  try {
    const [progRes, watchedRes, dismissedRes] = await Promise.all([
      pullWatchProgressFromNuvio(profileIndex, { force }),
      pullWatchedItemsFromNuvio(profileIndex, { force }),
      pullDismissedNextUpKeysFromNuvio(profileIndex),
    ]);
    records = progRes;
    watched = watchedRes;
    dismissedKeys = dismissedRes;
  } catch {
    records = null;
    watched = null;
    dismissedKeys = null;
  }
  if (
    !isNuvioSignedIn() ||
    !isNuvioProviderActive() ||
    getNuvioAccountId() !== accountId ||
    resolveNuvioProfileIndex() !== activeSlot
  )
    return [];
  const safeAccountId = accountId ?? undefined;
  if (records === null) {
    records = readCachedWatchProgress(profileIndex, safeAccountId);
  }
  if (watched === null) {
    watched = readCachedWatchedItems(profileIndex, safeAccountId);
  }
  if (dismissedKeys === null) {
    dismissedKeys = readCachedDismissedNextUpKeys(profileIndex);
  }

  const items = buildNuvioPlaybackItems(
    records,
    profileIndex,
    watched,
    dismissedKeys,
    cwKeepsCaughtUpForTimer(),
  );
  writeCachedNuvioPlaybackItems(profileIndex, items, safeAccountId);
  return items;
}
