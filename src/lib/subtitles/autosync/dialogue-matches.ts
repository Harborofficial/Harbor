import type { SubCue } from "@/lib/subtitles/parser";
import { normalizeLine } from "./consensus";

/**
 * Same conservative non-dialogue gate is used by the scene audio picker and
 * by embedded-text anchors. This is a heuristic, not speech recognition.
 */
export function isLikelyDialogueCue(raw: string): boolean {
  const text = raw
    .replace(/<[^>]*>|\{[^}]*\}/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot);/gi, " ")
    .replace(/\s+/g, " ").trim();
  if (!text || /^[♪♫\s]+$/.test(text) ||
    /^(?:\[[^\]]+\]|\([^)]*\))$/.test(text) ||
    /\b(?:subtitles?|captions?|translated|translation|transcribed|synchronized|synchronised|syncronized|synced|corrected|encoded|ripped|resynced)\b.{0,65}\b(?:by|from)\b/i.test(text) ||
    /(?:www\.|https?:\/\/|opensubtitles|subscene\.com)/i.test(text)) return false;
  return normalizeLine(text).length >= 3;
}

export function normalizedDialogueCue(raw: string, language: string): string | null {
  if (!isLikelyDialogueCue(raw)) return null;
  const line = normalizeLine(raw.replace(/\n+/g, " "), language);
  return line.length >= 3 ? line : null;
}

type Candidate = {
  text: string;
  startSec: number;
  parts: number;
  ids: string[];
  region: number;
};

export type DialogueAnchorMatch = {
  sourceSec: number;
  targetSec: number;
  region: number;
  grouped: boolean;
};

/**
 * Build only contiguous 1-3-cue phrases. A grouped phrase is anchored to its
 * first actual subtitle line, never to an interpolated or invented timestamp.
 * Reject gaps/cross-scene joins, credits, repeated phrases and overlapping
 * reuse of any cue. Grouping improves text identification, not timing gates.
 */
function buildCandidates(cues: SubCue[], language: string, region: number): Candidate[] {
  const prepared = cues.map((cue, index) => ({
    cue, index, text: normalizedDialogueCue(cue.text ?? "", language),
  }));
  const output: Candidate[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const first = prepared[i];
    if (!first.text || !Number.isFinite(first.cue.start) ||
      !Number.isFinite(first.cue.end) || first.cue.end <= first.cue.start) continue;
    const pieces: typeof prepared = [];
    for (let j = i; j < Math.min(prepared.length, i + 3); j++) {
      const next = prepared[j];
      if (!next.text || !Number.isFinite(next.cue.start) ||
        !Number.isFinite(next.cue.end) || next.cue.end <= next.cue.start) break;
      if (pieces.length) {
        const prev = pieces[pieces.length - 1].cue;
        // Prevent joining unrelated dialogue across pauses, overlapping
        // alternatives or a long subtitle montage.
        if (next.cue.start < prev.start ||
          next.cue.start - prev.end > 1.5 ||
          next.cue.end - first.cue.start > 16) break;
      }
      pieces.push(next);
      const text = pieces.map(x => x.text).join(" ");
      if (text.length >= 10) output.push({
        text,
        startSec: first.cue.start,
        parts: pieces.length,
        ids: pieces.map(x => `${region}:${x.index}`),
        region,
      });
    }
  }
  return output;
}

function uniqueByText(candidates: Candidate[]): Map<string, Candidate> {
  const unique = new Map<string, Candidate>();
  const ambiguous = new Set<string>();
  for (const candidate of candidates) {
    if (unique.has(candidate.text)) {
      ambiguous.add(candidate.text);
    } else if (!ambiguous.has(candidate.text)) {
      unique.set(candidate.text, candidate);
    }
  }
  for (const text of ambiguous) unique.delete(text);
  return unique;
}

/** Returns at most one anchor for each underlying cue on either side. */
export function matchDialogueAnchors(
  selectedCues: SubCue[],
  referenceWindows: Array<{ startSec: number; cues: SubCue[] }>,
  language: string,
): DialogueAnchorMatch[] {
  const source = uniqueByText(buildCandidates(selectedCues, language, 0));
  const reference = uniqueByText(referenceWindows.flatMap((window, region) =>
    buildCandidates(window.cues, language, region)));
  const matches: Array<{ source: Candidate; reference: Candidate }> = [];
  for (const [text, target] of reference) {
    const selected = source.get(text);
    if (selected) matches.push({ source: selected, reference: target });
  }
  // Unsplit lines are stronger evidence. Consume them first and only use
  // grouped phrases to recover genuinely otherwise-unmatched dialogue.
  matches.sort((a, b) =>
    (a.source.parts + a.reference.parts) - (b.source.parts + b.reference.parts) ||
    a.reference.startSec - b.reference.startSec);
  const usedSource = new Set<string>();
  const usedReference = new Set<string>();
  const anchors: DialogueAnchorMatch[] = [];
  for (const { source: s, reference: r } of matches) {
    if (s.ids.some(id => usedSource.has(id)) ||
      r.ids.some(id => usedReference.has(id))) continue;
    s.ids.forEach(id => usedSource.add(id));
    r.ids.forEach(id => usedReference.add(id));
    anchors.push({
      sourceSec: s.startSec,
      targetSec: r.startSec,
      region: r.region,
      grouped: s.parts > 1 || r.parts > 1,
    });
  }
  return anchors;
}
