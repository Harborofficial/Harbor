import type { SubCue } from "../parser";
import { normalizedDialogueCue } from "./dialogue-matches";

export const SCENE_CLIP_SEC = 45;
export const SCENE_SEARCH_RADIUS_SEC = 90;
export const MIN_SCENE_DIALOGUE_CUES = 4;

export type DialogueScene = {
  startSec: number;
  endSec: number;
  /** Distinct spoken lines (not just subtitle blocks or credits). */
  dialogueCount: number;
  /** Cue intervals measured relative to startSec, for the *same* audio interval. */
  intervals: Array<[number, number]>;
  distanceFromPlaybackSec: number;
};

/** Choose a different, already-buffered excerpt before retrying speech recognition.
 * Selection uses proximity and dialogue availability, never a candidate offset.
 */
export function selectPlaybackRetryScene(
  scenes: DialogueScene[],
  playbackSec: number,
  failedStartSec: number,
): DialogueScene | undefined {
  return scenes
    .filter(
      (scene) =>
        scene.startSec >= playbackSec &&
        scene.startSec - failedStartSec >= (scene.endSec - scene.startSec) / 3,
    )
    .sort((a, b) => a.startSec - b.startSec)[0];
}

function normalizedDialogue(raw: string): string | null {
  return normalizedDialogueCue(raw, "");
}

function seekableRanges(value: unknown): Array<{ start: number; end: number }> {
  if (!Array.isArray(value)) return [];
  const ranges = value
    .filter(
      (item): item is { start: number; end: number } =>
        item != null &&
        typeof item === "object" &&
        typeof item.start === "number" &&
        Number.isFinite(item.start) &&
        typeof item.end === "number" &&
        Number.isFinite(item.end) &&
        item.end > item.start,
    )
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 0.01) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * Find nearby dialogue-rich *45-second* windows. Unlike the previous
 * [playhead, playhead+45] gate, windows can include earlier speech.
 * The audio extractor must use the returned startSec, not the playhead.
 *
 * When bufferedRanges is provided, a candidate is valid only if the whole
 * audio window is available. We never shift subtitle cues independently
 * from the audio interval.
 */
export function rankDialogueScenes(
  cues: SubCue[],
  playbackSec: number,
  durationSec: number,
  clipSec = SCENE_CLIP_SEC,
  bufferedRanges?: unknown,
  minimumDialogueCues = MIN_SCENE_DIALOGUE_CUES,
): DialogueScene[] {
  if (
    !Number.isFinite(playbackSec) ||
    !Number.isFinite(durationSec) ||
    !Number.isFinite(clipSec) ||
    durationSec < clipSec ||
    clipSec <= 0
  )
    return [];
  const focus = Math.max(0, Math.min(durationSec, playbackSec));
  const maxStart = durationSec - clipSec;
  const ranges = bufferedRanges === undefined ? null : seekableRanges(bufferedRanges);
  const candidates: DialogueScene[] = [];
  const seen = new Set<number>();
  const starts = [
    focus,
    focus - clipSec / 2,
    focus - clipSec,
    ...(ranges ?? []).flatMap((range) => [range.start, range.end - clipSec]),
    ...Array.from(
      { length: Math.ceil((clipSec + SCENE_SEARCH_RADIUS_SEC * 2) / 5) + 1 },
      (_, i) => focus - clipSec - SCENE_SEARCH_RADIUS_SEC + i * 5,
    ),
  ];
  for (const proposed of starts) {
    const start = Math.max(0, Math.min(maxStart, proposed));
    const key = Math.round(start * 1000);
    if (seen.has(key)) continue;
    seen.add(key);
    const end = start + clipSec;
    const outside = focus < start ? start - focus : focus > end ? focus - end : 0;
    if (outside > SCENE_SEARCH_RADIUS_SEC) continue;
    if (ranges && !ranges.some((range) => range.start <= start + 0.05 && range.end >= end - 0.05))
      continue;
    const normalized = new Set<string>();
    const intervals: Array<[number, number]> = [];
    for (const cue of cues) {
      if (
        !Number.isFinite(cue.start) ||
        !Number.isFinite(cue.end) ||
        cue.end <= cue.start ||
        cue.end <= start + 0.5 ||
        cue.start >= end
      )
        continue;
      const line = normalizedDialogue(cue.text);
      if (!line || normalized.has(line)) continue;
      normalized.add(line);
      intervals.push([Math.max(0, cue.start - start), Math.min(clipSec, cue.end - start)]);
    }
    if (intervals.length < minimumDialogueCues) continue;
    candidates.push({
      startSec: start,
      endSec: end,
      dialogueCount: intervals.length,
      intervals,
      distanceFromPlaybackSec: outside,
    });
  }
  // Nearby spoken dialogue takes priority, but a better populated window
  // (including speech just behind the playhead) wins over a sparse window.
  candidates.sort((a, b) => {
    const score = (scene: DialogueScene) =>
      Math.min(12, scene.dialogueCount) * 2.5 -
      scene.distanceFromPlaybackSec * 0.35 -
      Math.abs(scene.startSec + clipSec / 2 - focus) * 0.06;
    return (
      score(b) - score(a) ||
      a.distanceFromPlaybackSec - b.distanceFromPlaybackSec ||
      Math.abs(a.startSec + clipSec / 2 - focus) - Math.abs(b.startSec + clipSec / 2 - focus)
    );
  });
  return candidates;
}
