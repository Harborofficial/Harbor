import type { TrackInfo } from "@/lib/player/bridge";

/**
 * A generic "Synced (SRT)" title is not enough to keep a correction alive.
 * It must be the actual file produced by this Auto sync run.
 */
export function isOwnGeneratedSyncTrack(
  track: Pick<TrackInfo, "title" | "external" | "externalFilename" | "url" | "originalUrl"> | null,
  generatedTrackPath: string | null | undefined,
): boolean {
  if (!track || track.external !== true ||
      !/^Synced \((?:SRT|VTT)\)/.test(track.title ?? "") ||
      !generatedTrackPath) return false;
  const normalized = (value: string) => value.replace(/\\/g, "/").toLowerCase();
  const expected = normalized(generatedTrackPath);
  return [track.externalFilename, track.url, track.originalUrl].some(
    (path) => typeof path === "string" && normalized(path) === expected,
  );
}

/** A source change must use the incoming video's manual baseline, not the old one. */
export function autoSyncExitBaseline(
  priorMediaKey: string,
  nextMediaKey: string,
  priorManualDelaySec: number,
  nextManualDelaySec: number,
): number {
  return priorMediaKey === nextMediaKey ? priorManualDelaySec : nextManualDelaySec;
}
