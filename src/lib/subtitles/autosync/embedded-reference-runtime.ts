import { invoke } from "@tauri-apps/api/core";
import type { TrackInfo } from "@/lib/player/bridge";
import { type SubCue } from "@/lib/subtitles/parser";
import {
  embeddedExcerptCues,
  summarizeEmbeddedExtraction,
  type EmbeddedExtractionStatus,
} from "./embedded-extraction";
import { fitEmbeddedTimingReference } from "./embedded-timing-reference";
import { normalizeLang } from "../language";
import {
  chooseEmbeddedReferenceTrack,
  embeddedReferenceWindows,
  fitEmbeddedReference,
  fitFocusedEmbeddedReference,
  inspectEmbeddedReference,
  type EmbeddedReferenceDiagnostics,
  type EmbeddedFitTrace,
  type EmbeddedReferenceFit,
  type ReferenceExcerpt,
} from "./embedded-reference";

export type EmbeddedReferenceRead = {
  timingOnly?: boolean;
  checked: boolean;
  extraction: EmbeddedExtractionStatus;
  requestedWindows: number;
  rawCueCount: number;
  dialogueCueCount: number;
  usableWindows: number;
  windows: number;
  fit: EmbeddedReferenceFit | null;
  diagnostics: EmbeddedReferenceDiagnostics | null;
  fitTrace: EmbeddedFitTrace | null;
};

export async function readEmbeddedReference(input: {
  source: string;
  headers?: Record<string, string>;
  tracks: TrackInfo[];
  selected: TrackInfo;
  selectedCues: SubCue[];
  durationSec: number;
  focusSec: number;
  sessionId: string;
  allowCrossLanguage?: boolean;
}): Promise<EmbeddedReferenceRead> {
  const referenceTrack = chooseEmbeddedReferenceTrack(
    input.tracks,
    input.selected,
    input.allowCrossLanguage,
  );
  const windows = embeddedReferenceWindows(input.durationSec, input.focusSec);
  if (!referenceTrack || windows.length < 2) {
    return {
      checked: false,
      extraction: "not-applicable",
      requestedWindows: windows.length,
      windows: 0,
      rawCueCount: 0,
      dialogueCueCount: 0,
      usableWindows: 0,
      fit: null,
      diagnostics: null,
      fitTrace: null,
    };
  }
  const excerpts = await invoke<ReferenceExcerpt[]>("subsync_embedded_reference", {
    source: input.source,
    headers: input.headers ?? null,
    streamIndex: referenceTrack.index,
    windows,
    sessionId: input.sessionId,
  });
  const regions = excerpts.map((excerpt) => ({
    startSec: excerpt.startSec,
    lenSec: excerpt.lenSec,
    cues: embeddedExcerptCues(excerpt),
  }));
  const timingOnly =
    normalizeLang(referenceTrack.track.lang) !== normalizeLang(input.selected.lang);
  const extraction = summarizeEmbeddedExtraction(regions, input.selected.lang ?? "");
  // If FFmpeg returned no usable dialogue, no text comparison was possible.
  if (extraction.status !== "usable") {
    return {
      checked: false,
      extraction: extraction.status,
      requestedWindows: windows.length,
      windows: excerpts.length,
      rawCueCount: extraction.rawCues,
      dialogueCueCount: extraction.dialogueCues,
      usableWindows: extraction.usableWindows,
      fit: null,
      diagnostics: null,
      fitTrace: null,
    };
  }
  const fitTrace: EmbeddedFitTrace = {
    reason: "bad-input",
    anchorCount: 0,
    regionAnchorCounts: [],
    heldOutMedianSec: null,
    heldOutP90Sec: null,
    candidateOffsetSec: null,
    candidateRatio: null,
  };
  if (timingOnly) {
    return {
      checked: true,
      timingOnly: true,
      extraction: extraction.status,
      requestedWindows: windows.length,
      windows: excerpts.length,
      rawCueCount: extraction.rawCues,
      dialogueCueCount: extraction.dialogueCues,
      usableWindows: extraction.usableWindows,
      fit: fitEmbeddedTimingReference(input.selectedCues, regions, input.durationSec, fitTrace),
      diagnostics: null,
      fitTrace,
    };
  }
  const diagnostics = inspectEmbeddedReference(
    input.selectedCues,
    regions,
    input.selected.lang ?? "",
  ).diagnostics;
  const globalFit = fitEmbeddedReference(
    input.selectedCues,
    regions,
    input.selected.lang ?? "",
    input.durationSec,
    fitTrace,
  );
  const localFit = fitFocusedEmbeddedReference(
    input.selectedCues,
    regions,
    input.selected.lang ?? "",
    input.focusSec,
  );
  // A globally fitted drift can pass held-out checks in two distant samples
  // while predicting essentially no correction in an unmeasured scene.
  // Prefer independently verified local evidence if the two disagree.
  const localDisagrees = Boolean(
    localFit &&
    globalFit &&
    Math.abs(
      globalFit.transform.offsetSec +
        (globalFit.transform.ratio - 1) * input.focusSec -
        localFit.transform.offsetSec,
    ) > 0.75,
  );
  const fit = localFit && (!globalFit || localDisagrees) ? localFit : globalFit;
  if (fit?.localOnly) {
    fitTrace.reason = "verified";
    fitTrace.candidateOffsetSec = fit.transform.offsetSec;
    fitTrace.candidateRatio = 1;
    fitTrace.anchorCount = fit.matchCount;
    fitTrace.regionAnchorCounts = [fit.matchCount];
    fitTrace.heldOutMedianSec = fit.medianErrorSec;
    fitTrace.heldOutP90Sec = fit.p90ErrorSec;
  }
  return {
    checked: true,
    extraction: extraction.status,
    requestedWindows: windows.length,
    windows: excerpts.length,
    rawCueCount: extraction.rawCues,
    dialogueCueCount: extraction.dialogueCues,
    usableWindows: extraction.usableWindows,
    diagnostics,
    fit,
    fitTrace,
  };
}
