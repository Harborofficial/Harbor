import type { TrackInfo } from "@/lib/player/bridge";
import type { SubCue } from "@/lib/subtitles/parser";
import { matchDialogueAnchors, normalizedDialogueCue } from "./dialogue-matches";
import { normalizeLang } from "@/lib/subtitles/language";
import { applyTimeTransform, fitPreferredTimeTransform } from "./alignment-fit";
import type { AffineTransform } from "./fp-gate";

export type ReferenceWindow = { startSec: number; lenSec: number };
export type ReferenceExcerpt = ReferenceWindow & { srt: string; timestampsAbsolute?: boolean };
export type EmbeddedReferenceFit = {
  transform: AffineTransform;
  matchCount: number;
  heldOutCount: number;
  regionCount: number;
  medianErrorSec: number;
  p90ErrorSec: number;
  alreadyAligned: boolean;
  strongOffset: boolean;
  /** Limited to the sampled playback scene; not verified throughout the episode. */
  localOnly?: boolean;
  /** Largest actual start-time adjustment across the observed reference span. */
  maximumChangeSec: number;
};

function median(values: number[]): number {
  const valuesSorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(valuesSorted.length / 2);
  return valuesSorted.length % 2
    ? (valuesSorted[mid] ?? 0)
    : ((valuesSorted[mid - 1] ?? 0) + (valuesSorted[mid] ?? 0)) / 2;
}

export function chooseEmbeddedReferenceTrack(
  tracks: TrackInfo[],
  selected: TrackInfo,
  allowCrossLanguage = false,
): { track: TrackInfo; index: number } | null {
  if (selected.kind !== "subtitle" || selected.external !== true) return null;
  const embedded = tracks.filter((t) => t.kind === "subtitle" && !t.external && !t.url);
  const targetLang = normalizeLang(selected.lang);
  if (!targetLang || targetLang === "und") return null;
  let fallback: { track: TrackInfo; index: number } | null = null;
  for (let index = 0; index < embedded.length; index++) {
    const track = embedded[index];
    const lang = normalizeLang(track.lang);
    const codec = (track.codec ?? "").toLowerCase();
    const label = [track.label, track.title].filter(Boolean).join(" ").toLowerCase();
    // Exclude bitmap subtitles and commentary, signs, songs or forced tracks;
    // their timing and text are not a reliable dialogue reference.
    if (
      (!allowCrossLanguage && lang !== targetLang) ||
      !lang ||
      lang === "und" ||
      track.forced ||
      track.foreignOnly ||
      /forced|signs?(?:\s*&\s*|\s+and\s+)songs?|commentary|lyrics/.test(label) ||
      /pgs|dvd[_ -]?sub|dvb[_ -]?sub|vobsub|bitmap|image/.test(codec)
    )
      continue;
    if (!/subrip|srt|ass|ssa|webvtt|mov_text|tx3g|text/.test(codec)) continue;
    if (lang === targetLang) return { track, index };
    fallback ??= { track, index };
  }
  return fallback;
}

export function embeddedReferenceWindows(
  durationSec: number,
  focusSec?: number,
): ReferenceWindow[] {
  if (!Number.isFinite(durationSec) || durationSec < 300) return [];
  // Sample the scene that the viewer is actually watching, plus two distant
  // independent regions. Extrapolating a drift model from later scenes alone
  // can produce a near-zero correction at the current position.
  const lenSec = 90;
  const centers = [0.1, 0.48, 0.84].map((p) => durationSec * p);
  if (
    focusSec !== undefined &&
    Number.isFinite(focusSec) &&
    focusSec >= 0 &&
    focusSec <= durationSec
  ) {
    const nearest = centers.reduce(
      (best, center, index) =>
        Math.abs(center - focusSec) < Math.abs(centers[best] - focusSec) ? index : best,
      0,
    );
    centers[nearest] = focusSec;
  }
  const maxStart = durationSec - lenSec;
  return centers.map((center) => ({
    startSec: Math.min(maxStart, Math.max(0, center - lenSec / 2)),
    lenSec,
  }));
}

type Anchor = { sourceSec: number; targetSec: number; region: number; grouped: boolean };

export type EmbeddedReferenceDiagnostics = {
  cueCounts: number[];
  usableDialogueCounts: number[];
  textMatches: number[];
  groupedMatches: number[];
  plausibleMatches: number[];
  repeatedWindows: number;
  /** Median reference-minus-selected offset for exact text matches, per window. */
  windowMedianOffsets: Array<number | null>;
  /** Variation of those offsets within each window. */
  windowOffsetMad: Array<number | null>;
};

export type EmbeddedFitRejectReason =
  | "bad-input"
  | "insufficient-unique-anchors"
  | "insufficient-regions"
  | "insufficient-timeline-span"
  | "insufficient-heldout-anchors"
  | "model-unavailable"
  | "transform-out-of-bounds"
  | "heldout-inconsistent"
  | "region-inconsistent"
  | "verified";
export type EmbeddedFitTrace = {
  timingWindows?: Array<{
    startSec: number;
    cueCount: number;
    offsetSec: number | null;
    reason: string;
  }>;
  reason: EmbeddedFitRejectReason;
  anchorCount: number;
  regionAnchorCounts: number[];
  heldOutMedianSec: number | null;
  heldOutP90Sec: number | null;
  candidateOffsetSec: number | null;
  candidateRatio: number | null;
};

/**
 * FFmpeg input seeking on some network Matroska streams can return a repeated
 * subtitle segment for two different requested windows. Global uniqueness
 * would then discard every copied line and turn a previously valid reference
 * into zero matches. Keep the window whose dialogue occurs closest to its
 * expected movie position, without treating copied windows as corroboration.
 */
export function inspectEmbeddedReference(
  selectedCues: SubCue[],
  referenceWindows: Array<{ startSec: number; cues: SubCue[] }>,
  language: string,
): {
  windows: Array<{ startSec: number; cues: SubCue[] }>;
  diagnostics: EmbeddedReferenceDiagnostics;
} {
  const ranks = referenceWindows.map((window, index) => {
    const anchors = matchDialogueAnchors(selectedCues, [window], language);
    const deltas = anchors.map((a) => a.targetSec - a.sourceSec);
    const plausible = deltas.filter((delta) => Math.abs(delta) <= 90).length;
    const timeError = deltas.reduce((sum, delta) => sum + Math.min(Math.abs(delta), 3600), 0);
    const usable = window.cues
      .map((cue) => normalizedDialogueCue(cue.text ?? "", language))
      .filter((line): line is string => line !== null);
    return {
      index,
      window,
      text: new Set(usable.filter((line) => line.length >= 10)),
      usableCount: usable.length,
      matches: anchors.length,
      groupedMatches: anchors.filter((a) => a.grouped).length,
      plausible,
      timeError: anchors.length ? timeError / anchors.length : Infinity,
      offsetMedian: deltas.length ? median(deltas) : null,
      offsetMad: deltas.length
        ? median(deltas.map((delta) => Math.abs(delta - median(deltas))))
        : null,
    };
  });
  // Only collapse obvious copies (>=80% intersection), not ordinary repeated
  // dialogue. A duplicated sample can contribute at most one region.
  const skipped = new Set<number>();
  for (let i = 0; i < ranks.length; i++) {
    for (let j = i + 1; j < ranks.length; j++) {
      const a = ranks[i],
        b = ranks[j];
      if (a.text.size < 4 || b.text.size < 4) continue;
      let overlap = 0;
      for (const line of a.text) if (b.text.has(line)) overlap += 1;
      if (overlap / Math.min(a.text.size, b.text.size) < 0.8) continue;
      const candidate =
        a.plausible !== b.plausible
          ? a.plausible > b.plausible
            ? a
            : b
          : a.timeError !== b.timeError
            ? a.timeError < b.timeError
              ? a
              : b
            : a.text.size >= b.text.size
              ? a
              : b;
      skipped.add(candidate === a ? j : i);
    }
  }
  return {
    windows: ranks
      .filter((rank) => !skipped.has(rank.index) && rank.plausible >= 4)
      .map((rank) => rank.window),
    diagnostics: {
      cueCounts: ranks.map((rank) => rank.window.cues.length),
      usableDialogueCounts: ranks.map((rank) => rank.usableCount),
      textMatches: ranks.map((rank) => rank.matches),
      groupedMatches: ranks.map((rank) => rank.groupedMatches),
      plausibleMatches: ranks.map((rank) => rank.plausible),
      repeatedWindows: skipped.size,
      windowMedianOffsets: ranks.map((rank) => rank.offsetMedian),
      windowOffsetMad: ranks.map((rank) => rank.offsetMad),
    },
  };
}

export function fitEmbeddedReference(
  selectedCues: SubCue[],
  referenceWindows: Array<{ startSec: number; cues: SubCue[] }>,
  language: string,
  durationSec: number,
  trace?: EmbeddedFitTrace,
): EmbeddedReferenceFit | null {
  const reject = (reason: EmbeddedFitRejectReason): null => {
    if (trace) trace.reason = reason;
    return null;
  };
  if (trace) {
    trace.reason = "bad-input";
    trace.anchorCount = 0;
    trace.regionAnchorCounts = [];
    trace.heldOutMedianSec = null;
    trace.heldOutP90Sec = null;
    trace.candidateOffsetSec = null;
    trace.candidateRatio = null;
  }
  if (selectedCues.length < 20 || !Number.isFinite(durationSec) || durationSec < 300)
    return reject("bad-input");
  const usableWindows = inspectEmbeddedReference(selectedCues, referenceWindows, language).windows;
  // Match unique exact lines first; bounded split/merged phrases can recover
  // additional evidence, but each underlying cue may contribute only once.
  // Distinct extraction windows remain independent timing regions.
  const anchors: Anchor[] = matchDialogueAnchors(selectedCues, usableWindows, language).filter(
    (a) =>
      Number.isFinite(a.sourceSec) &&
      Number.isFinite(a.targetSec) &&
      a.sourceSec >= 0 &&
      a.targetSec >= 0 &&
      a.sourceSec <= durationSec + 120 &&
      a.targetSec <= durationSec + 120,
  );
  const regionAnchorCounts = usableWindows.map(
    (_w, region) => anchors.filter((a) => a.region === region).length,
  );
  const regions = new Set<number>();
  regionAnchorCounts.forEach((count, region) => {
    if (count >= 4) regions.add(region);
  });
  if (trace) {
    trace.anchorCount = anchors.length;
    trace.regionAnchorCounts = regionAnchorCounts;
  }
  if (regions.size < 2) return reject("insufficient-regions");
  // Three widely separated, independently sourced regions can support a
  // manually confirmed offset from 15 unique lines. With only two regions
  // retain the stricter 18-line floor. Sparse estimates never auto-apply.
  if (anchors.length < (regions.size >= 3 ? 15 : 18)) return reject("insufficient-unique-anchors");
  anchors.sort((a, b) => a.sourceSec - b.sourceSec);
  if (
    anchors[anchors.length - 1].sourceSec - anchors[0].sourceSec <
    Math.min(300, durationSec * 0.2)
  )
    return reject("insufficient-timeline-span");
  const fitAnchors = anchors.filter((_a, i) => i % 4 !== 0);
  const heldOut = anchors.filter((_a, i) => i % 4 === 0);
  if (
    fitAnchors.length < (regions.size >= 3 ? 11 : 12) ||
    heldOut.length < (regions.size >= 3 ? 4 : 5)
  )
    return reject("insufficient-heldout-anchors");
  const fit = fitPreferredTimeTransform(fitAnchors, {
    maxSegments: 1,
    ratioBounds: [0.95, 1.05],
    minAffineSpanSec: 240,
    offsetToleranceSec: 0.35,
    inlierFloorSec: 0.4,
  });
  if (!fit || fit.transform.kind !== "affine") return reject("model-unavailable");
  const t = fit.transform;
  if (trace) {
    trace.candidateOffsetSec = Number.isFinite(t.offsetSec) ? t.offsetSec : null;
    trace.candidateRatio = Number.isFinite(t.ratio) ? t.ratio : null;
  }
  if (
    Math.abs(t.offsetSec) > 60 ||
    t.ratio < 0.95 ||
    t.ratio > 1.05 ||
    !Number.isFinite(t.offsetSec) ||
    !Number.isFinite(t.ratio)
  )
    return reject("transform-out-of-bounds");
  // Validate against *withheld* pairs from each disjoint time region. Reject
  // a local coincidence, wrong release, edit/cut, or non-linear drift.
  const errors = heldOut
    .map((a) => Math.abs(a.targetSec - applyTimeTransform(t, a.sourceSec)))
    .sort((a, b) => a - b);
  const med = median(errors);
  const p90 = errors[Math.floor((errors.length - 1) * 0.9)] ?? Infinity;
  if (trace) {
    trace.heldOutMedianSec = med;
    trace.heldOutP90Sec = p90;
  }
  if (med > 0.42 || p90 > 1.1) return reject("heldout-inconsistent");
  for (const region of regions) {
    const perRegion = heldOut
      .filter((a) => a.region === region)
      .map((a) => Math.abs(a.targetSec - applyTimeTransform(t, a.sourceSec)));
    if (perRegion.length < 1 || median(perRegion) > 0.55) return reject("region-inconsistent");
  }
  // A ratio/structural correction is always offered; only a tightly
  // validated, near-constant shift across regions can be auto-applied.
  // Even a tiny non-identity ratio can be indistinguishable in a scene.
  // A proposal that changes all matched timestamps by <250 ms must not be
  // presented as a successful synchronization or a meaningful best guess.
  const maximumChangeSec = Math.max(
    ...anchors.map((anchor) =>
      Math.abs(applyTimeTransform(t, anchor.sourceSec) - anchor.sourceSec),
    ),
  );
  const alreadyAligned = maximumChangeSec < 0.25;
  // A structural (split/merge) match can support a manually reviewed offer,
  // but automatic application still needs at least 18 exact, unsplit anchors.
  const strongOffset =
    !alreadyAligned &&
    t.ratio === 1 &&
    fitAnchors.length >= 18 &&
    anchors.filter((a) => !a.grouped).length >= 18 &&
    regions.size >= 2 &&
    med <= 0.2 &&
    p90 <= 0.45;
  if (trace) trace.reason = "verified";
  return {
    transform: t,
    matchCount: anchors.length,
    heldOutCount: heldOut.length,
    regionCount: regions.size,
    medianErrorSec: med,
    p90ErrorSec: p90,
    alreadyAligned,
    strongOffset,
    maximumChangeSec,
  };
}

/**
 * Correct the scene that is actually playing when different release cuts
 * make a whole-film linear drift fit misleading. This is text-reference
 * evidence, never an audio-verified correction and never auto-applied.
 *
 * A local shift must be supported by several unique matching dialogue lines
 * in the same 90-second embedded subtitle window. We validate withheld
 * anchors and reject discontinuous or ambiguous scene timing.
 */
export function fitFocusedEmbeddedReference(
  selectedCues: SubCue[],
  referenceWindows: Array<{ startSec: number; cues: SubCue[] }>,
  language: string,
  focusSec: number,
): EmbeddedReferenceFit | null {
  if (!Number.isFinite(focusSec) || focusSec < 0 || selectedCues.length < 20) return null;
  const available = inspectEmbeddedReference(selectedCues, referenceWindows, language).windows;
  // Every candidate must contain the playhead. A nonlocal window may happen
  // to have a good fit yet be useless for this scene, as the reported case did.
  const focusWindow = available
    .filter((w) => w.cues.some((c) => Math.abs(c.start - focusSec) <= 55))
    .sort(
      (a, b) =>
        Math.abs(median(a.cues.map((c) => c.start)) - focusSec) -
        Math.abs(median(b.cues.map((c) => c.start)) - focusSec),
    )[0];
  if (!focusWindow) return null;
  const anchors: Array<{ sourceSec: number; targetSec: number; delta: number }> = [];
  for (const match of matchDialogueAnchors(selectedCues, [focusWindow], language)) {
    const { sourceSec, targetSec } = match;
    if (
      Math.abs(targetSec - focusSec) > 55 ||
      !Number.isFinite(sourceSec) ||
      !Number.isFinite(targetSec)
    )
      continue;
    const delta = targetSec - sourceSec;
    if (Math.abs(delta) > 90) continue;
    anchors.push({ sourceSec, targetSec, delta });
  }
  if (anchors.length < 6) return null;
  anchors.sort((a, b) => a.sourceSec - b.sourceSec);
  if (anchors[anchors.length - 1].targetSec - anchors[0].targetSec < 15) return null;
  const candidates = anchors.map((a) => a.delta);
  const initial = median(candidates);
  const deviations = candidates.map((v) => Math.abs(v - initial));
  const spread = median(deviations);
  if (spread > 0.7) return null;
  const inliers = anchors.filter((a) => Math.abs(a.delta - initial) <= Math.max(0.75, spread * 3));
  if (inliers.length < 6) return null;
  // Withheld lines must agree with the local-fit offset. Never claim a
  // successful alignment from matching text alone.
  const fitLines = inliers.filter((_a, i) => i % 4 !== 0);
  const withheld = inliers.filter((_a, i) => i % 4 === 0);
  if (fitLines.length < 4 || withheld.length < 2) return null;
  const offsetSec = median(fitLines.map((a) => a.delta));
  const errors = withheld.map((a) => Math.abs(a.delta - offsetSec)).sort((a, b) => a - b);
  const med = median(errors);
  const p90 = errors[Math.floor((errors.length - 1) * 0.9)] ?? Infinity;
  if (med > 0.45 || p90 > 0.9) return null;
  return {
    transform: { kind: "affine", offsetSec, ratio: 1 },
    matchCount: inliers.length,
    heldOutCount: withheld.length,
    regionCount: 1,
    medianErrorSec: med,
    p90ErrorSec: p90,
    alreadyAligned: Math.abs(offsetSec) < 0.25,
    strongOffset: false,
    localOnly: true,
    maximumChangeSec: Math.abs(offsetSec),
  };
}
