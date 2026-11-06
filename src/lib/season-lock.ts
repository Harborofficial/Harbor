import type { PlaybackEntry } from "./playback-history";
import {
  persistablePlaybackIdentity,
  persistablePlaybackKey,
  persistablePlaybackPreference,
} from "./player/playback-history-source";

export type SeasonLockEntry = PlaybackEntry & { seriesWide?: boolean };

const STORAGE_KEY = "harbor.season-lock.v1";
const TTL_MS = 120 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 300;

function persistableLock(key: string, value: SeasonLockEntry): SeasonLockEntry {
  return {
    ...persistablePlaybackPreference(value),
    ...(key.startsWith("playback-private:")
      ? { title: "Direct stream", parsedTitle: undefined }
      : {}),
    ...(typeof value.seriesWide === "boolean" ? { seriesWide: value.seriesWide } : {}),
  };
}

function seasonKey(metaId: string, season?: number | null): string {
  metaId = persistablePlaybackIdentity(metaId);
  return season != null ? `${metaId}|s${season}` : `${metaId}|all`;
}

function readAll(): Record<string, SeasonLockEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SeasonLockEntry>;
    const now = Date.now();
    const fresh: Record<string, SeasonLockEntry> = {};
    let scrubbed = false;
    for (const [k, v] of Object.entries(parsed)) {
      if (!v) continue;
      const key = persistablePlaybackKey(k);
      const safe = persistableLock(key, v);
      scrubbed ||= key !== k || JSON.stringify(safe) !== JSON.stringify(v);
      if (!v.savedAt || now - v.savedAt > TTL_MS) continue;
      if (!fresh[key] || safe.savedAt >= fresh[key].savedAt) fresh[key] = safe;
    }
    if (scrubbed) writeAll(fresh);
    return fresh;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, SeasonLockEntry>): void {
  try {
    if (Object.keys(map).length > MAX_ENTRIES) {
      const sorted = Object.entries(map).sort((a, b) => b[1].savedAt - a[1].savedAt);
      map = Object.fromEntries(sorted.slice(0, MAX_ENTRIES));
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(map).map(([key, value]) => [
            persistablePlaybackKey(key),
            persistableLock(persistablePlaybackKey(key), value),
          ]),
        ),
      ),
    );
  } catch {}
}

export function saveSeasonLock(
  metaId: string,
  entry: Omit<PlaybackEntry, "savedAt">,
  season?: number | null,
  seriesWide?: boolean,
): void {
  const all = readAll();
  all[seasonKey(metaId, seriesWide ? null : season)] = {
    ...entry,
    seriesWide,
    savedAt: Date.now(),
  };
  writeAll(all);
}

export function readSeasonLock(metaId: string, season?: number | null): SeasonLockEntry | null {
  metaId = persistablePlaybackIdentity(metaId);
  const all = readAll();
  const perSeason = season != null ? all[`${metaId}|s${season}`] : null;
  return perSeason ?? all[`${metaId}|all`] ?? null;
}

export function clearSeasonLock(metaId: string, season?: number | null): void {
  metaId = persistablePlaybackIdentity(metaId);
  const all = readAll();
  if (season != null) delete all[`${metaId}|s${season}`];
  delete all[`${metaId}|all`];
  writeAll(all);
}
