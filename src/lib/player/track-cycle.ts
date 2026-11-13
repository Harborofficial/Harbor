import type { TrackInfo } from "./bridge";

export const SUB_FONT_SIZE_MIN = 16;
export const SUB_FONT_SIZE_MAX = 120;
const SUB_FONT_SIZE_STEP = 2;

/** The audio track after the selected one, wrapping around. Null when there is nothing to switch to. */
export function nextAudioTrack(tracks: readonly TrackInfo[]): TrackInfo | null {
  if (tracks.length < 2) return null;
  const current = tracks.findIndex((track) => track.selected);
  return tracks[(current + 1) % tracks.length];
}

export function trackDisplayName(track: TrackInfo): string {
  return track.title || track.label || track.lang || track.id;
}

export function stepSubFontSize(current: number, direction: 1 | -1): number {
  const base = Number.isFinite(current) ? current : SUB_FONT_SIZE_MIN;
  const next = base + direction * SUB_FONT_SIZE_STEP;
  return Math.min(SUB_FONT_SIZE_MAX, Math.max(SUB_FONT_SIZE_MIN, next));
}
