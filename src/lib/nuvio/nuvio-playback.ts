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
import { localCwEntry, listLocalCw } from "@/lib/local-cw";

const DURATION_MS = { movie: 6_300_000, series: 2_640_000 };
const PLAYBACK_ITEMS_CACHE_PREFIX = "harbor.nuvio.playback_items.";

function getPlaybackItemsKey(slot: number, accountId?: string): string {
  const acc = accountId || getNuvioAccountId() || "anon";
  return `${PLAYBACK_ITEMS_CACHE_PREFIX}${acc}.slot.${slot}`;
}

/**
 * Loads cached Nuvio playback LibraryItems for a slot from memory/localStorage.
 */
export function readCachedNuvioPlaybackItems(slot?: number, accountId?: string): LibraryItem[] {
  const profileIndex = slot ?? resolveNuvioProfileIndex();
  const records = readCachedWatchProgress(profileIndex, accountId);
  const watched = readCachedWatchedItems(profileIndex, accountId);
  try {
    const raw = localStorage.getItem(getPlaybackItemsKey(profileIndex, accountId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // If cached watch progress AND watched items are both empty, don't return stale non-empty playback items
        if (records.length === 0 && watched.length === 0 && parsed.length > 0) {
          writeCachedNuvioPlaybackItems(profileIndex, [], accountId);
          return [];
        }
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
    localStorage.setItem(getPlaybackItemsKey(slot, accountId), JSON.stringify(items));
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
): LibraryItem[] {
  const safeRecords = Array.isArray(records) ? records : [];
  const ownerId = `nuvio-${profileIndex}`;
  const libraryItems = readCachedNuvioLibrary(profileIndex);
  const libMap = new Map<string, (typeof libraryItems)[0]>();
  for (const lib of libraryItems) {
    libMap.set(lib.content_id, lib);
    const clean = lib.content_id.replace(/^(series|movie|tmdb):/, "");
    libMap.set(clean, lib);
    libMap.set(`tmdb:${clean}`, lib);
    libMap.set(`series:${clean}`, lib);
  }

  const dismissed = dismissedKeys ?? readCachedDismissedNextUpKeys(profileIndex);
  const watched = watchedItems ?? readCachedWatchedItems(profileIndex);

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
      const clean = w.content_id.replace(/^(series|movie|tmdb):/, "");
      fullyWatchedSeriesIds.add(clean);
      fullyWatchedSeriesIds.add(`tmdb:${clean}`);
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

    const cleanId = contentId.replace(/^(series|movie|tmdb):/, "");
    const libMatch = libMap.get(contentId) || libMap.get(cleanId);
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
      const remoteT = r.last_watched || Date.parse(when) || 0;

      // Prefer newer local playback offset if available
      const existing = readResumeEntry(contentId, undefined, undefined, ownerId);
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

      if (isCwDismissed(item) || isDismissedNextUp(contentId, undefined, undefined, dismissed))
        continue;

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
      const remoteT = latest.last_watched || Date.parse(when) || 0;

      const existing = readResumeEntry(contentId, targetSeason, targetEpisode, ownerId);
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

      if (
        !isCwDismissed(item) &&
        !isDismissedNextUp(contentId, targetSeason, targetEpisode, dismissed)
      ) {
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

        if (
          !isCwDismissed(item) &&
          !isDismissedNextUp(contentId, subSeason, subEpisode, dismissed)
        ) {
          items.push(item);
          activeSeriesIds.add(contentId);
          activeSeriesIds.add(cleanId);
          activeSeriesIds.add(`tmdb:${cleanId}`);
          activeSeriesIds.add(`series:${cleanId}`);
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
    registerSeed(w.content_id, w.season, w.episode, t, w.title);
    const clean = w.content_id.replace(/^(series|movie|tmdb):/, "");
    registerSeed(clean, w.season, w.episode, t, w.title);
  }

  for (const r of safeRecords) {
    if (!r.content_id || r.season == null || r.episode == null) continue;
    const dur = (r.duration_seconds || 0) * 1000 || DURATION_MS.series;
    const pos = (r.progress_seconds || 0) * 1000;
    const isFinished =
      (dur > 0 && pos / dur >= 0.9) || (r as Record<string, unknown>).watched === true;
    if (!isFinished) continue;
    const t = r.last_watched || (r.updated_at ? Date.parse(r.updated_at) : 0);
    registerSeed(r.content_id, r.season, r.episode, t, r.name || r.title || undefined);
    const clean = r.content_id.replace(/^(series|movie|tmdb):/, "");
    registerSeed(clean, r.season, r.episode, t, r.name || r.title || undefined);
  }

  const processedNextUpSeries = new Set<string>();

  for (const [seriesId, seed] of completedSeedsBySeries) {
    const cleanSeriesId = seriesId.replace(/^(series|movie|tmdb):/, "");
    if (
      processedNextUpSeries.has(cleanSeriesId) ||
      activeSeriesIds.has(seriesId) ||
      activeSeriesIds.has(cleanSeriesId) ||
      activeSeriesIds.has(`tmdb:${cleanSeriesId}`) ||
      activeSeriesIds.has(`series:${cleanSeriesId}`)
    ) {
      continue;
    }
    processedNextUpSeries.add(cleanSeriesId);

    // Skip if seed is dismissed
    if (isDismissedNextUp(seriesId, seed.season, seed.episode, dismissed)) {
      continue;
    }

    // Resolve next episode:
    // Check if local CW has a newer or advanced target episode
    const localMatch =
      localCwEntry(seriesId, true, ownerId) || localCwEntry(seriesId, false, ownerId);
    const isFullyWatched =
      fullyWatchedSeriesIds.has(seriesId) || fullyWatchedSeriesIds.has(cleanSeriesId);
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

    if (
      !keptForTimer &&
      localMatch &&
      localMatch.season != null &&
      localMatch.episode != null &&
      (localMatch.season > seed.season ||
        (localMatch.season === seed.season && localMatch.episode > seed.episode))
    ) {
      nextSeason = localMatch.season;
      nextEpisode = localMatch.episode;
    }

    // The timer card keeps the last watched episode: the tray's advancer resolves
    // the real next episode from the episode list, so an unaired follow-up shows
    // its countdown instead of a fabricated "next" number.
    if (keptForTimer) {
      nextSeason = seed.season;
      nextEpisode = seed.episode;
    }

    // Skip if target episode is dismissed
    if (isDismissedNextUp(seriesId, nextSeason, nextEpisode, dismissed)) {
      continue;
    }

    const libMatch = libMap.get(seriesId) || libMap.get(cleanSeriesId);
    const title = seed.title || libMatch?.name || localMatch?.name || cleanSeriesId;
    const poster = libMatch?.poster || localMatch?.poster || undefined;
    const background = libMatch?.background || localMatch?.background || undefined;
    const when = new Date(seed.markedAt || Date.now()).toISOString();

    const nextUpItem: LibraryItem = {
      _id: seriesId,
      type: "series",
      name: title,
      poster,
      background,
      state: {
        timeOffset: 0,
        duration: DURATION_MS.series,
        season: nextSeason,
        episode: nextEpisode,
        video_id: `${seriesId}:${nextSeason}:${nextEpisode}`,
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
          it._id.replace(/^(series|movie|tmdb):/, "") ===
            loc.id.replace(/^(series|movie|tmdb):/, ""),
      );
      if (existingItem) {
        // If local record has advanced to a higher episode or is newer, reconcile it
        const locT = loc.t || 0;
        const itemT = Date.parse(existingItem.state?.lastWatched ?? "") || 0;
        if (loc.season != null && loc.episode != null && existingItem.state) {
          const curSeason = existingItem.state.season ?? 0;
          const curEpisode = existingItem.state.episode ?? 0;
          if (
            loc.season > curSeason ||
            (loc.season === curSeason && loc.episode > curEpisode) ||
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
            existingItem.upNext = loc.positionMs === 0;
          }
        }
        continue;
      }

      if (isDismissedNextUp(loc.id, loc.season, loc.episode, dismissed)) continue;

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
      if (!isCwDismissed(localItem)) {
        items.push(localItem);
      }
    }
  } catch {}

  // Deduplicate by content ID (preferring earlier entries)
  const seenIds = new Set<string>();
  const deduped: LibraryItem[] = [];
  for (const it of items) {
    const clean = it._id.replace(/^(series|movie|tmdb):/, "");
    if (seenIds.has(it._id) || seenIds.has(clean)) continue;
    seenIds.add(it._id);
    seenIds.add(clean);
    deduped.push(it);
  }

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
export async function fetchNuvioPlaybackItems(targetSlot?: number): Promise<LibraryItem[]> {
  if (!isNuvioSignedIn()) return [];

  const accountId = getNuvioAccountId();
  const activeSlot = resolveNuvioProfileIndex();
  const profileIndex = targetSlot ?? resolveNuvioProfileIndex();
  let records: NuvioWatchProgress[] | null = null;
  let watched: NuvioWatchedItem[] | null = null;
  let dismissedKeys: Set<string> | null = null;
  try {
    const [progRes, watchedRes, dismissedRes] = await Promise.all([
      pullWatchProgressFromNuvio(profileIndex),
      pullWatchedItemsFromNuvio(profileIndex),
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
