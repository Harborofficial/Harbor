import type { TrackInfo } from "./bridge";

/**
 * An mpv sub-delay applies to every selected subtitle. A saved show-level
 * offset may belong to an external subtitle, not the embedded track the
 * viewer has just selected. Never carry it into an embedded track.
 *
 * Explicit manual adjustments made after selection still work normally.
 */
export function initialDelayForSelectedTrack(
  selected: Pick<TrackInfo, "external"> | null | undefined,
  savedManualDelay: number | null | undefined,
  savedTrackKind?: "embedded" | "external" | null,
): number {
  if (!selected) return 0;
  const currentKind = selected.external === true ? "external" : "embedded";
  // Old preferences had no track kind; they must not leak to embedded tracks.
  if (savedTrackKind ? savedTrackKind !== currentKind : currentKind !== "external") {
    return 0;
  }
  return typeof savedManualDelay === "number" &&
    Number.isFinite(savedManualDelay) &&
    Math.abs(savedManualDelay) <= 120
    ? savedManualDelay
    : 0;
}
