import {
  pullWatchProgressFromNuvio,
  readCachedWatchProgress,
  resolveNuvioProfileIndex,
} from "./nuvio-sync";
import { getNuvioAccountId, isNuvioSignedIn } from "./nuvio-client";
import type { LibraryItem } from "@/lib/stremio";
import { readResumeEntry, saveResumeMs } from "@/lib/resume";
import { isCwDismissed } from "@/lib/cw-dismiss";
import type { NuvioWatchProgress } from "./nuvio-types";
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
  try {
    const raw = localStorage.getItem(getPlaybackItemsKey(profileIndex, accountId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // If cached watch progress is known to be empty, don't return stale non-empty playback items
        if (records.length === 0 && parsed.length > 0) {
          writeCachedNuvioPlaybackItems(profileIndex, [], accountId);
          return [];
        }
        return parsed;
      }
    }
  } catch {}

  const built = buildNuvioPlaybackItems(records, profileIndex);
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
    localStorage.setItem(
      getPlaybackItemsKey(slot, accountId),
      JSON.stringify(items),
    );
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
 * Pure builder function that transforms NuvioWatchProgress[] records into
 * Harbor LibraryItem[] shape, enriched with library metadata.
 */
export function buildNuvioPlaybackItems(
  records: NuvioWatchProgress[],
  profileIndex: number,
): LibraryItem[] {
  const safeRecords = Array.isArray(records) ? records : [];
  const ownerId = `nuvio-${profileIndex}`;
  const libraryItems = readCachedNuvioLibrary(profileIndex);
  const libMap = new Map<string, (typeof libraryItems)[0]>();
  for (const lib of libraryItems) {
    libMap.set(lib.content_id, lib);
  }

  // Group records by content_id so each series/movie has a single consolidated Continue Watching card
  const byContent = new Map<string, NuvioWatchProgress[]>();
  for (const r of safeRecords) {
    if (!r.content_id) continue;
    const list = byContent.get(r.content_id) ?? [];
    list.push(r);
    byContent.set(r.content_id, list);
  }

  const items: LibraryItem[] = [];

  for (const [contentId, list] of byContent) {
    // Sort records for this content by last_watched/updated_at descending (most recent interaction first),
    // tie-breaking by higher season and episode (matches Nuvio Mobile watchingProgressRecencyComparator)
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

    const libMatch = libMap.get(contentId);
    const isSeries =
      libMatch?.content_type === "series" ||
      list.some(
        (r) =>
          (r.season != null && r.season > 0 && r.episode != null && r.episode > 0) ||
          (r.progress_key && (r.progress_key.includes("_s") || r.progress_key.includes(":"))),
      );

    const localMatch = localCwEntry(contentId, true, ownerId) || localCwEntry(contentId, false, ownerId);
    const resolvedName = libMatch?.name || list[0]?.name || list[0]?.title || localMatch?.name || contentId;
    const resolvedPoster = libMatch?.poster || list[0]?.poster || localMatch?.poster || undefined;
    const resolvedBackground = libMatch?.background || list[0]?.background || localMatch?.background || undefined;

    if (!isSeries) {
      // Movie
      const r = list[0];
      const progressSec = Math.max(0, r.progress_seconds || 0);
      const durationSec = Math.max(0, r.duration_seconds || 0);
      const durMs =
        durationSec > 0
          ? durationSec * 1000
          : (localMatch?.durationMs && localMatch.durationMs > 0)
            ? localMatch.durationMs
            : DURATION_MS.movie;
      let offsetMs = progressSec * 1000;

      const when = r.updated_at || (r.last_watched ? new Date(r.last_watched).toISOString() : new Date().toISOString());
      const remoteT = r.last_watched || Date.parse(when) || 0;

      // Prefer newer local playback offset if available
      const existing = readResumeEntry(contentId);
      if (existing && existing.t > remoteT && existing.ms > 0) {
        offsetMs = existing.ms;
      }

      // Filter out movies that are finished (> 92%) or barely started (< 5 seconds)
      if (durMs > 0 && offsetMs / durMs >= 0.92) {
        setMovieWatchedLocal(contentId, true);
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

      if (isCwDismissed(item)) continue;

      const shouldWrite =
        !existing ||
        (remoteT >= existing.t) ||
        (!existing.t && offsetMs > existing.ms);

      if (shouldWrite) {
        const pct01 = durMs > 0 ? Math.min(1, offsetMs / durMs) : undefined;
        saveResumeMs(item._id, offsetMs, undefined, undefined, undefined, pct01, "nuvio", ownerId, remoteT);
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
        : (localMatch?.durationMs && localMatch.durationMs > 0)
          ? localMatch.durationMs
          : DURATION_MS.series;
    const latestOffsetMs = latestProgressSec * 1000;
    const isLatestFinished = (latestDurMs > 0 && latestOffsetMs / latestDurMs >= 0.90) || (latest as Record<string, unknown>).watched === true;

    let targetSeason = latestSeason;
    let targetEpisode = latestEpisode;
    let targetOffsetMs = latestOffsetMs;
    let targetDurMs = latestDurMs;
    let isUpNext = false;

    if (isLatestFinished) {
      const subsequent = list.find((r) => {
        if (r.season == null || r.episode == null) return false;
        return r.season > latestSeason || (r.season === latestSeason && r.episode > latestEpisode);
      });

      if (subsequent) {
        targetSeason = subsequent.season!;
        targetEpisode = subsequent.episode!;
        const subProg = Math.max(0, subsequent.progress_seconds || 0);
        const subDur = Math.max(0, subsequent.duration_seconds || 0);
        targetDurMs = subDur > 0 ? subDur * 1000 : DURATION_MS.series;
        targetOffsetMs = subProg * 1000;
        isUpNext = targetOffsetMs < 5000;
      } else {
        targetSeason = latestSeason;
        targetEpisode = latestEpisode + 1;
        targetOffsetMs = 0;
        isUpNext = true;
      }
    } else {
      isUpNext = latestOffsetMs < 5000;
    }

    const when = latest.updated_at || (latest.last_watched ? new Date(latest.last_watched).toISOString() : new Date().toISOString());
    const remoteT = latest.last_watched || Date.parse(when) || 0;

    // Check if local playback has a more recent position for the target episode
    const existing = readResumeEntry(contentId, targetSeason, targetEpisode);
    if (existing && existing.t > remoteT && existing.ms > 0) {
      targetOffsetMs = existing.ms;
      isUpNext = false;
    }

    const item: LibraryItem = {
      _id: contentId,
      type: "series",
      name: resolvedName,
      poster: resolvedPoster,
      background: resolvedBackground,
      state: {
        timeOffset: targetOffsetMs,
        duration: targetDurMs,
        season: targetSeason,
        episode: targetEpisode,
        video_id: `${contentId}:${targetSeason}:${targetEpisode}`,
        flaggedWatched: isLatestFinished && !isUpNext ? 1 : 0,
        lastWatched: when,
      },
      upNext: isUpNext,
      removed: false,
      temp: false,
      _ctime: when,
      _mtime: when,
      external: "nuvio",
    };

    if (isCwDismissed(item)) continue;

    const shouldWrite =
      !existing ||
      (remoteT >= existing.t) ||
      (!existing.t && targetOffsetMs > existing.ms) ||
      (targetOffsetMs === 0 && (!existing || (remoteT >= existing.t)));

    if (shouldWrite) {
      const pct01 = targetDurMs > 0 ? Math.min(1, targetOffsetMs / targetDurMs) : undefined;
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
    }

    items.push(item);
  }

  // Seamlessly merge recent local continue watching items for this slot
  try {
    const localList = listLocalCw(true, ownerId);
    for (const loc of localList) {
      const existingItem = items.find((it) => it._id === loc.id);
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
            (loc.season === curSeason && loc.episode === curEpisode && locT > itemT && loc.positionMs > 0)
          ) {
            existingItem.state.season = loc.season;
            existingItem.state.episode = loc.episode;
            existingItem.state.video_id = loc.videoId ?? `${loc.id}:${loc.season}:${loc.episode}`;
            existingItem.state.timeOffset = loc.positionMs;
            existingItem.state.duration = loc.durationMs > 0 ? loc.durationMs : existingItem.state.duration;
            existingItem.state.lastWatched = new Date(locT).toISOString();
            existingItem.upNext = false;
          }
        }
        continue;
      }

      const dur =
        loc.durationMs > 0
          ? loc.durationMs
          : (loc.type === "movie" ? DURATION_MS.movie : DURATION_MS.series);
      if (dur > 0 && loc.positionMs / dur >= 0.92 && loc.type === "movie") continue;
      if (loc.positionMs < 5000 && dur > 60000) continue;
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
          video_id: loc.videoId,
          lastWatched: when,
        },
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

  items.sort((a, b) => {
    const ta = Date.parse(a.state?.lastWatched ?? a._mtime ?? "") || 0;
    const tb = Date.parse(b.state?.lastWatched ?? b._mtime ?? "") || 0;
    return tb - ta;
  });

  return items;
}

/**
 * Fetches Nuvio playback items for a profile slot, pulling latest from cloud
 * and safely falling back to local cache if network is unavailable.
 */
export async function fetchNuvioPlaybackItems(targetSlot?: number): Promise<LibraryItem[]> {
  if (!isNuvioSignedIn()) return [];

  const accountId = getNuvioAccountId();
  const profileIndex = targetSlot ?? resolveNuvioProfileIndex();
  let records: NuvioWatchProgress[] | null = null;
  try {
    records = await pullWatchProgressFromNuvio(profileIndex);
  } catch {
    records = null;
  }
  if (!isNuvioSignedIn() || getNuvioAccountId() !== accountId) return [];
  // Only fall back to local disk cache if network threw an error (records === null)
  if (records === null) {
    records = readCachedWatchProgress(profileIndex);
  }

  const items = buildNuvioPlaybackItems(records, profileIndex);
  writeCachedNuvioPlaybackItems(profileIndex, items);
  return items;
}
