import { parseSubtitle, type SubCue } from "@/lib/subtitles/parser";
import type { ReferenceExcerpt } from "./embedded-reference";
import { normalizedDialogueCue } from "./dialogue-matches";

export function embeddedExcerptCues(excerpt: ReferenceExcerpt): SubCue[] {
  const base = excerpt.timestampsAbsolute ? 0 : excerpt.startSec;
  return parseSubtitle(excerpt.srt, "srt")
    .map((cue) => ({ ...cue, start: cue.start + base, end: cue.end + base }))
    .filter(
      (cue) =>
        Number.isFinite(cue.start) &&
        Number.isFinite(cue.end) &&
        cue.end > cue.start &&
        cue.start >= excerpt.startSec &&
        cue.start < excerpt.startSec + excerpt.lenSec,
    );
}

export type EmbeddedExtractionStatus =
  | "not-applicable"
  | "no-excerpts"
  | "no-dialogue"
  | "insufficient-dialogue"
  | "usable";

export type EmbeddedExtractionSummary = {
  status: EmbeddedExtractionStatus;
  rawCues: number;
  dialogueCues: number;
  usableWindows: number;
};

/**
 * Empty FFmpeg output is NOT a text mismatch. Count usable spoken lines,
 * independently of whether their wording agrees with the selected subtitle.
 */
export function summarizeEmbeddedExtraction(
  regions: Array<{ cues: SubCue[] }>,
  language: string,
): EmbeddedExtractionSummary {
  const rawCues = regions.reduce((n, region) => n + region.cues.length, 0);
  let dialogueCues = 0;
  let usableWindows = 0;
  for (const region of regions) {
    const count = region.cues.filter((c) => normalizedDialogueCue(c.text ?? "", language)).length;
    dialogueCues += count;
    if (count > 0) usableWindows++;
  }
  const status: EmbeddedExtractionStatus =
    regions.length === 0
      ? "no-excerpts"
      : dialogueCues === 0
        ? "no-dialogue"
        : dialogueCues < 4
          ? "insufficient-dialogue"
          : "usable";
  return { status, rawCues, dialogueCues, usableWindows };
}
