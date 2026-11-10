import type { PlayerSnapshot } from "@/lib/player/bridge";
import type { PlayerSrc } from "@/lib/view";
import type { SubCue } from "@/lib/subtitles/parser";
import type {
  MediaMeta,
  PipelineContext,
  PipelineOutcome,
  SourceKind,
} from "@/lib/subtitles/autosync/pipeline";
import { outcomeRank, type SubtitleFormat } from "@/lib/subtitles/autosync/fp-gate";
import type { DriftPlayerState } from "@/lib/subtitles/autosync/drift-monitor";
import { normalizeLang } from "@/lib/subtitles/language";

/** Only a user-triggered remote analysis may fall back to listening to mpv's
 * buffered packets. Automatic background runs must not start a long wait. */
export function shouldFallbackToPlayback(
  outcome: PipelineOutcome,
  sourceKind: SourceKind,
  userInitiated: boolean,
): boolean {
  if (
    !userInitiated ||
    (sourceKind !== "http" && sourceKind !== "hls" && sourceKind !== "debrid") ||
    outcome.decision.decision !== "refuse"
  )
    return false;
  if (outcome.decision.bindingRule === "quality-measurement") {
    return /remote audio verification could not finish|insufficient.data/i.test(
      outcome.decision.reason,
    );
  }
  // The gate already compared the score to its floor. Recheck a fresh scene
  // without carrying the rejected timing into the playback matcher.
  if (outcome.decision.bindingRule === "never-worse") {
    return outcome.decision.reason.endsWith("below absolute floor");
  }
  if (outcome.decision.bindingRule === "promotion") return true;
  // A direct scorer returning null used to reach the generic "no candidate"
  // exit without offering the buffered playback recovery path.
  return (
    outcome.decision.bindingRule === "no-candidate" &&
    /audio verification was unavailable \((?:insufficient-data|audio-unavailable|timeout)\)|Audio was analyzed, but speech did not align reliably/i.test(
      outcome.decision.reason,
    )
  );
}

/** Do not retry unseekable remote audio via the expensive cross-language pivot. */
export function shouldAttemptAudioPivot(outcome: PipelineOutcome): boolean {
  if (outcome.decision.decision === "apply") return false;
  if (
    ["metadata-hard-refuse", "consensus-wrong-content", "already-good"].includes(
      outcome.decision.bindingRule,
    )
  )
    return false;
  if (outcome.decision.bindingRule === "consensus-audio-unverified") return false;
  if (
    outcome.decision.bindingRule === "quality-measurement" &&
    /remote audio verification could not finish/i.test(outcome.decision.reason)
  ) {
    return false;
  }
  return true;
}

/** Explain the failing analysis stage, rather than reporting an earlier cache failure. */
export function liveSyncFailureReason(input: {
  cacheAudioReady: boolean;
  cacheError: unknown;
  directAttempted: boolean;
  directError: unknown;
}): string {
  if (input.directAttempted) {
    const error = String(input.directError ?? "");
    if (/analysis-busy/i.test(error)) {
      return "Another subtitle analysis is still running. Try again in a moment.";
    }
    if (/timeout/i.test(error)) {
      return "Checking this part of the source timed out. Try another source or a downloaded file.";
    }
    if (/no-audio|audio-windows-incomplete|ffmpeg|decode/i.test(error)) {
      return "The source could not provide usable dialogue audio for this scene. Try another source or a downloaded file.";
    }
    return "Audio from this scene did not match the subtitles confidently. Try a dialogue-heavy scene, another subtitle, or Manual offset.";
  }

  const error = String(input.cacheError ?? "");
  if (/not-enough-cues/i.test(error)) {
    return "There aren't enough subtitle lines in this playback excerpt. Seek to a dialogue-heavy scene and try again.";
  }
  if (input.cacheAudioReady) {
    return "Harbor decoded the cached audio, but couldn't confirm a reliable subtitle offset. Try another scene or Manual offset.";
  }
  if (/cache-audio|ffmpeg|timeout/i.test(error)) {
    return "Harbor couldn't extract usable audio from this playback cache. Try another source or a downloaded file.";
  }
  return "Playback audio was unavailable for subtitle syncing. Try another source or Manual offset.";
}

export function isLoopback(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/i.test(url);
}

export function outcomeScore(o: PipelineOutcome): number {
  const c = o.candidate;
  const ratioResolved = c && c.kind === "affine" && Math.abs(c.ratio - 1) > 1e-6 ? 1 : 0;
  return (
    outcomeRank(o.decision.decision) * 100 +
    ratioResolved * 10 +
    Math.round(o.decision.pCorrect * 9)
  );
}

export function subLanguages(trackLang: string | undefined, preferred: string[]): string[] {
  return [trackLang, ...preferred]
    .map((lang) => normalizeLang(lang))
    .filter((lang): lang is string => lang.length > 0)
    .filter((lang, index, all) => all.indexOf(lang) === index);
}

/** MPV's seekable ranges, not demuxer-cache-time, indicate which exact
 * section can be dumped without another source request. */
export function coversBufferedRange(
  value: unknown,
  startSec: number,
  endSec: number,
): boolean | null {
  if (!Array.isArray(value)) return null;
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
  let coveredTo = startSec;
  for (const range of ranges) {
    if (range.end <= coveredTo) continue;
    if (range.start > coveredTo + 0.25) break;
    coveredTo = Math.max(coveredTo, range.end);
    if (coveredTo >= endSec - 0.25) return true;
  }
  return false;
}

/** Pick an actual, contiguous buffered excerpt nearest playback. The original
 * fixed [position, position + 45s] range rarely becomes fully cached because
 * normal playback advances while the demuxer may evict earlier packets. */
export function selectBufferedExcerptStart(
  value: unknown,
  preferredSec: number,
  clipSec: number,
  durationSec: number,
): number | null {
  if (
    !Array.isArray(value) ||
    !Number.isFinite(preferredSec) ||
    !Number.isFinite(clipSec) ||
    clipSec <= 0 ||
    !Number.isFinite(durationSec) ||
    durationSec < clipSec
  ) {
    return null;
  }
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
  let bestStart: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  let start = Number.NaN;
  let end = Number.NaN;
  const consider = () => {
    const low = Math.max(0, start);
    const high = Math.min(durationSec, end);
    if (!(high - low >= clipSec - 0.05)) return;
    const candidate = Math.min(Math.max(preferredSec, low), high - clipSec);
    const score = Math.abs(candidate - preferredSec);
    if (score < distance) {
      bestStart = candidate;
      distance = score;
    }
  };
  for (const range of ranges) {
    if (!Number.isFinite(start)) {
      start = range.start;
      end = range.end;
    } else if (range.start <= end + 0.01) {
      end = Math.max(end, range.end);
    } else {
      consider();
      start = range.start;
      end = range.end;
    }
  }
  consider();
  return bestStart;
}

/** The visible analyzing status must have its own deadline, even if the
 * native-operation timer was cleared by a cancelled preflight. */
export function autoSyncUiWatchdogMs(
  phase: "analyzing" | "listening",
  analysisDeadlineMs: number,
): number {
  if (phase === "listening") return 120_000;
  return Math.min(115_000, Math.max(60_000, analysisDeadlineMs + 10_000));
}

/** A change of selected audio track invalidates all previous timing analysis. */
export function audioSelectionKey(snap: PlayerSnapshot): string {
  const index = snap.audioTracks.findIndex((track) => track.selected);
  return JSON.stringify([index >= 0 ? snap.audioTracks[index].id : null, index]);
}

/** ffmpeg stream specifier for the audio track the viewer is actually hearing. */
export function audioStreamMap(snap: PlayerSnapshot): string | undefined {
  const index = snap.audioTracks.findIndex((track) => track.selected);
  return index >= 0 ? `0:a:${index}` : undefined;
}

export function audioLanguageFromSnapshot(snap: PlayerSnapshot): string | null {
  const selected = snap.audioTracks.find((track) => track.selected) ?? null;
  if (selected) return normalizeLang(selected.lang ?? "") || null;
  const fallback = snap.audioTracks.find((track) => track.default) ?? null;
  const candidates = [fallback, snap.audioTracks.length === 1 ? snap.audioTracks[0] : null];
  for (const track of candidates) {
    const lang = normalizeLang(track?.lang ?? "");
    if (lang) return lang;
  }
  return null;
}

function parseMinutes(v: string | number | undefined): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return v > 0 ? v : undefined;
  const m = /(\d+)/.exec(v);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function buildMeta(src: PlayerSrc): MediaMeta {
  const mins = src.episode?.runtime ?? parseMinutes(src.meta.runtime);
  return {
    imdbId: src.imdbId,
    season: src.episode?.season,
    episode: src.episode?.episode,
    isAnime: src.isAnime === true || src.meta.type === "anime",
    expectedRuntimeSec: mins ? mins * 60 : undefined,
  };
}

export function buildContext(
  src: PlayerSrc,
  snap: PlayerSnapshot,
  sourceKind: SourceKind,
  cues: SubCue[],
  subtitle: {
    language?: string | null;
    preferredLanguages: string[];
    format: SubtitleFormat;
  },
): PipelineContext {
  const subtitleLanguage = normalizeLang(subtitle.language ?? "") || null;
  const preferredSubtitleLanguages = subLanguages(undefined, subtitle.preferredLanguages);
  return {
    mediaUrl: src.url,
    headers: src.headers,
    infoHash: src.streamRef?.infoHash ?? null,
    sourceKind,
    durationSec: snap.durationSec,
    cues: cues.map((c) => [c.start, c.end] as [number, number]),
    cueText: cues.map((c) => c.text),
    moviebytesize: src.streamRef?.size ?? undefined,
    audioLanguage: audioLanguageFromSnapshot(snap),
    audioMap: audioStreamMap(snap),
    subtitleLanguage,
    preferredSubtitleLanguages,
    subtitleFormat: subtitle.format,
    languages: subLanguages(subtitleLanguage ?? undefined, preferredSubtitleLanguages),
    meta: buildMeta(src),
  };
}

export function toDriftState(
  snap: PlayerSnapshot,
  cues: SubCue[],
  trackKey: string,
): DriftPlayerState {
  return {
    positionSec: snap.positionSec,
    durationSec: snap.durationSec,
    subDelaySec: snap.subDelaySec,
    playing: snap.status === "playing",
    buffering: snap.buffering,
    rate: snap.rate,
    cues,
    trackKey,
  };
}
