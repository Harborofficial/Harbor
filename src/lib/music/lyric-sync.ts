import { deltaFn, type SyncPoint } from "@/lib/subtitles/text-sync";
import type { LyricLine } from "./lyrics";
import { lyricOffsetKey } from "./lyric-offset";
import { readMusicPreference, writeMusicPreference } from "./preferences";
import type { MusicTrack } from "./types";

const KEY = "harbor.music.lyric-sync.v1";
const LIMIT = 200;
const listeners = new Set<() => void>();

export function subscribeLyricSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function valid(points: unknown): SyncPoint[] {
  if (!Array.isArray(points)) return [];
  const clean = points
    .filter(
      (point): point is SyncPoint =>
        !!point &&
        typeof point === "object" &&
        Number.isFinite((point as SyncPoint).t) &&
        Number.isFinite((point as SyncPoint).at) &&
        (point as SyncPoint).t >= 0 &&
        (point as SyncPoint).at >= 0,
    )
    .map((point) => ({ t: round3(point.t), at: round3(point.at) }))
    .sort((a, b) => a.t - b.t);
  if (clean.length <= 2) return clean;
  return [clean[0], clean[clean.length - 1]];
}

function parse(raw: string | null): Record<string, SyncPoint[]> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, SyncPoint[]> = {};
    for (const [key, points] of Object.entries(value as Record<string, unknown>)) {
      const clean = valid(points);
      if (clean.length > 0) out[key] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

function trim(map: Record<string, SyncPoint[]>, limit = LIMIT): Record<string, SyncPoint[]> {
  const keys = Object.keys(map);
  if (keys.length <= limit) return map;
  const out: Record<string, SyncPoint[]> = {};
  for (const key of keys.slice(keys.length - limit)) out[key] = map[key];
  return out;
}

export function getLyricSync(track: MusicTrack | null | undefined): SyncPoint[] {
  const key = lyricOffsetKey(track);
  if (!key) return [];
  return parse(readMusicPreference(KEY))[key] ?? [];
}

export function setLyricSync(
  track: MusicTrack | null | undefined,
  points: SyncPoint[],
): SyncPoint[] {
  const key = lyricOffsetKey(track);
  if (!key) return [];
  const clean = valid(points);
  const all = parse(readMusicPreference(KEY));
  delete all[key];
  if (clean.length > 0) all[key] = clean;
  writeMusicPreference(KEY, JSON.stringify(trim(all)));
  for (const listener of listeners) listener();
  return clean;
}

/** Keeps the earliest and latest alignment, so the first section is never dropped. */
export function addLyricSyncPoint(points: SyncPoint[], point: SyncPoint): SyncPoint[] {
  return valid([...points.filter((held) => Math.abs(held.t - point.t) > 0.001), point]);
}

/** Corrected timestamps, so every section uses the same map rather than the clock's guess. */
export function applyLyricSync(lines: LyricLine[], points: SyncPoint[]): LyricLine[] {
  if (points.length === 0) return lines;
  const delta = deltaFn(points, 0);
  return lines.map((line) => ({
    ...line,
    at: Math.max(0, round3(line.at + delta(line.at))),
  }));
}
