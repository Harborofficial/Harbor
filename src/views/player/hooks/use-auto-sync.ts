import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PlayerBridge, PlayerSnapshot, TrackInfo } from "@/lib/player/bridge";
import type { PlayerSrc } from "@/lib/view";
import type { Settings } from "@/lib/settings";
import { dwarn } from "@/lib/debug";
import {
  readPlayerPrefs,
  registerPlayerSubDelayMapper,
  registerPlayerSubDelayTrackKindResolver,
} from "@/lib/player-prefs";
import { initialDelayForSelectedTrack } from "@/lib/player/subtitle-delay-scope";
import { fetchAndParse, parseSubtitle, type SubCue } from "@/lib/subtitles/parser";
import { decodeSubtitleBytes } from "@/lib/subtitles/encoding";
import { readNonNetworkSubtitleBytes } from "@/lib/subtitles/save-to-disk";
import { SUBTITLE_PREPARATION_LIMITS } from "@/lib/subtitles/prepare";
import { toSrt, toVtt } from "@/lib/subtitles/serialize";
import {
  runAutoSync,
  type PipelineContext,
  type PipelineOutcome,
} from "@/lib/subtitles/autosync/pipeline";
import { buildTierPorts, defaultOsConfig } from "@/lib/subtitles/autosync/context";
import {
  preferAutoSyncOutcome,
  runExperimentalPivotAutoSync,
} from "@/lib/subtitles/autosync/pivot-runtime";
import {
  crowdConfigFromSettings,
  reportCrowdFeedback,
  reportVerifiedSync,
} from "@/lib/subtitles/autosync/crowd-db";
import {
  classifyTorrentSource,
  scheduleProgressiveTorrentSync,
  sourceKindFor,
  type ProgressiveHandle,
} from "@/lib/subtitles/autosync/torrent-sync";
import { resolveSwapCues, type OsConfig } from "@/lib/subtitles/autosync/opensubtitles";
import {
  isDelayOnlyTransform,
  type SubtitleFormat,
  type SyncTransform,
} from "@/lib/subtitles/autosync/fp-gate";
import { transformCues } from "@/lib/subtitles/autosync/html5-sync";
import {
  DriftMonitor,
  makeTauriDriftPorts,
  type DriftDeps,
} from "@/lib/subtitles/autosync/drift-monitor";
import { resetMpvSubtitleFpsForTransition } from "@/lib/player/mpv-properties";
import {
  buildSubtitleTimingMediaKey,
  isAutoSyncScopeCurrent,
  runAfterSubtitleFpsReset,
} from "@/lib/player/subtitle-fps";
import { isAssTrack } from "@/lib/player/sub-format";
import { automaticAutoSyncMayStart } from "@/lib/subtitles/autosync/preflight-gate";
import {
  cancelNativeAnalysis,
  newAnalysisSessionId,
} from "@/lib/subtitles/autosync/analysis-session";
import { readEmbeddedReference } from "@/lib/subtitles/autosync/embedded-reference-runtime";
import {
  isOwnGeneratedSyncTrack,
  autoSyncExitBaseline,
} from "@/lib/subtitles/autosync/active-scope";
import {
  boundedNativeProbe,
  shouldReadIndependentSceneAudio,
} from "@/lib/subtitles/autosync/current-scene";
import { getPlaybackPosition } from "@/lib/player/playback-clock";
import { rankDialogueScenes, SCENE_CLIP_SEC } from "@/lib/subtitles/autosync/scene-window";
import { matchPlaybackSpeech } from "@/lib/subtitles/autosync/playback-asr";
import {
  hasSavedAutoSyncCorrection,
  readSavedAutoSyncCorrection,
  shouldRestoreAutoSyncCorrection,
  saveAutoSyncCorrection,
  clearSavedAutoSyncCorrection,
} from "@/lib/subtitles/autosync/persistence";
import {
  audioStreamMap,
  audioSelectionKey,
  autoSyncUiWatchdogMs,
  buildContext,
  isLoopback,
  liveSyncFailureReason,
  outcomeScore,
  shouldFallbackToPlayback,
  shouldAttemptAudioPivot,
  toDriftState,
} from "./use-auto-sync.helpers";

export type AutoSyncStatus =
  | "idle"
  | "analyzing"
  | "listening"
  | "synced"
  | "matched-embedded"
  | "best-effort"
  | "offer"
  | "declined"
  | "error";

export type AutoSyncHandle = {
  status: AutoSyncStatus;
  offer: PipelineOutcome | null;
  /** Why the last attempt was refused; shown so a failure isn't a mystery. */
  reason: string | null;
  /** Analyze a verified, buffered playback excerpt and offer a delay-only correction. */
  listen: () => void;
  applyOffer: () => void;
  revert: () => void;
  retry: () => void;
  run: () => void;
  stop: () => void;
  prepareLiveSync: () => void;
  feedback: (good: boolean) => void;
};

type SubFmt = SubtitleFormat;
type WritableSubFmt = Extract<SubFmt, "srt" | "vtt">;
type AutoSyncScope = { mediaKey: string; trackId: string; audioKey: string };
type AppliedState = {
  transform: SyncTransform | null;
  originalTrackId: string | null;
  subDelayBefore: number;
  scope: AutoSyncScope | null;
  changed: boolean;
  savedCorrectionId?: string | null;
  /** Only this exact generated track may inherit a rewritten correction. */
  generatedTrackPath?: string | null;
};
type AutoSyncFlags = { autoSyncDrift?: boolean };

const MIN_DURATION_SEC = 60;
const MIN_CUES = 4;
const OFFSET_EPS = 0.25;
const DRIFT_TICK_MS = 4000;
const ANALYSIS_DEADLINE_MS = 90_000;
const EMBEDDED_REFERENCE_DEADLINE_MS = 25_000;
// A remote source that cannot be independently decoded should not keep
// its "Checking sources and audio" spinner up for the full torrent budget.
const REMOTE_ANALYSIS_DEADLINE_MS = 55_000;

function isSyncedTrack(t: { title?: string } | null | undefined): boolean {
  return /^Synced \((?:SRT|VTT)\)/.test(t?.title ?? "");
}

function autoSyncMediaKey(src: PlayerSrc): string {
  return buildSubtitleTimingMediaKey({
    sourceUrl: src.url,
    mediaId: src.meta.id,
    season: src.episode?.season,
    episode: src.episode?.episode,
  });
}

function autoSyncRunKey(mediaKey: string, trackId: string, audioKey: string): string {
  return JSON.stringify([mediaKey, trackId, audioKey]);
}

/** Persist only against an actual episode and physical release, not just a show. */
function persistenceMediaKey(src: PlayerSrc): string {
  const ref = src.streamRef;
  const source = ref?.infoHash
    ? ["torrent", ref.infoHash.toLowerCase(), ref.fileIdx ?? 0]
    : src.homeServer
      ? ["server", src.homeServer.connectionId, src.homeServer.itemId, src.homeServer.versionId]
      : ref?.resolvedFilename && (ref.addonId || ref.size)
        ? // The same release filename may occur on unrelated streams. Include
          // the selected endpoint to avoid restoring across different sources.
          ["release", ref.addonId ?? null, ref.resolvedFilename, ref.size ?? null, src.url]
        : ["url", src.url];
  return JSON.stringify([
    src.meta.id,
    src.episode?.season ?? null,
    src.episode?.episode ?? null,
    source,
  ]);
}

/** mpv subtitle/audio track IDs can change after reopening a player. */
function persistenceAudioKey(snap: PlayerSnapshot): string | null {
  const index = snap.audioTracks.findIndex((track) => track.selected);
  if (index < 0) return null;
  const track = snap.audioTracks[index];
  return JSON.stringify([index, track.lang ?? null, track.codec ?? null, track.title ?? null]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readBufferedRanges(): Promise<unknown[] | null> {
  try {
    const ranges = await invoke<unknown>("mpv_get_seekable_ranges");
    return Array.isArray(ranges) ? ranges : null;
  } catch {
    return null;
  }
}

function refusalReason(o: PipelineOutcome): string {
  if (
    o.decision.bindingRule === "never-worse" &&
    o.decision.reason.endsWith("below absolute floor")
  )
    return "After the proposed adjustment, the subtitle lines still did not line up reliably with speech. No timing change was applied.";
  if (o.decision.bindingRule === "promotion")
    return "Harbor found a possible timing change, but the evidence was too weak to suggest it. Try Sync from playback during a scene with clear dialogue.";
  if (o.decision.bindingRule === "quality-measurement") {
    if (/insufficient data/i.test(o.decision.reason)) {
      return "Harbor couldn't read the audio needed to check the sync. If this is a torrent, let more of the video download; otherwise try a different source.";
    }
    if (/timeout|audio-unavailable|ffmpeg-unavailable/i.test(o.decision.reason)) {
      return "Harbor couldn't finish verifying the subtitle timing through a separate audio read. Playback can still be fine. Try Sync from playback to analyze buffered audio, or use Manual offset.";
    }
  }
  return o.decision.reason;
}

export function useAutoSync(params: {
  bridgeRef: RefObject<PlayerBridge | null>;
  src: PlayerSrc;
  snap: PlayerSnapshot;
  engine: "html5" | "mpv";
  settings: Settings;
  authKey: string | null;
  subtitlePreflightSettled: boolean;
}): AutoSyncHandle & { suspendForManualTiming: () => void } {
  const { bridgeRef, src, snap, engine, settings, authKey, subtitlePreflightSettled } = params;
  const [status, setStatus] = useState<AutoSyncStatus>("idle");
  const [offer, setOffer] = useState<PipelineOutcome | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [analysisRevision, setAnalysisRevision] = useState(0);
  const statusRef = useRef(status);
  statusRef.current = status;
  const activeAnalysisDeadlineRef = useRef(ANALYSIS_DEADLINE_MS);

  const doneKeyRef = useRef<string | null>(null);
  const firedRef = useRef<{ mediaKey: string; trackAudioKeys: Set<string> }>({
    mediaKey: "",
    trackAudioKeys: new Set(),
  });
  const appliedRef = useRef<AppliedState>({
    transform: null,
    originalTrackId: null,
    subDelayBefore: 0,
    scope: null,
    changed: false,
  });
  const driftRef = useRef<DriftMonitor | null>(null);
  const driftTimerRef = useRef<number | null>(null);
  const progressiveRef = useRef<ProgressiveHandle | null>(null);
  const bestScoreRef = useRef(-1);
  const retryRef = useRef<(() => void) | null>(null);
  const activeDisposeRef = useRef<(() => void) | null>(null);
  const liveTapCancelRef = useRef<(() => void) | null>(null);
  // The Auto sync pipeline is declared before the guided playback callback.
  // This lets only a user-initiated, unseekable remote run hand off safely.
  const playbackFallbackRef = useRef<((preferBufferedAudio: boolean) => void) | null>(null);
  const lastReportRef = useRef<{
    ctx: PipelineContext;
    transform: SyncTransform;
    confidence: number;
  } | null>(null);
  const statusScopeRef = useRef<AutoSyncScope | null>(null);
  const manualTimingMediaRef = useRef<string | null>(null);
  const localReferenceFocusRef = useRef<{ scope: AutoSyncScope; positionSec: number } | null>(null);
  const liveSnapRef = useRef(snap);
  const srcRef = useRef(src);
  const settingsRef = useRef(settings);
  liveSnapRef.current = snap;
  srcRef.current = src;
  settingsRef.current = settings;

  const flagsRef = useRef<AutoSyncFlags>({});
  flagsRef.current = settings as AutoSyncFlags;

  const selected = snap.subtitleTracks.find((t) => t.selected) ?? null;
  const selectedSynced = isSyncedTrack(selected);
  const mediaKey = autoSyncMediaKey(src);
  const ready =
    engine === "mpv" &&
    settings.subtitleAutoSync === true &&
    snap.durationSec >= MIN_DURATION_SEC &&
    selected?.external === true &&
    !selectedSynced &&
    automaticAutoSyncMayStart({
      preflightSettled: subtitlePreflightSettled,
      tracks: snap.subtitleTracks,
      selectedLanguage: selected.lang,
    });
  const stopDrift = useCallback(() => {
    if (driftTimerRef.current !== null) {
      window.clearInterval(driftTimerRef.current);
      driftTimerRef.current = null;
    }
    driftRef.current?.dispose();
    driftRef.current = null;
  }, []);

  const deadlineRef = useRef<number | null>(null);
  const clearDeadline = useCallback(() => {
    if (deadlineRef.current !== null) {
      window.clearTimeout(deadlineRef.current);
      deadlineRef.current = null;
    }
  }, []);

  // A new playback is a new session: never keep an "analyzing" status from the last one.
  useEffect(() => {
    const previous = appliedRef.current;
    if (previous.changed) {
      // A retained mpv instance keeps its last sub-delay across loadfile.
      // Never let the previous source's Auto sync shift reach the next video.
      // Reset the old correction before the new media/track is selected.
      // Its explicit external-subtitle baseline is restored after selection.
      bridgeRef.current?.setSubDelay(0);
    }
    clearDeadline();
    liveTapCancelRef.current?.();
    activeDisposeRef.current?.();
    progressiveRef.current?.stop();
    progressiveRef.current = null;
    stopDrift();
    bestScoreRef.current = -1;
    appliedRef.current = {
      transform: null,
      originalTrackId: null,
      subDelayBefore: 0,
      scope: null,
      changed: false,
      savedCorrectionId: null,
    };
    statusScopeRef.current = null;
    doneKeyRef.current = null;
    manualTimingMediaRef.current = null;
    firedRef.current = { mediaKey: "", trackAudioKeys: new Set() };
    setOffer(null);
    setReason(null);
    setStatus("idle");
  }, [
    mediaKey,
    src.playbackTraceId,
    src.attempt,
    clearDeadline,
    bridgeRef,
    src.meta.id,
    stopDrift,
  ]);

  const runWithSubtitleFpsReset = useCallback(
    (
      action: () => void | Promise<void>,
      cancelled?: { current: boolean },
      isCurrent: () => boolean = () => true,
    ) =>
      runAfterSubtitleFpsReset(
        () => resetMpvSubtitleFpsForTransition(),
        action,
        (error) => {
          dwarn("[auto-sync] subtitle FPS reset failed", error);
          if (!cancelled?.current) {
            clearDeadline();
            setReason(error instanceof Error ? error.message : String(error));
            setStatus("error");
          }
        },
        () => cancelled?.current !== true && isCurrent(),
      ),
    [clearDeadline],
  );

  const isCurrentAutoSyncScope = useCallback((scope: AutoSyncScope | null) => {
    if (manualTimingMediaRef.current === autoSyncMediaKey(srcRef.current)) return false;
    if (scope == null || statusScopeRef.current !== scope) return false;
    const currentSelected =
      liveSnapRef.current.subtitleTracks.find((track) => track.selected) ?? null;
    return isAutoSyncScopeCurrent(scope, {
      mediaKey: autoSyncMediaKey(srcRef.current),
      trackId: currentSelected?.id ?? null,
      syncedTrack: isOwnGeneratedSyncTrack(currentSelected, appliedRef.current.generatedTrackPath),
      audioKey: audioSelectionKey(liveSnapRef.current),
    });
  }, []);

  // UI safety watchdog, independent of the analysis promise's clearDeadline.
  // A transient preflight eligibility change can dispose the native run and
  // clear its timer. The UI must *still* stop showing "Checking sources and
  // audio", even if no more results arrive from that cancelled run.
  useEffect(() => {
    if (status !== "analyzing" && status !== "listening") return;
    const phase = status;
    const limitMs = autoSyncUiWatchdogMs(phase, activeAnalysisDeadlineRef.current);
    const watchdog = window.setTimeout(() => {
      if (statusScopeRef.current == null) {
        setStatus("idle");
        return;
      }
      if (!isCurrentAutoSyncScope(statusScopeRef.current)) {
        setStatus("idle");
        return;
      }
      activeDisposeRef.current?.();
      liveTapCancelRef.current?.();
      clearDeadline();
      progressiveRef.current?.stop();
      progressiveRef.current = null;
      const code = phase === "analyzing" ? "analysis-watchdog" : "playback-watchdog";
      void invoke("mpv_command", {
        cmd: ["print-text", `[harbor/autosync] failure=${code}`],
      }).catch(() => {});
      setReason(
        phase === "analyzing"
          ? "Subtitle analysis stopped responding. The audio check has been cancelled; try Sync from playback or Manual offset."
          : "Buffered playback audio wasn't available in time. Try a dialogue-heavy scene or Manual offset.",
      );
      setStatus("error");
    }, limitMs);
    return () => window.clearTimeout(watchdog);
  }, [status, analysisRevision, mediaKey, clearDeadline, isCurrentAutoSyncScope]);

  useEffect(
    () =>
      registerPlayerSubDelayTrackKindResolver((metaId) => {
        if (srcRef.current.meta.id !== metaId) return null;
        const selected = liveSnapRef.current.subtitleTracks.find((track) => track.selected);
        return selected ? (selected.external ? "external" : "embedded") : null;
      }),
    [],
  );

  useEffect(
    () =>
      registerPlayerSubDelayMapper((metaId, value) => {
        if (srcRef.current.meta.id !== metaId) return value;
        const applied = appliedRef.current;
        const selectedTrack = liveSnapRef.current.subtitleTracks.find((t) => t.selected) ?? null;
        if (
          !applied.changed ||
          !applied.transform ||
          !isAutoSyncScopeCurrent(applied.scope, {
            mediaKey: autoSyncMediaKey(srcRef.current),
            trackId: selectedTrack?.id ?? null,
            audioKey: audioSelectionKey(liveSnapRef.current),
            syncedTrack: isOwnGeneratedSyncTrack(selectedTrack, applied.generatedTrackPath),
          })
        ) {
          return value;
        }
        const baseline = isDelayOnlyTransform(applied.transform)
          ? value - applied.transform.offsetSec
          : value;
        applied.subDelayBefore = baseline;
        return baseline;
      }),
    [isCurrentAutoSyncScope],
  );

  const persistAppliedCorrection = useCallback(
    (cues: SubCue[], transform: SyncTransform, bindingRule: string) => {
      const applied = appliedRef.current;
      if (!applied.changed || !isCurrentAutoSyncScope(applied.scope)) return;
      const audioKey = persistenceAudioKey(liveSnapRef.current);
      if (!audioKey) return;
      const scene = bindingRule === "live-tap" || bindingRule === "embedded-text-reference-local";
      const focus = localReferenceFocusRef.current;
      const focusSec = scene
        ? focus?.scope === applied.scope
          ? focus.positionSec
          : liveSnapRef.current.positionSec
        : null;
      const verified = ![
        "live-tap",
        "embedded-text-reference-local",
        "embedded-text-reference",
        "consensus-audio-unverified",
        "cross-language-speech-timing",
      ].includes(bindingRule);
      const id = saveAutoSyncCorrection({
        mediaKey: persistenceMediaKey(srcRef.current),
        audioKey,
        cues,
        transform,
        scope: scene ? "scene" : "episode",
        focusSec,
        verified,
        embeddedReference:
          bindingRule === "embedded-text-reference" ||
          bindingRule === "embedded-text-reference-local",
      });
      if (id) applied.savedCorrectionId = id;
    },
    [isCurrentAutoSyncScope],
  );

  const applyTransform = useCallback(
    async (
      b: PlayerBridge,
      cues: SubCue[],
      fmt: SubFmt,
      t: SyncTransform,
      isCurrent: () => boolean,
    ): Promise<boolean> => {
      if (!isCurrent()) return false;
      const a = appliedRef.current;
      if (t.kind === "affine" && isDelayOnlyTransform(t)) {
        if (Math.abs(t.offsetSec) < OFFSET_EPS && !a.transform) return true;
        if (!isCurrent()) return false;
        // The original track is already selected. Re-selecting it here can
        // race an actual user subtitle change and leak the delay to that track.
        // Compose automatic timing with the delay the viewer already set.
        b.setSubDelay(a.subDelayBefore + t.offsetSec);
        a.changed = true;
        if (!isCurrent()) return false;
        a.transform = t;
        return true;
      }
      if (fmt === "ass" || fmt === "ssa") {
        dwarn(`[auto-sync] ${fmt.toUpperCase()} structural rewrite blocked to preserve formatting`);
        return false;
      }
      if (fmt === "unknown") {
        dwarn("[auto-sync] structural rewrite blocked because subtitle format is unknown");
        return false;
      }
      const finalCues = transformCues(cues, t);
      if (finalCues.length === 0 || !isCurrent()) return false;
      const text = fmt === "vtt" ? toVtt(finalCues) : toSrt(finalCues);
      if (
        !(await writeSyncedTrack(b, text, fmt, isCurrent, a.subDelayBefore, (path) => {
          a.generatedTrackPath = path;
        }))
      ) {
        a.generatedTrackPath = null;
        return false;
      }
      if (!isCurrent()) return false;
      a.changed = true;
      a.transform = t;
      return true;
    },
    [],
  );

  const startDrift = useCallback(
    (b: PlayerBridge, cues: SubCue[]) => {
      if (flagsRef.current.autoSyncDrift !== true || driftRef.current) return;
      const active = srcRef.current;
      const trackKey = doneKeyRef.current ?? active.url;
      const ports = makeTauriDriftPorts(active.url, active.headers, {
        mapSpec: audioStreamMap(liveSnapRef.current),
      });
      const deps: DriftDeps = {
        getState: () => toDriftState(liveSnapRef.current, cues, trackKey),
        setSubDelay: (s) => {
          const a = appliedRef.current;
          if (!isCurrentAutoSyncScope(a.scope)) return;
          b.setSubDelay(s);
          a.changed = true;
        },
      };
      const mon = new DriftMonitor(ports, deps);
      driftRef.current = mon;
      driftTimerRef.current = window.setInterval(() => mon.observe(), DRIFT_TICK_MS);
    },
    [isCurrentAutoSyncScope],
  );

  const handleOutcome = useCallback(
    (
      o: PipelineOutcome,
      cues: SubCue[],
      fmt: SubFmt,
      cancelled: { current: boolean },
      scope: AutoSyncScope,
    ) => {
      const isCurrent = () => isCurrentAutoSyncScope(scope);
      if (cancelled.current || !isCurrent()) return;
      clearDeadline();
      const dec = o.decision.decision;
      // Fixed outcome codes, no media URL, subtitle text, or FFmpeg stderr.
      // Important for cases where the entire analysis finishes but no offset
      // is applied and the user reports that the pill disappeared.
      void invoke("mpv_command", {
        cmd: [
          "print-text",
          `[harbor/autosync] result=${dec} gate=${o.decision.bindingRule} candidate=${o.candidate ? o.candidate.kind : "none"}`,
        ],
      }).catch(() => {});
      dwarn(
        `[auto-sync] decision=${dec} reason="${o.decision.reason}" tiers=[${o.tiersRun.join(",")}] bestEffort=${o.bestEffort ?? false}`,
      );
      if (dec === "refuse") {
        if (appliedRef.current.transform) return;
        // "Already aligned" is a successful outcome, not a failure to line up.
        if (o.decision.bindingRule === "already-good") {
          setReason(null);
          setStatus("synced");
          return;
        }
        setReason(refusalReason(o));
        setStatus("declined");
        return;
      }
      if (dec === "offer") {
        setReason(
          o.decision.bindingRule === "cross-language-speech-timing" ? o.decision.reason : null,
        );
        setOffer(o);
        if (!appliedRef.current.transform) setStatus("offer");
        return;
      }
      const score = outcomeScore(o);
      if (!o.bestEffort && score <= bestScoreRef.current) return;
      const t = o.candidate;
      const b = bridgeRef.current;
      if (!t || !b) return;
      const automaticSwap = o.subSwap;
      if (automaticSwap) {
        const os = defaultOsConfig(settingsRef.current) ?? {
          apiKey: "",
          userAgent: "Harbor autosync",
        };
        void runWithSubtitleFpsReset(
          async () => {
            if (!isCurrent()) return;
            bestScoreRef.current = score;
            setOffer(null);
            const applied = await applySwap(b, automaticSwap, os, isCurrent);
            if (!isCurrent()) return;
            if (applied) appliedRef.current.changed = true;
            else setReason("The matched subtitle could not be loaded.");
            setStatus(applied ? "synced" : "error");
          },
          cancelled,
          isCurrent,
        ).catch((error) => {
          dwarn("[auto-sync] automatic swap failed", error);
          if (!cancelled.current && isCurrent()) {
            setReason(error instanceof Error ? error.message : String(error));
            setStatus("error");
          }
        });
        return;
      }
      void runWithSubtitleFpsReset(
        async () => {
          if (!isCurrent()) return;
          if (!o.bestEffort && score <= bestScoreRef.current) return;
          bestScoreRef.current = score;
          setOffer(null);
          const applied = await applyTransform(b, cues, fmt, t, isCurrent);
          if (!isCurrent()) return;
          if (!applied) {
            setReason("This subtitle cannot be rewritten safely.");
            setStatus("error");
            return;
          }
          persistAppliedCorrection(cues, t, o.decision.bindingRule);
          const embedded = o.decision.bindingRule === "embedded-text-reference";
          setReason(
            embedded
              ? "Timing matches the embedded subtitle. Spoken audio has not been verified."
              : null,
          );
          setStatus(embedded ? "matched-embedded" : o.bestEffort ? "best-effort" : "synced");
          // A verified in-media text reference is already tied to this file.
          // Running an audio drift observer would reintroduce the unreliable
          // decoder path and could undo an otherwise validated adjustment.
          if (o.decision.bindingRule !== "embedded-text-reference") startDrift(b, cues);
        },
        cancelled,
        isCurrent,
      ).catch((error) => {
        dwarn("[auto-sync] apply failed", error);
        if (!cancelled.current && isCurrent()) {
          setReason(error instanceof Error ? error.message : String(error));
          setStatus("error");
        }
      });
    },
    [
      applyTransform,
      persistAppliedCorrection,
      startDrift,
      bridgeRef,
      clearDeadline,
      isCurrentAutoSyncScope,
      runWithSubtitleFpsReset,
    ],
  );

  const beginRun = useCallback(
    (force: boolean): (() => void) | null => {
      const active = srcRef.current;
      const activeSnap = liveSnapRef.current;
      const activeSelected = activeSnap.subtitleTracks.find((t) => t.selected) ?? null;
      if (engine !== "mpv" || activeSnap.durationSec < MIN_DURATION_SEC) return null;
      if (!activeSelected || activeSelected.external !== true || isSyncedTrack(activeSelected))
        return null;

      const activeMediaKey = autoSyncMediaKey(active);
      if (manualTimingMediaRef.current === activeMediaKey) {
        if (!force) return null;
        manualTimingMediaRef.current = null;
      }
      const activeAudioKey = audioSelectionKey(activeSnap);
      const key = autoSyncRunKey(activeMediaKey, activeSelected.id, activeAudioKey);
      if (!force && doneKeyRef.current === key) return null;

      const cls = classifyTorrentSource(active.url, {
        infoHash: active.streamRef?.infoHash ?? null,
        fileIdx: active.streamRef?.fileIdx ?? null,
      });
      const isTorrent = cls === "torrent";
      if (!isTorrent && isLoopback(active.url)) return null;
      const sourceKind = sourceKindFor(cls, active.url);
      const fileIdx = active.streamRef?.fileIdx ?? 0;

      // Switching from the guided playback tap must stop its pending native
      // analysis before the full pipeline starts, or both may race to apply.
      liveTapCancelRef.current?.();
      activeDisposeRef.current?.();

      // Re-running on a subtitle already shifted by Auto sync must start
      // from its manual baseline, not silently stack a second correction.
      if (appliedRef.current.changed && appliedRef.current.scope?.mediaKey === activeMediaKey) {
        bridgeRef.current?.setSubDelay(appliedRef.current.subDelayBefore);
      }
      doneKeyRef.current = key;
      const statusScope = {
        mediaKey: activeMediaKey,
        trackId: activeSelected.id,
        audioKey: activeAudioKey,
      };
      statusScopeRef.current = statusScope;
      appliedRef.current = {
        transform: null,
        originalTrackId: activeSelected.id,
        subDelayBefore: initialDelayForSelectedTrack(
          activeSelected,
          readPlayerPrefs(active.meta.id)?.subDelaySec,
          readPlayerPrefs(active.meta.id)?.subDelayTrackKind,
        ),
        scope: statusScope,
        changed: false,
      };
      bestScoreRef.current = -1;
      setOffer(null);
      setReason(null);
      localReferenceFocusRef.current = null;
      activeAnalysisDeadlineRef.current =
        sourceKind === "http" || sourceKind === "hls" || sourceKind === "debrid"
          ? REMOTE_ANALYSIS_DEADLINE_MS
          : ANALYSIS_DEADLINE_MS;
      setAnalysisRevision((revision) => revision + 1);
      setStatus("analyzing");

      const cancelled = { current: false };
      const nativeSessionId = newAnalysisSessionId();
      const runLabel = nativeSessionId.slice(-10);
      let embeddedReferenceFailure:
        | "repeated-seek"
        | "text-mismatch"
        | "incomplete"
        | "timing-inconsistent"
        | "transform-out-of-bounds"
        | "extraction-empty"
        | "extraction-sparse"
        | "extraction-error"
        | null = null;
      const armDeadline = (phase: "prepare" | "embedded" | "audio") => {
        clearDeadline();
        const budget = activeAnalysisDeadlineRef.current;
        const timeoutMs =
          phase === "embedded" ? Math.min(EMBEDDED_REFERENCE_DEADLINE_MS, budget / 2) : budget;
        deadlineRef.current = window.setTimeout(() => {
          if (cancelled.current || !isCurrentAutoSyncScope(statusScope)) return;
          deadlineRef.current = null;
          cancelled.current = true;
          cancelNativeAnalysis(nativeSessionId);
          void invoke("mpv_command", {
            cmd: [
              "print-text",
              `[harbor/autosync] failure=analysis-deadline phase=${phase} run=${runLabel}`,
            ],
          }).catch(() => {});
          progressiveRef.current?.stop();
          progressiveRef.current = null;
          if (phase === "embedded" && playbackFallbackRef.current) {
            playbackFallbackRef.current(true);
            return;
          }
          const reference =
            embeddedReferenceFailure === "extraction-empty"
              ? "The embedded subtitle extractor returned no usable excerpts. "
              : embeddedReferenceFailure === "extraction-sparse"
                ? "The embedded subtitle extractor returned too little dialogue to compare. "
                : embeddedReferenceFailure === "extraction-error"
                  ? "Reading the embedded subtitle failed. "
                  : embeddedReferenceFailure === "repeated-seek"
                    ? "The embedded subtitle extractor repeated its seek results. "
                    : embeddedReferenceFailure === "text-mismatch"
                      ? "The embedded subtitle did not share matching dialogue with this subtitle. "
                      : embeddedReferenceFailure === "incomplete"
                        ? "The embedded reference had too few independent matching lines. "
                        : embeddedReferenceFailure === "timing-inconsistent"
                          ? "The matching dialogue has inconsistent timestamps across the sampled scenes. "
                          : embeddedReferenceFailure === "transform-out-of-bounds"
                            ? "The matching subtitle timing requires a correction outside the safe bounds. "
                            : "";
          setReason(
            phase === "prepare"
              ? "Reading the selected subtitle took too long."
              : phase === "embedded"
                ? "Reading embedded subtitles took too long. This source may not support reliable subtitle seeking."
                : reference +
                  "Harbor couldn't finish verifying the separate audio. No correction was applied.",
          );
          setStatus("error");
        }, timeoutMs);
      };
      armDeadline("prepare");

      void runWithSubtitleFpsReset(
        async () => {
          const b = bridgeRef.current;
          if (!b) {
            clearDeadline();
            if (force) {
              setReason("The player is not ready.");
              setStatus("error");
            }
            return;
          }
          try {
            const cues = await loadCues(b);
            if (cancelled.current) return;
            if (!cues || cues.length < MIN_CUES) {
              clearDeadline();
              setReason(
                cues
                  ? "This subtitle has too few cues to sync."
                  : "The selected subtitle could not be read.",
              );
              setStatus(force ? "error" : "idle");
              return;
            }
            const fmt = formatOf(b, activeSelected);
            // Compare the downloaded external subtitle with a text subtitle
            // physically embedded in this exact video, before audio heuristics.
            // The reader never changes mpv's selected subtitle.
            if (!isTorrent) {
              try {
                armDeadline("embedded");
                setAnalysisRevision((revision) => revision + 1);
                const reference = await readEmbeddedReference({
                  source: active.url,
                  headers: active.headers,
                  tracks: activeSnap.subtitleTracks,
                  selected: activeSelected,
                  selectedCues: cues,
                  durationSec: activeSnap.durationSec,
                  focusSec: getPlaybackPosition(),
                  sessionId: nativeSessionId,
                });
                if (cancelled.current || !isCurrentAutoSyncScope(statusScope)) return;
                const fit = reference.fit;
                if (reference.extraction !== "not-applicable") {
                  const diagnostic = reference.diagnostics;
                  const overlap = diagnostic?.textMatches.reduce((a, b) => a + b, 0) ?? 0;
                  const reject = reference.fitTrace?.reason;
                  // An empty or unusable extraction has not compared any
                  // dialogue. Never mislabel that as a text mismatch.
                  embeddedReferenceFailure = !reference.checked
                    ? reference.extraction === "no-excerpts"
                      ? "extraction-empty"
                      : "extraction-sparse"
                    : fit
                      ? null
                      : diagnostic?.repeatedWindows
                        ? "repeated-seek"
                        : overlap === 0
                          ? "text-mismatch"
                          : reject === "heldout-inconsistent" ||
                              reject === "region-inconsistent" ||
                              reject === "model-unavailable"
                            ? "timing-inconsistent"
                            : reject === "transform-out-of-bounds"
                              ? "transform-out-of-bounds"
                              : "incomplete";
                  const values = (xs: Array<number | null> | undefined) =>
                    xs?.map((x) => (x === null ? "na" : x.toFixed(2))).join(",") ?? "na";
                  const trace = reference.fitTrace;
                  void invoke("mpv_command", {
                    cmd: [
                      "print-text",
                      `[harbor/autosync] embedded-ref=${fit ? "verified" : "unverified"} extraction=${reference.extraction} requested-windows=${reference.requestedWindows} windows=${reference.windows} raw-cues=${reference.rawCueCount} dialogue-cues=${reference.dialogueCueCount} usable-windows=${reference.usableWindows} matches=${fit?.matchCount ?? 0} regions=${fit?.regionCount ?? 0} local-only=${fit?.localOnly === true} cues=${diagnostic?.cueCounts.join(",") ?? "none"} usable-dialogue=${diagnostic?.usableDialogueCounts.join(",") ?? "none"} text-overlap=${diagnostic?.textMatches.join(",") ?? "none"} grouped-matches=${diagnostic?.groupedMatches.join(",") ?? "none"} plausible=${diagnostic?.plausibleMatches.join(",") ?? "none"} repeated-seeks=${diagnostic?.repeatedWindows ?? 0} unique-anchors=${trace?.anchorCount ?? 0} region-anchors=${trace?.regionAnchorCounts.join(",") ?? "none"} rejection=${trace?.reason ?? "unknown"} median-deltas=${values(diagnostic?.windowMedianOffsets)} delta-mad=${values(diagnostic?.windowOffsetMad)} heldout-med=${trace?.heldOutMedianSec?.toFixed(2) ?? "na"} heldout-p90=${trace?.heldOutP90Sec?.toFixed(2) ?? "na"} offset=${fit?.transform.offsetSec.toFixed(3) ?? trace?.candidateOffsetSec?.toFixed(3) ?? "na"} ratio=${fit?.transform.ratio.toFixed(6) ?? trace?.candidateRatio?.toFixed(6) ?? "na"} max-shift=${fit?.maximumChangeSec.toFixed(3) ?? "na"} playhead-shift=${fit ? (fit.transform.offsetSec + (fit.transform.ratio - 1) * activeSnap.positionSec).toFixed(3) : "na"} run=${runLabel}`,
                    ],
                  }).catch(() => {});
                }
                if (fit && (fit.transform.ratio === 1 || fmt === "srt" || fmt === "vtt")) {
                  if (fit.localOnly)
                    localReferenceFocusRef.current = {
                      scope: statusScope,
                      positionSec: getPlaybackPosition(),
                    };
                  const outcome: PipelineOutcome = {
                    decision: {
                      decision: fit.alreadyAligned
                        ? "refuse"
                        : fit.strongOffset && !fit.localOnly
                          ? "apply"
                          : "offer",
                      reason: fit.alreadyAligned
                        ? "The downloaded subtitle already matches the embedded subtitle near this scene. Spoken-audio timing is not verified."
                        : fit.localOnly
                          ? "Estimated a local subtitle offset from matching dialogue near your playback position. Other scenes may need different adjustments."
                          : "Estimated timing against embedded subtitles in this video, not independently verified against audio.",
                      bindingRule: fit.alreadyAligned
                        ? "embedded-reference-no-change"
                        : fit.localOnly
                          ? "embedded-text-reference-local"
                          : "embedded-text-reference",
                      pCorrect: fit.strongOffset ? 0.99 : 0.92,
                      transform: fit.transform,
                    },
                    candidate: fit.transform,
                    evidence: [],
                    tiersRun: [],
                  };
                  handleOutcome(outcome, cues, fmt, cancelled, statusScope);
                  return;
                }
              } catch (error) {
                if (cancelled.current || !isCurrentAutoSyncScope(statusScope)) return;
                embeddedReferenceFailure = "extraction-error";
                // Do not export source URLs or decoder stderr. Only a known
                // native error category is safe to include in the log.
                const failureCode =
                  /(?:reference-[a-z-]+|ffmpeg-unavailable|analysis-cancelled|analysis-timeout)/i.exec(
                    String(error ?? ""),
                  )?.[0] ?? "other";
                void invoke("mpv_command", {
                  cmd: [
                    "print-text",
                    `[harbor/autosync] embedded-ref=extraction-error code=${failureCode}`,
                  ],
                }).catch(() => {});
              }
            }
            if (cancelled.current || !isCurrentAutoSyncScope(statusScope)) return;
            // Only the *separate audio* deadline starts here, after the
            // embedded-reference path has finished or been ruled out.
            armDeadline("audio");
            // Reset the independent UI watchdog too. Otherwise its original
            // timer fires 65 seconds after beginRun, even if the audio stage
            // only started 20-30 seconds ago and its native deadline is live.
            setAnalysisRevision((revision) => revision + 1);
            const ctx = {
              ...buildContext(active, activeSnap, sourceKind, cues, {
                language: activeSelected.lang,
                preferredLanguages: settingsRef.current.preferredSubLangs,
                format: fmt,
              }),
              analysisSessionId: nativeSessionId,
            };
            const os = defaultOsConfig(settingsRef.current);
            const pipelineOptions = (tryHarder: boolean) => ({
              tryHarder,
              allowStructuralAutoApply: settingsRef.current.autoSyncApplyStructural,
            });
            const applyAndCapture = (o: PipelineOutcome) => {
              handleOutcome(o, cues, fmt, cancelled, statusScope);
              if (
                embeddedReferenceFailure &&
                o.decision.decision === "refuse" &&
                !cancelled.current &&
                isCurrentAutoSyncScope(statusScope)
              ) {
                const detail =
                  embeddedReferenceFailure === "extraction-empty"
                    ? "FFmpeg did not return any usable embedded subtitle excerpts, so dialogue could not be compared."
                    : embeddedReferenceFailure === "extraction-sparse"
                      ? "The embedded subtitle extraction contained too little usable dialogue to compare."
                      : embeddedReferenceFailure === "extraction-error"
                        ? "The embedded subtitle could not be read, so no dialogue comparison was possible."
                        : embeddedReferenceFailure === "repeated-seek"
                          ? "FFmpeg returned repeated embedded subtitle segments at different seek positions."
                          : embeddedReferenceFailure === "text-mismatch"
                            ? "Usable embedded dialogue was extracted, but no matching lines were identified in the external subtitle."
                            : embeddedReferenceFailure === "timing-inconsistent"
                              ? "The dialogue matched, but its timestamps were inconsistent across the episode."
                              : embeddedReferenceFailure === "transform-out-of-bounds"
                                ? "The dialogue matched, but its timing correction exceeded the safe bounds."
                                : "The embedded subtitle had too few unique lines to verify timing independently.";
                const audioReason = refusalReason(o)
                  .replace(/https?:\/\/\S+/gi, "[source]")
                  .replace(/\s+/g, " ")
                  .slice(0, 180);
                setReason(
                  `${detail} Separate audio verification also failed: ${audioReason} No correction was applied.`,
                );
                void invoke("mpv_command", {
                  cmd: [
                    "print-text",
                    `[harbor/autosync] independent-audio=refused gate=${o.decision.bindingRule} embedded=${embeddedReferenceFailure}`,
                  ],
                }).catch(() => {});
              }
              if (
                !cancelled.current &&
                isCurrentAutoSyncScope(statusScope) &&
                o.candidate &&
                o.candidate.kind === "affine" &&
                o.decision.decision !== "refuse" &&
                o.decision.bindingRule !== "consensus-audio-unverified"
              ) {
                lastReportRef.current = {
                  ctx,
                  transform: o.candidate,
                  confidence: o.decision.pCorrect,
                };
              }
            };
            const pivotResolver = (ports: ReturnType<typeof buildTierPorts>) => {
              let pivotPromise: Promise<PipelineOutcome | null> | null = null;
              return async (base: PipelineOutcome): Promise<PipelineOutcome> => {
                if (!shouldAttemptAudioPivot(base)) return base;
                try {
                  pivotPromise ??= runExperimentalPivotAutoSync({
                    ctx,
                    ports,
                    settings: settingsRef.current,
                    src: active,
                    authKey,
                  });
                  return preferAutoSyncOutcome(base, await pivotPromise);
                } catch (error) {
                  dwarn("[auto-sync/pivot] experimental pivot failed", error);
                  return base;
                }
              };
            };
            if (isTorrent && ctx.infoHash) {
              const basePorts = buildTierPorts(ctx, settingsRef.current, {
                osConfig: os,
                authKey,
                torrent: { fileIdx, getPositionSec: () => liveSnapRef.current.positionSec },
              });
              const resolveOutcome = pivotResolver(basePorts);
              progressiveRef.current = scheduleProgressiveTorrentSync({
                ctx,
                fileIdx,
                basePorts,
                opts: pipelineOptions(force),
                osConfig: os ?? undefined,
                getSnapshot: () => ({
                  positionSec: liveSnapRef.current.positionSec,
                  durationSec: liveSnapRef.current.durationSec || ctx.durationSec,
                }),
                onOutcome: (o) => {
                  void resolveOutcome(o).then(applyAndCapture);
                },
              });
              retryRef.current = () =>
                void runAutoSync(ctx, basePorts, pipelineOptions(true))
                  .then(resolveOutcome)
                  .then(applyAndCapture);
            } else {
              const ports = buildTierPorts(ctx, settingsRef.current, { osConfig: os, authKey });
              const resolveOutcome = pivotResolver(ports);
              const runDirect = async (tryHarder: boolean) => {
                const outcome = await resolveOutcome(
                  await runAutoSync(ctx, ports, pipelineOptions(tryHarder)),
                );
                // A completed native promise after a deadline or newer run
                // must not emit a second failure or change the visible result.
                if (cancelled.current || !isCurrentAutoSyncScope(statusScope)) return;
                if (
                  outcome.decision.bindingRule === "no-candidate" ||
                  outcome.decision.bindingRule === "quality-measurement" ||
                  outcome.decision.bindingRule === "never-worse"
                ) {
                  const notes = ports.diagnosticNotes?.().join(",") || "no-stage-details";
                  // Fixed diagnostic codes and rounded timing only. Never
                  // export media URLs, headers, transcript or subtitle text.
                  const failure =
                    outcome.decision.bindingRule === "quality-measurement"
                      ? /timeout/i.test(outcome.decision.reason)
                        ? "verification-timeout"
                        : "verification-unavailable"
                      : outcome.decision.bindingRule === "never-worse"
                        ? "correction-rejected-by-audio"
                        : "no-candidate";
                  const candidate =
                    outcome.candidate?.kind === "affine"
                      ? ` offset=${outcome.candidate.offsetSec.toFixed(2)} ratio=${outcome.candidate.ratio.toFixed(4)}`
                      : "";
                  void invoke("mpv_command", {
                    cmd: [
                      "print-text",
                      `[harbor/autosync] failure=${failure} stages=${notes} kind=${ctx.sourceKind} cues=${ctx.cues.length} lang-match=${ctx.audioLanguage === ctx.subtitleLanguage}${candidate} run=${runLabel}`,
                    ],
                  }).catch(() => {});
                }
                if (
                  shouldFallbackToPlayback(outcome, sourceKind, tryHarder) &&
                  !cancelled.current &&
                  isCurrentAutoSyncScope(statusScope) &&
                  playbackFallbackRef.current
                ) {
                  // If the earlier independent read could not supply audio,
                  // repeating FFmpeg's remote seek is counterproductive.
                  // A rejected *verified* audio candidate (never-worse) can
                  // still benefit from a new nearby independent scene.
                  const preferBufferedAudio =
                    outcome.decision.bindingRule !== "never-worse" &&
                    outcome.decision.bindingRule !== "promotion";
                  void invoke("mpv_command", {
                    cmd: [
                      "print-text",
                      `[harbor/autosync] fallback=${preferBufferedAudio ? "playback-cache" : "nearby-audio"} reason=audio-candidate-needs-recheck`,
                    ],
                  }).catch(() => {});
                  playbackFallbackRef.current(preferBufferedAudio);
                  return;
                }
                applyAndCapture(outcome);
              };
              retryRef.current = () => void runDirect(true);
              await runDirect(force);
            }
          } catch (e) {
            dwarn("[auto-sync] failed", e);
            if (!cancelled.current) {
              clearDeadline();
              setReason(e instanceof Error ? e.message : String(e));
              setStatus("error");
            }
          }
        },
        cancelled,
        () => isCurrentAutoSyncScope(statusScope),
      );

      const dispose = () => {
        clearDeadline();
        liveTapCancelRef.current?.();
        cancelled.current = true;
        cancelNativeAnalysis(nativeSessionId);
        progressiveRef.current?.stop();
        progressiveRef.current = null;
        stopDrift();
        retryRef.current = null;
        // Disposal may happen when preflight eligibility changes. Previously
        // that cleared the deadline without resolving the spinner.
        if (statusScopeRef.current === statusScope && statusRef.current === "analyzing") {
          void invoke("mpv_command", {
            cmd: ["print-text", "[harbor/autosync] failure=cancelled-before-result"],
          }).catch(() => {});
          setReason(null);
          setStatus("idle");
        }
        if (activeDisposeRef.current === dispose) activeDisposeRef.current = null;
      };
      activeDisposeRef.current = dispose;
      return dispose;
    },
    [
      engine,
      bridgeRef,
      clearDeadline,
      handleOutcome,
      isCurrentAutoSyncScope,
      runWithSubtitleFpsReset,
      stopDrift,
      authKey,
    ],
  );

  const selectedAudioKey = audioSelectionKey(snap);
  // A native mpv sub-delay affects every subtitle. Clear the automatic
  // contribution before loading a saved correction or analyzing another track.
  useEffect(() => {
    const scope = statusScopeRef.current;
    if (!scope) return;
    const ownGenerated = isOwnGeneratedSyncTrack(selected, appliedRef.current.generatedTrackPath);
    const stillCurrent = isAutoSyncScopeCurrent(scope, {
      mediaKey,
      trackId: selected?.id ?? null,
      audioKey: selectedAudioKey,
      syncedTrack: ownGenerated,
    });
    if (stillCurrent) return;
    activeDisposeRef.current?.();
    liveTapCancelRef.current?.();
    stopDrift();
    clearDeadline();
    progressiveRef.current?.stop();
    progressiveRef.current = null;
    const a = appliedRef.current;
    if (a.changed && a.scope === scope) {
      // On a track change, keep the viewer's manual offset. On a new
      // episode/source, use *that* media's baseline, never the old correction.
      const baseline = autoSyncExitBaseline(
        scope.mediaKey,
        mediaKey,
        a.subDelayBefore,
        readPlayerPrefs(src.meta.id)?.subDelaySec ?? 0,
      );
      bridgeRef.current?.setSubDelay(
        initialDelayForSelectedTrack(
          selected,
          baseline,
          readPlayerPrefs(src.meta.id)?.subDelayTrackKind,
        ),
      );
    }
    if (firedRef.current.mediaKey === scope.mediaKey) {
      firedRef.current.trackAudioKeys.delete(JSON.stringify([scope.trackId, scope.audioKey]));
    }
    appliedRef.current = {
      transform: null,
      originalTrackId: null,
      subDelayBefore: 0,
      scope: null,
      changed: false,
    };
    statusScopeRef.current = null;
    doneKeyRef.current = null;
    bestScoreRef.current = -1;
    setOffer(null);
    setReason(null);
    setStatus("idle");
  }, [
    mediaKey,
    selected?.id,
    selected?.externalFilename,
    selected?.url,
    selectedSynced,
    selectedAudioKey,
    bridgeRef,
    clearDeadline,
    stopDrift,
    src.meta.id,
  ]);

  // Restore confirmed corrections before the ordinary automatic analyzer can
  // run. Check the original cue fingerprint, not mpv's ephemeral subtitle ID.
  useEffect(() => {
    const currentSnap = liveSnapRef.current;
    const currentTrack = currentSnap.subtitleTracks.find((t) => t.selected) ?? null;
    if (
      engine !== "mpv" ||
      !currentSnap.firstFrameReady ||
      currentSnap.durationSec < MIN_DURATION_SEC ||
      !currentTrack?.external ||
      isSyncedTrack(currentTrack)
    )
      return;
    const persistentAudio = persistenceAudioKey(currentSnap);
    if (!persistentAudio) return;
    const savedMedia = persistenceMediaKey(srcRef.current);
    const hasSaved = hasSavedAutoSyncCorrection(savedMedia, persistentAudio);
    if (!hasSaved && !ready) return;
    const currentMedia = autoSyncMediaKey(srcRef.current);
    const currentAudio = audioSelectionKey(currentSnap);
    const signature = JSON.stringify([currentTrack.id, currentAudio]);
    const fired = firedRef.current;
    if (fired.mediaKey !== currentMedia) {
      fired.mediaKey = currentMedia;
      fired.trackAudioKeys = new Set();
    }
    if (fired.trackAudioKeys.has(signature)) return;
    fired.trackAudioKeys.add(signature);

    const isOriginalCurrent = () => {
      const s = liveSnapRef.current;
      return (
        autoSyncMediaKey(srcRef.current) === currentMedia &&
        s.subtitleTracks.some((t) => t.selected && t.id === currentTrack.id) &&
        audioSelectionKey(s) === currentAudio
      );
    };
    void (async () => {
      if (!hasSaved) {
        if (ready && isOriginalCurrent()) beginRun(false);
        return;
      }
      const b = bridgeRef.current;
      const cues = b ? await loadCues(b) : null;
      if (!isOriginalCurrent()) return;
      const saved = cues ? readSavedAutoSyncCorrection(savedMedia, persistentAudio, cues) : null;
      if (!saved) {
        // Another subtitle release may have a saved correction, but not this
        // selected track. Let the normal analyzer handle the new release.
        if (ready) beginRun(false);
        else fired.trackAudioKeys.delete(signature);
        return;
      }
      if (!shouldRestoreAutoSyncCorrection(saved, liveSnapRef.current.positionSec)) {
        // The viewer resumed outside the scene used for this estimate.
        // Retain it, but don't assume it was verified for the full episode.
        return;
      }
      if (!b || !cues) return;
      const scope: AutoSyncScope = {
        mediaKey: currentMedia,
        trackId: currentTrack.id,
        audioKey: currentAudio,
      };
      statusScopeRef.current = scope;
      doneKeyRef.current = autoSyncRunKey(scope.mediaKey, scope.trackId, scope.audioKey);
      appliedRef.current = {
        transform: null,
        originalTrackId: currentTrack.id,
        subDelayBefore: initialDelayForSelectedTrack(
          currentTrack,
          readPlayerPrefs(srcRef.current.meta.id)?.subDelaySec,
          readPlayerPrefs(srcRef.current.meta.id)?.subDelayTrackKind,
        ),
        scope,
        changed: false,
      };
      const isCurrent = () => isCurrentAutoSyncScope(scope);
      const failRestore = () => {
        if (!isCurrent()) return;
        statusScopeRef.current = null;
        doneKeyRef.current = null;
        if (ready && isOriginalCurrent()) beginRun(false);
      };
      try {
        await runWithSubtitleFpsReset(
          async () => {
            if (!isCurrent()) return;
            const applied = await applyTransform(
              b,
              cues,
              formatOf(b, currentTrack),
              saved.transform,
              isCurrent,
            );
            if (!isCurrent()) return;
            if (!applied || !appliedRef.current.changed) {
              failRestore();
              return;
            }
            appliedRef.current.savedCorrectionId = saved.id;
            setOffer(null);
            setReason(
              saved.embeddedReference && saved.scope === "episode"
                ? "Timing matches the embedded subtitle. Spoken audio has not been verified."
                : saved.scope === "scene"
                  ? "Restored the saved correction near its calibrated scene. Other scenes are not verified."
                  : saved.verified
                    ? "Restored the saved Auto sync correction for this subtitle and source."
                    : "Restored the saved estimated subtitle timing for this source.",
            );
            setStatus(
              saved.embeddedReference === true
                ? "matched-embedded"
                : saved.verified
                  ? "synced"
                  : "best-effort",
            );
            void invoke("mpv_command", {
              cmd: [
                "print-text",
                `[harbor/autosync] restored scope=${saved.scope} verified=${saved.verified}`,
              ],
            }).catch(() => {});
          },
          undefined,
          isCurrent,
        );
      } catch (error) {
        dwarn("[auto-sync] could not restore saved correction", error);
        failRestore();
      }
    })();
    // No cleanup: changing preflight state must not cancel an in-flight
    // restore. The current media/track/audio guard rejects stale results.
  }, [
    engine,
    mediaKey,
    selected?.id,
    selectedSynced,
    selectedAudioKey,
    snap.firstFrameReady,
    ready,
    bridgeRef,
    beginRun,
    applyTransform,
    isCurrentAutoSyncScope,
    runWithSubtitleFpsReset,
  ]);

  const revert = useCallback(() => {
    clearDeadline();
    liveTapCancelRef.current?.();
    progressiveRef.current?.stop();
    progressiveRef.current = null;
    stopDrift();
    const b = bridgeRef.current;
    const a = appliedRef.current;
    const selectedTrack = liveSnapRef.current.subtitleTracks.find((t) => t.selected) ?? null;
    const canRevert =
      a.changed &&
      isAutoSyncScopeCurrent(a.scope, {
        mediaKey: autoSyncMediaKey(srcRef.current),
        trackId: selectedTrack?.id ?? null,
        audioKey: audioSelectionKey(liveSnapRef.current),
        syncedTrack: isOwnGeneratedSyncTrack(selectedTrack, a.generatedTrackPath),
      });
    if (canRevert) clearSavedAutoSyncCorrection(a.savedCorrectionId ?? null);
    if (b && a.changed && a.scope) {
      // Stop can race an mpv track transition. Clear the old global delay
      // even when the new subtitle has already become selected.
      const baseline = autoSyncExitBaseline(
        a.scope.mediaKey,
        autoSyncMediaKey(srcRef.current),
        a.subDelayBefore,
        readPlayerPrefs(srcRef.current.meta.id)?.subDelaySec ?? 0,
      );
      if (canRevert && a.originalTrackId) b.setSubtitleTrack(a.originalTrackId);
      b.setSubDelay(
        initialDelayForSelectedTrack(
          selectedTrack,
          baseline,
          readPlayerPrefs(srcRef.current.meta.id)?.subDelayTrackKind,
        ),
      );
    }
    appliedRef.current = {
      transform: null,
      originalTrackId: null,
      subDelayBefore: 0,
      scope: null,
      changed: false,
    };
    statusScopeRef.current = null;
    bestScoreRef.current = -1;
    setOffer(null);
    setReason(null);
    setStatus("idle");
  }, [bridgeRef, clearDeadline, isCurrentAutoSyncScope, stopDrift]);

  const stop = useCallback(() => {
    activeDisposeRef.current?.();
    revert();
  }, [revert]);

  const suspendForManualTiming = useCallback(() => {
    // Unlike Stop/Revert, taking manual control must preserve the current offset.
    clearDeadline();
    liveTapCancelRef.current?.();
    manualTimingMediaRef.current = autoSyncMediaKey(srcRef.current);
    const selectedTrack = liveSnapRef.current.subtitleTracks.find((t) => t.selected) ?? null;
    const applied = appliedRef.current;
    const hasActiveCorrection =
      applied.changed &&
      isAutoSyncScopeCurrent(applied.scope, {
        mediaKey: autoSyncMediaKey(srcRef.current),
        trackId: selectedTrack?.id ?? null,
        syncedTrack: isOwnGeneratedSyncTrack(selectedTrack, applied.generatedTrackPath),
        audioKey: audioSelectionKey(liveSnapRef.current),
      });
    if (hasActiveCorrection) clearSavedAutoSyncCorrection(applied.savedCorrectionId ?? null);
    activeDisposeRef.current?.();
    stopDrift();
    retryRef.current = null;
    // Retain a live scope for cleanup when the viewer switches subtitles.
    // Taking manual control must not turn an automatic offset into a new
    // show-wide manual preference or leave it on embedded subtitles.
    if (!hasActiveCorrection) statusScopeRef.current = null;
    setOffer(null);
    setReason(null);
    setStatus("idle");
  }, [clearDeadline, stopDrift]);

  const feedback = useCallback((good: boolean) => {
    const s = settingsRef.current;
    if (s.subtitleAutoSyncCrowd === false) return;
    const r = lastReportRef.current;
    if (!r) return;
    const cfg = crowdConfigFromSettings(s);
    if (!cfg) return;
    void reportCrowdFeedback(r.ctx.cues, good, cfg);
    if (good) void reportVerifiedSync(r.ctx, r.transform, r.confidence, cfg);
  }, []);

  const applyOffer = useCallback(() => {
    const o = offer;
    if (!o) return;
    const statusScope = statusScopeRef.current;
    const isCurrent = () => isCurrentAutoSyncScope(statusScope);
    void runWithSubtitleFpsReset(
      async () => {
        const b = bridgeRef.current;
        if (!b || !isCurrent()) return;
        setOffer(null);
        if (o.subSwap) {
          const os = defaultOsConfig(settingsRef.current) ?? {
            apiKey: "",
            userAgent: "Harbor autosync",
          };
          const swap = o.subSwap;
          const applied = await applySwap(b, swap, os, isCurrent);
          if (applied) appliedRef.current.changed = true;
          else setReason("The matched subtitle could not be loaded.");
          if (isCurrent()) setStatus(applied ? "synced" : "error");
          return;
        }
        const t = o.candidate;
        const cues = await loadCues(b);
        if (!t || !cues) return;
        const selectedTrack =
          liveSnapRef.current.subtitleTracks.find((track) => track.selected) ?? null;
        if (o.decision.bindingRule === "embedded-text-reference-local") {
          const local = localReferenceFocusRef.current;
          if (
            !local ||
            local.scope !== statusScope ||
            Math.abs(getPlaybackPosition() - local.positionSec) > 90
          ) {
            setReason(
              "Playback moved away from the calibrated scene. Run Auto sync again at the scene you want to fix.",
            );
            setStatus("declined");
            return;
          }
        }
        if (
          (o.decision.bindingRule === "embedded-text-reference" ||
            o.decision.bindingRule === "embedded-text-reference-local") &&
          t.kind === "affine"
        ) {
          const greatestShift = Math.max(
            0,
            ...cues.map((cue) => Math.abs(t.offsetSec + (t.ratio - 1) * cue.start)),
          );
          if (greatestShift < 0.25) {
            setReason(
              "The embedded subtitle proposes less than 0.25 seconds of change. It cannot fix an audio mismatch shared by both subtitle tracks.",
            );
            setStatus("declined");
            void invoke("mpv_command", {
              cmd: ["print-text", "[harbor/autosync] offer-rejected=no-perceptible-timing-change"],
            }).catch(() => {});
            return;
          }
        }
        const applied = await applyTransform(b, cues, formatOf(b, selectedTrack), t, isCurrent);
        if (!isCurrent()) return;
        if (!applied) {
          setReason("This subtitle cannot be rewritten safely.");
          setStatus("error");
          return;
        }
        const localReference = o.decision.bindingRule === "embedded-text-reference-local";
        const referenceOnly =
          localReference || o.decision.bindingRule === "embedded-text-reference";
        setReason(
          localReference
            ? "Calibrated to the current scene using embedded subtitle dialogue. The delay is applied to the whole track; other scenes may still differ. Not audio verified."
            : referenceOnly
              ? "Timing was adjusted to match the embedded subtitle, not verified against spoken dialogue."
              : null,
        );
        persistAppliedCorrection(cues, t, o.decision.bindingRule);
        setStatus(
          referenceOnly
            ? "matched-embedded"
            : o.decision.bindingRule === "consensus-audio-unverified" ||
                o.decision.bindingRule === "cross-language-speech-timing" ||
                o.decision.bindingRule === "live-tap"
              ? "best-effort"
              : "synced",
        );
        // Text-reference timing is not audio verification. A drift monitor
        // based on the old cue timeline could overwrite this fresh correction.
        if (
          o.decision.bindingRule !== "consensus-audio-unverified" &&
          o.decision.bindingRule !== "embedded-text-reference" &&
          o.decision.bindingRule !== "embedded-text-reference-local" &&
          o.decision.bindingRule !== "cross-language-speech-timing"
        ) {
          startDrift(b, cues);
        }
        if (referenceOnly && t.kind === "affine") {
          void invoke("mpv_command", {
            cmd: [
              "print-text",
              `[harbor/autosync] offer-applied=${o.decision.bindingRule} offset=${t.offsetSec.toFixed(3)} ratio=${t.ratio.toFixed(6)} playhead-shift=${(t.offsetSec + (t.ratio - 1) * liveSnapRef.current.positionSec).toFixed(3)}`,
            ],
          }).catch(() => {});
        }
      },
      undefined,
      isCurrent,
    ).catch((error) => {
      dwarn("[auto-sync] offer apply failed", error);
      if (isCurrent()) {
        setReason(error instanceof Error ? error.message : String(error));
        setStatus("error");
      }
    });
  }, [
    offer,
    bridgeRef,
    applyTransform,
    persistAppliedCorrection,
    isCurrentAutoSyncScope,
    runWithSubtitleFpsReset,
    startDrift,
  ]);

  const listen = useCallback(
    (preferBufferedAudio = false) => {
      const b = bridgeRef.current;
      if (!b || engine !== "mpv") return;
      let scope = statusScopeRef.current;
      if (!scope) {
        const active = srcRef.current;
        const snap = liveSnapRef.current;
        const selectedTrack = snap.subtitleTracks.find((track) => track.selected) ?? null;
        if (snap.durationSec < MIN_DURATION_SEC) return;
        if (!selectedTrack || selectedTrack.external !== true || isSyncedTrack(selectedTrack)) {
          return;
        }
        scope = {
          mediaKey: autoSyncMediaKey(active),
          trackId: selectedTrack.id,
          audioKey: audioSelectionKey(snap),
        };
        statusScopeRef.current = scope;
        doneKeyRef.current = autoSyncRunKey(scope.mediaKey, selectedTrack.id, scope.audioKey);
        appliedRef.current = {
          transform: null,
          originalTrackId: selectedTrack.id,
          subDelayBefore: initialDelayForSelectedTrack(
            selectedTrack,
            readPlayerPrefs(active.meta.id)?.subDelaySec,
            readPlayerPrefs(active.meta.id)?.subDelayTrackKind,
          ),
          scope,
          changed: false,
        };
        bestScoreRef.current = -1;
      }
      if (!isCurrentAutoSyncScope(scope)) return;
      localReferenceFocusRef.current = {
        scope,
        positionSec: getPlaybackPosition(),
      };
      // The two sync modes share player state and must never run concurrently.
      activeDisposeRef.current?.();
      clearDeadline();
      liveTapCancelRef.current?.();
      let aborted = false;
      let activeSceneSessionId: string | null = null;
      const nativeTapId = newAnalysisSessionId();
      const cancelTap = () => {
        aborted = true;
        cancelNativeAnalysis(nativeTapId);
        if (activeSceneSessionId) cancelNativeAnalysis(activeSceneSessionId);
      };
      liveTapCancelRef.current = cancelTap;
      setOffer(null);
      setReason(null);
      setAnalysisRevision((revision) => revision + 1);
      setStatus("listening");

      void (async () => {
        let recordPath: string | null = null;
        const cleanupFiles: Array<() => Promise<void>> = [];
        try {
          const [{ tempDir, join }, fs] = await Promise.all([
            import("@tauri-apps/api/path"),
            import("@tauri-apps/plugin-fs"),
          ]);
          const dir = await join(await tempDir(), "harbor-subs", "live");
          await fs.mkdir(dir, { recursive: true, mode: 0o700 });
          recordPath = await join(dir, `tap-${Date.now()}.mkv`);
          cleanupFiles.push(() => fs.remove(recordPath as string));
          const snap = liveSnapRef.current;
          const duration = snap.durationSec;
          const focusSec = getPlaybackPosition();
          const clipSec = SCENE_CLIP_SEC;
          if (!(duration >= clipSec))
            throw new Error("The video is too short to sync from playback.");
          if (snap.audioTracks.find((track) => track.selected)?.external) {
            throw new Error(
              "Playback sync needs an audio track from the video to capture the dialogue.",
            );
          }
          const sourceCues = await loadCues(b);
          if (aborted || !isCurrentAutoSyncScope(scope)) return;
          if (!sourceCues || sourceCues.length < MIN_CUES) {
            throw new Error("The selected subtitle could not be read or has too few cues.");
          }
          // Look both behind and ahead of the playhead for enough *distinct,
          // spoken* cues, without relaxing the native audio-confidence gates.
          const nearbyScenes = rankDialogueScenes(sourceCues, focusSec, duration, clipSec);
          let scene = nearbyScenes[0];
          let startAt = scene?.startSec ?? focusSec;
          let endAt = scene?.endSec ?? focusSec + clipSec;

          // A user-initiated fallback arrives here only after the independent
          // remote audio check already failed. Never repeat that same source
          // seek: use mpv's playback cache and require verified decoded PCM.
          // A full Auto Sync recheck may probe the source first. The explicit
          // playback action always starts with the mpv cache.
          if (preferBufferedAudio === true) {
            void invoke("mpv_command", {
              cmd: [
                "print-text",
                "[harbor/subsync] scene-read=skipped reason=buffered-playback-selected",
              ],
            }).catch(() => {});
          }
          const active = b.getLoadedMediaSource?.() ?? srcRef.current;
          if (scene && shouldReadIndependentSceneAudio(preferBufferedAudio, active.url)) {
            const alternate = nearbyScenes.find(
              (candidate) =>
                Math.abs(candidate.startSec - scene.startSec) >= 20 &&
                candidate.distanceFromPlaybackSec <= 30,
            );
            const probeScenes = alternate ? [scene, alternate] : [scene];
            const deadlineAt = Date.now() + 25_000;
            let lastProbeError: unknown = new Error("subsync-scene-no-reliable-match");
            for (const candidate of probeScenes) {
              if (aborted || !isCurrentAutoSyncScope(scope)) return;
              const budgetMs = deadlineAt - Date.now();
              if (budgetMs < 4_000) break;
              scene = candidate;
              startAt = scene.startSec;
              endAt = scene.endSec;
              // Relative subtitle cues and selected audio must refer to exactly
              // the same start/end interval, including on a retry.
              const sceneCues = scene.intervals;
              const sceneSessionId = newAnalysisSessionId();
              activeSceneSessionId = sceneSessionId;
              setReason("Checking nearby audio from the source");
              void invoke("mpv_command", {
                cmd: ["print-text", "[harbor/subsync] scene-read=start method=selected-audio"],
              }).catch(() => {});
              const probeStartedAt = Date.now();
              try {
                const sceneResult = await boundedNativeProbe(
                  () =>
                    invoke<{ offsetSec: number; confidence: number } | null>("sync_subtitle", {
                      url: active.url,
                      headers: active.headers ?? null,
                      cues: sceneCues,
                      durationSec: clipSec,
                      windowStartSec: startAt,
                      infoHash: null,
                      confMin: null,
                      mapSpec: audioStreamMap(liveSnapRef.current) ?? "0:a:0",
                      sessionId: sceneSessionId,
                      playbackClip: true,
                      fromStart: false,
                      reportFailures: true,
                    }),
                  () => cancelNativeAnalysis(sceneSessionId),
                  Math.min(25_000, budgetMs),
                );
                if (aborted || !isCurrentAutoSyncScope(scope)) return;
                if (
                  sceneResult &&
                  Number.isFinite(sceneResult.offsetSec) &&
                  Number.isFinite(sceneResult.confidence) &&
                  Math.abs(sceneResult.offsetSec) <= 60
                ) {
                  void invoke("mpv_command", {
                    cmd: ["print-text", "[harbor/subsync] scene-read=matched"],
                  }).catch(() => {});
                  const transform: SyncTransform = {
                    kind: "affine",
                    offsetSec: sceneResult.offsetSec,
                    ratio: 1,
                  };
                  setOffer({
                    decision: {
                      decision: "offer",
                      reason: "Single-scene dialogue estimate, confirm timing",
                      bindingRule: "live-tap",
                      pCorrect: sceneResult.confidence,
                      transform,
                    },
                    candidate: transform,
                    evidence: [],
                    tiersRun: [],
                  });
                  setReason(null);
                  setStatus("offer");
                  return;
                }
                // A null result gives no evidence for a shift; never silently
                // switch to an unverified offset or use the broken MKV dump.
                throw new Error("subsync-scene-no-reliable-match");
              } catch (error) {
                if (aborted || !isCurrentAutoSyncScope(scope)) return;
                lastProbeError = error;
                const code =
                  /(?:subsync|ffmpeg|cache-audio)-[a-z-]+/.exec(String(error ?? ""))?.[0] ??
                  "scene-read-failed";
                const elapsedMs = Date.now() - probeStartedAt;
                void invoke("mpv_command", {
                  cmd: [
                    "print-text",
                    `[harbor/subsync] scene-read=failed reason=${code} elapsed-ms=${elapsedMs} interval-start=${startAt.toFixed(1)} interval-length=${clipSec}`,
                  ],
                }).catch(() => {});
              } finally {
                activeSceneSessionId = null;
                cancelNativeAnalysis(sceneSessionId);
              }
            }
            if (aborted || !isCurrentAutoSyncScope(scope)) return;
            const reason = String(lastProbeError ?? "");
            const kind = /subsync-scene-timeout|ffmpeg-timeout|analysis-timeout/i.test(reason)
              ? "timeout"
              : /low-confidence|no-reliable-match|no-match/i.test(reason)
                ? "no-match"
                : "unavailable";
            // Never turn an unverified remote read into a guessed correction.
            // Only a complete, decoded playback-cache audio clip may recover it.
            setReason(
              kind === "timeout"
                ? "Nearby source audio timed out. Checking buffered playback audio instead."
                : "Nearby source audio was not usable. Checking buffered playback audio instead.",
            );
            // The independent source phase has ended. Start a fresh UI deadline
            // for the separate buffered-audio recovery, not the old source timer.
            setAnalysisRevision((revision) => revision + 1);
            void invoke("mpv_command", {
              cmd: ["print-text", `[harbor/subsync] fallback=playback-cache reason=source-${kind}`],
            }).catch(() => {});
          }
          // Use a contiguous *actual* cached excerpt, including audio that is
          // already buffered behind playback. The player's position moves during
          // capture, so waiting for a fixed [position, position + clipSec] window
          // could miss a valid range forever as mpv evicts early packets.
          // Pausing does not abort this job: ask the viewer to resume and
          // automatically continue once the range has finished buffering.
          // The fallback must be tied to what the player actually buffered,
          // not an unverified re-read of a previously failing remote source.
          setReason("Checking buffered dialogue audio");
          let bufferDeadline = Date.now() + 60_000;
          let result: { offsetSec: number; confidence: number } | null = null;
          let cacheError: unknown = null;
          const directError: unknown = null;
          const directAttempted = false;
          let cacheAudioReady = false;
          let whisperFailure: string | null = null;
          let usedWhisper = false;
          let needsFreshAudio = false;
          let lastPosition = getPlaybackPosition();
          let playedFrom = lastPosition;
          while (!aborted && isCurrentAutoSyncScope(scope)) {
            const position = getPlaybackPosition();
            // A seek does not provide a continuous excerpt of played audio.
            if (position < lastPosition || position - lastPosition > 3) playedFrom = position;
            lastPosition = position;
            const cached = await readBufferedRanges();
            if (aborted || !isCurrentAutoSyncScope(scope)) return;
            const ranges = cached ?? [{ start: playedFrom, end: position }];
            const bufferedScene = rankDialogueScenes(
              sourceCues,
              position,
              duration,
              clipSec,
              ranges,
            ).find(
              (candidate) =>
                !needsFreshAudio ||
                (candidate.startSec >= playedFrom && candidate.endSec <= position),
            );
            if (!bufferedScene) {
              const paused = liveSnapRef.current.status === "paused";
              setReason(
                paused ? "Resume playback to buffer audio" : "Waiting for buffered dialogue audio",
              );
              if (Date.now() >= bufferDeadline) {
                if (cacheError) break;
                throw new Error(
                  paused
                    ? "Playback is paused. Resume playback and try Sync from playback again."
                    : "Harbor could not capture a complete dialogue scene near your playback position.",
                );
              }
              await sleep(500);
              continue;
            }
            scene = bufferedScene;
            startAt = scene.startSec;
            endAt = scene.endSec;
            const shifted = scene.intervals;
            try {
              setReason("Reading buffered playback audio");
              await invoke("mpv_command", {
                cmd: [
                  "dump-cache",
                  startAt.toFixed(3),
                  endAt.toFixed(3),
                  recordPath.replace(/\\/g, "/"),
                ],
              }).catch(() => {
                throw new Error("cache-audio-dump-command-failed");
              });
              if (aborted || !isCurrentAutoSyncScope(scope)) return;
              // dump-cache has completed. Validate actual decoded samples; the
              // container byte count cannot tell us how much audio it contains.
              // mpv remuxes selected tracks only, so the selected audio is 0:a:0
              // in this clip even when it was a later stream in the movie.
              const prepared = await invoke<{ path: string; durationSec: number }>(
                "subsync_prepare_cache_audio",
                { input: recordPath.replace(/\\/g, "/"), mapSpec: "0:a:0", sessionId: nativeTapId },
              );
              cleanupFiles.push(() => fs.remove(prepared.path));
              cacheAudioReady = true;
              if (aborted || !isCurrentAutoSyncScope(scope)) return;
              setReason("Comparing buffered speech with subtitle timing");
              try {
                result = await invoke<{ offsetSec: number; confidence: number } | null>(
                  "sync_subtitle",
                  {
                    url: prepared.path.replace(/\\/g, "/"),
                    headers: null,
                    cues: shifted,
                    durationSec: clipSec,
                    infoHash: null,
                    confMin: null,
                    mapSpec: "0:a:0",
                    sessionId: nativeTapId,
                    playbackClip: true,
                    // The prepared WAV starts at zero; use Harbor's speech VAD.
                    fromStart: false,
                    reportFailures: true,
                  },
                );
              } catch (error) {
                cacheError = error;
              }
              if (aborted || !isCurrentAutoSyncScope(scope)) return;
              if (!result) {
                setAnalysisRevision((revision) => revision + 1);
                const asrSessionId = newAnalysisSessionId();
                activeSceneSessionId = asrSessionId;
                try {
                  result = await boundedNativeProbe(
                    () =>
                      matchPlaybackSpeech(
                        {
                          path: prepared.path.replace(/\\/g, "/"),
                          durationSec: Math.min(prepared.durationSec, clipSec),
                          // Preserve cues outside the excerpt for lag searches at its edges.
                          cues: sourceCues.map((cue) => [cue.start - startAt, cue.end - startAt]),
                          audioLanguage: snap.audioTracks.find((track) => track.selected)?.lang,
                          subtitleLanguage: snap.subtitleTracks.find((track) => track.selected)
                            ?.lang,
                          enabled: settingsRef.current.subtitleAutoSyncAsr === true,
                          crossLanguage: settingsRef.current.subtitleAutoSyncPivot === true,
                          sessionId: asrSessionId,
                        },
                        invoke,
                        (message) => {
                          if (!aborted && isCurrentAutoSyncScope(scope)) setReason(message);
                          void invoke("mpv_command", {
                            cmd: [
                              "print-text",
                              `[harbor/subsync] playback-whisper=${message.startsWith("Recognizing") ? "started" : "transcribed"}`,
                            ],
                          }).catch(() => {});
                        },
                        () => !aborted && isCurrentAutoSyncScope(scope),
                      ),
                    () => cancelNativeAnalysis(asrSessionId),
                    90_000,
                  );
                  usedWhisper = true;
                } catch (error) {
                  whisperFailure = String(error instanceof Error ? error.message : error);
                  if (whisperFailure === "subsync-scene-timeout") {
                    whisperFailure =
                      "Whisper recognition of the buffered audio timed out. Try another dialogue scene.";
                  }
                } finally {
                  cancelNativeAnalysis(asrSessionId);
                  activeSceneSessionId = null;
                }
              }
              if (aborted || !isCurrentAutoSyncScope(scope)) return;
              if (result) localReferenceFocusRef.current = { scope, positionSec: position };
              break;
            } catch (error) {
              cacheError = error;
              if (cacheAudioReady || needsFreshAudio) break;
              needsFreshAudio = true;
              playedFrom = getPlaybackPosition();
              bufferDeadline = Date.now() + 60_000;
              setAnalysisRevision((revision) => revision + 1);
            }
          }
          if (aborted || !isCurrentAutoSyncScope(scope)) return;
          if (!result) {
            if (cacheError) dwarn("[auto-sync] cache recording failed", cacheError);
            if (directError) dwarn("[auto-sync] direct source fallback failed", directError);
            // The native matcher reports only numeric confidence diagnostics here.
            // Mirror those into mpv's exportable log so release-build reports can
            // explain which gate rejected the candidate without retaining audio.
            const reportCode = (error: unknown) => {
              const message = error instanceof Error ? error.message : String(error ?? "none");
              return /^(?:subsync-[\w-]+|cache-audio-[\w-]+)(?::[\w.,=+-]+)?$/.test(message)
                ? message.slice(0, 180)
                : error == null
                  ? "none"
                  : "other";
            };
            void invoke("mpv_command", {
              cmd: [
                "print-text",
                `[harbor/subsync] live failed cache=${reportCode(cacheError)} direct=${reportCode(directError)} attempted=${directAttempted} decoded=${cacheAudioReady}`,
              ],
            }).catch(() => {});
            throw new Error(
              whisperFailure ??
                liveSyncFailureReason({
                  cacheAudioReady,
                  cacheError,
                  directAttempted,
                  directError,
                }),
            );
          }
          if (!Number.isFinite(result.offsetSec)) {
            throw new Error(
              "Couldn't find a reliable offset from this playback excerpt. Try another scene or Manual offset.",
            );
          }
          if (Math.abs(result.offsetSec) > 60) {
            throw new Error("The estimated offset is too large to apply safely.");
          }
          if (usedWhisper && result.offsetSec === 0) {
            setOffer(null);
            setReason(
              "Whisper speech timing indicates these subtitles are already aligned in the sampled scene. No timing change was made; other scenes are not verified.",
            );
            setStatus("synced");
            return;
          }
          const transform: SyncTransform = {
            kind: "affine",
            offsetSec: result.offsetSec,
            ratio: 1,
          };
          setOffer({
            decision: {
              decision: "offer",
              reason: "live audio estimate",
              bindingRule: "live-tap",
              pCorrect: result.confidence,
              transform,
            },
            candidate: transform,
            evidence: [],
            tiersRun: [],
          });
          setReason(
            usedWhisper
              ? "Whisper speech timing suggests this shift for the current scene. Confirm it before keeping it; other scenes are not verified."
              : null,
          );
          setStatus("offer");
        } catch (e) {
          if (!aborted && isCurrentAutoSyncScope(scope)) {
            setReason(e instanceof Error ? e.message : String(e));
            setStatus("error");
          }
        } finally {
          if (liveTapCancelRef.current === cancelTap) liveTapCancelRef.current = null;
          for (const removeFile of cleanupFiles) await removeFile().catch(() => {});
        }
      })();
    },
    [bridgeRef, clearDeadline, engine, isCurrentAutoSyncScope],
  );

  playbackFallbackRef.current = (preferBufferedAudio) => listen(preferBufferedAudio);

  // Auto sync normally uses the full evidence pipeline for network and local
  // media. The guided playback tap also serves as the user-initiated fallback
  // for a remote source that rejects independent audio requests.
  const run = useCallback(() => {
    const active = srcRef.current;
    const cls = classifyTorrentSource(active.url, {
      infoHash: active.streamRef?.infoHash ?? null,
      fileIdx: active.streamRef?.fileIdx ?? null,
    });
    // Internal loopback endpoints deliberately cannot use the full analyzer.
    if (cls !== "torrent" && isLoopback(active.url)) {
      listen(true);
      return;
    }
    beginRun(true);
  }, [beginRun, listen]);

  // Retry follows the same source-aware path as the menu's Auto sync action.
  const retry = run;

  const scopeCurrent = isAutoSyncScopeCurrent(statusScopeRef.current, {
    mediaKey,
    trackId: selected?.id ?? null,
    syncedTrack: isOwnGeneratedSyncTrack(selected, appliedRef.current.generatedTrackPath),
    audioKey: audioSelectionKey(snap),
  });
  return {
    status: status === "idle" || scopeCurrent ? status : "idle",
    offer: scopeCurrent ? offer : null,
    reason: scopeCurrent ? reason : null,
    listen: () => listen(true),
    applyOffer,
    revert,
    retry,
    run,
    stop,
    prepareLiveSync: suspendForManualTiming,
    feedback,
    suspendForManualTiming,
  };
}

async function writeSyncedTrack(
  b: PlayerBridge,
  text: string,
  fmt: WritableSubFmt,
  isCurrent: () => boolean,
  manualDelaySec = 0,
  onPrepared?: (path: string) => void,
): Promise<boolean> {
  if (!isCurrent()) return false;
  const pathMod = await import("@tauri-apps/api/path");
  const dir = await pathMod.join(await pathMod.tempDir(), "harbor-subs");
  const filePath = await pathMod.join(dir, `autosync-${Date.now()}.${fmt}`);
  await invoke("save_text_file", { path: filePath, contents: text });
  if (!isCurrent()) return false;
  onPrepared?.(filePath);
  const added = await b.addSubtitle(filePath, undefined, `Synced (${fmt.toUpperCase()})`, true);
  if (!added || !isCurrent()) return false;
  b.setSubDelay(manualDelaySec);
  return true;
}

async function applySwap(
  b: PlayerBridge,
  subSwap: { url: string; format: WritableSubFmt },
  os: OsConfig,
  isCurrent: () => boolean,
): Promise<boolean> {
  const swap = await resolveSwapCues(subSwap, os);
  if (!swap || swap.cues.length < MIN_CUES || !isCurrent()) return false;
  const cues: SubCue[] = swap.cues.map((c, i) => ({
    start: c[0],
    end: c[1],
    text: swap.cueText[i] ?? "",
  }));
  const text = subSwap.format === "vtt" ? toVtt(cues) : toSrt(cues);
  try {
    return await writeSyncedTrack(b, text, subSwap.format, isCurrent);
  } catch (e) {
    dwarn("[auto-sync] swap failed", e);
    return false;
  }
}

async function loadCues(b: PlayerBridge): Promise<SubCue[] | null> {
  const inline = b.getSelectedTrackCues();
  if (inline && inline.length > 0) return inline;
  const raw = b.getSelectedTrackUrl();
  if (!raw) return null;
  // Local subtitle files must be read as bytes. Converting them to an asset URL and
  // fetching through the native bridge fails because that bridge cannot serve the
  // webview's asset protocol.
  if (!/^https?:/i.test(raw)) {
    try {
      const bytes = await readNonNetworkSubtitleBytes(
        raw,
        SUBTITLE_PREPARATION_LIMITS.subtitleFileBytes,
      );
      return parseSubtitle(decodeSubtitleBytes(bytes));
    } catch {
      return null;
    }
  }
  try {
    return await fetchAndParse(raw);
  } catch {
    return null;
  }
}

function formatOf(b: PlayerBridge, track: TrackInfo | null): SubFmt {
  const source = [b.getSelectedTrackUrl(), track?.externalFilename, track?.title]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (/\.ssa(?:$|[?#\s])/i.test(source) || /\bSSA\b/i.test(track?.codec ?? "")) return "ssa";
  if (/\.ass(?:$|[?#\s])/i.test(source) || isAssTrack(track)) return "ass";
  if (/\.vtt(?:$|[?#\s])/i.test(source) || /WEBVTT|\bVTT\b/i.test(track?.codec ?? "")) {
    return "vtt";
  }
  if (/\.srt(?:$|[?#\s])/i.test(source) || /SUBRIP|\bSRT\b/i.test(track?.codec ?? "")) {
    return "srt";
  }
  return "unknown";
}
