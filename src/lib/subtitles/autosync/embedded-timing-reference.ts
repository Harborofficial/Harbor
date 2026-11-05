import type { SubCue } from "../parser";
import { crossLanguagePlaybackOffset, robustMedian } from "./drift-dsp";
import { isLikelyDialogueCue } from "./dialogue-matches";
import type { EmbeddedReferenceFit, EmbeddedFitTrace } from "./embedded-reference";

/** Different translations may share timing patterns, but never lexical anchors.
 * Require a distinctive offset in two distant, non-overlapping reference regions.
 * The second region independently confirms the first; this remains offer-only.
 */
export function fitEmbeddedTimingReference(
  selected: SubCue[],
  regions: Array<{ startSec: number; lenSec: number; cues: SubCue[] }>,
  durationSec: number,
  trace?: EmbeddedFitTrace,
): EmbeddedReferenceFit | null {
  if (trace) {
    trace.reason = "insufficient-regions";
    trace.timingWindows = [];
  }
  const target: Array<[number, number]> = selected
    .filter((cue) => isLikelyDialogueCue(cue.text))
    .map((cue) => [cue.start, cue.end]);
  const matches: Array<{ start: number; end: number; offset: number }> = [];
  const fingerprints = new Set<string>();
  for (const region of regions.slice().sort((a, b) => a.startSec - b.startSec)) {
    if (matches.some((m) => region.startSec < m.end && region.startSec + region.lenSec > m.start))
      continue;
    const dialogue = region.cues.filter((cue) => isLikelyDialogueCue(cue.text));
    const windowTrace = {
      startSec: region.startSec,
      cueCount: dialogue.length,
      offsetSec: null as number | null,
      reason: "insufficient-dialogue",
    };
    trace?.timingWindows?.push(windowTrace);
    if (dialogue.length < 6) continue;
    // Repeated network seeks are not independent evidence, even if rebased.
    const fingerprint = JSON.stringify(dialogue.map((cue) => cue.text.trim()));
    if (fingerprints.has(fingerprint)) {
      windowTrace.reason = "repeated-seek";
      continue;
    }
    fingerprints.add(fingerprint);
    const reference: Array<[number, number]> = dialogue.map((cue) => [cue.start, cue.end]);
    // Leave extraction boundaries out of the fit: translated lines often
    // straddle those boundaries differently, and seeks may truncate the first cue.
    const interior = { startSec: region.startSec + 15, lenSec: region.lenSec - 30 };
    if (interior.lenSec < 60) continue;
    const offset = crossLanguagePlaybackOffset(reference, target, [interior], 30);
    windowTrace.offsetSec = offset;
    windowTrace.reason = offset === null ? "ambiguous-timing" : "matched";
    if (offset !== null)
      matches.push({ start: region.startSec, end: region.startSec + region.lenSec, offset });
  }
  if (trace) {
    trace.anchorCount = matches.length;
    trace.regionAnchorCounts =
      trace.timingWindows?.map((w) => (w.offsetSec === null ? 0 : 1)) ?? [];
  }
  if (matches.length < 2) return null;
  if (matches[matches.length - 1].start - matches[0].start < durationSec * 0.35) {
    if (trace) trace.reason = "insufficient-timeline-span";
    return null;
  }
  const offsets = matches.map((m) => m.offset);
  if (Math.max(...offsets) - Math.min(...offsets) > 0.5) {
    if (trace) trace.reason = "region-inconsistent";
    return null;
  }
  const offsetSec = robustMedian(offsets);
  if (trace) {
    trace.reason = "verified";
    trace.candidateOffsetSec = offsetSec;
    trace.candidateRatio = 1;
  }
  return {
    transform: { kind: "affine", offsetSec, ratio: 1 },
    matchCount: matches.length,
    heldOutCount: matches.length - 1,
    regionCount: matches.length,
    medianErrorSec: robustMedian(offsets.map((offset) => Math.abs(offset - offsetSec))),
    p90ErrorSec: Math.max(...offsets.map((offset) => Math.abs(offset - offsetSec))),
    alreadyAligned: Math.abs(offsetSec) < 0.25,
    strongOffset: false,
    maximumChangeSec: Math.abs(offsetSec),
  };
}
