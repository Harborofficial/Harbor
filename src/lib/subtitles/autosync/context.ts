import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "@/lib/settings/types";
import { dinfo, dwarn } from "@/lib/debug";
import { estimateSubtitleOffset } from "@/lib/subtitles/auto-sync";

import type {
  PipelineContext,
  PiecewiseResult,
  TierPorts,
  VadResult,
  HashExactResult,
  AsrWindowSpec,
  AsrPhrase,
  AsrTranscript,
} from "./pipeline";
import {
  unknownQuality,
  type AlignmentQuality,
  type PiecewiseSegment,
  type QualityMeasurement,
  type QualityMeasurementRequest,
  type QualityUnknownReason,
  type SyncTransform,
} from "./fp-gate";
import {
  directScoreInvokeArgs,
  directScoreMeasurement,
  nativeScoreMeasurement,
  torrentScoreInvokeArgs,
  type NativeDirectScore,
} from "./direct-validation";
import { resolveTier0, resolveSwapCues, type OsConfig } from "./opensubtitles";
import { createConsensusPort, type ConsensusConfig } from "./consensus";
import { createCrowdDbPort, crowdConfigFromSettings } from "./crowd-db";
import { normalizeLang } from "@/lib/subtitles/language";
import { consensusLanguages } from "./language-context";
import { announceMoonshineModelMissing, resolveMoonshineLanguage } from "./moonshine-models";

type AsrTokenRaw = { text?: string; t0?: number; t1?: number; p?: number };
type AsrWindowRaw = { startSec?: number; lenSec?: number; lang?: string; tokens?: AsrTokenRaw[] };

const PIECE_MARGIN = 0.1;
const PIECE_OFFSETS = [-2, 0, 2];

const CANDIDATE_COVERAGE = 0.8;

// Must outlast the native 25s scoring budget, or valid slow measurements are discarded as timeouts.
const SCORE_TIMEOUT_MS = 30000;
const VAD_TIMEOUT_MS = 45000;
const TORRENT_SCORE_TIMEOUT_MS = 30000;
const TORRENT_VAD_TIMEOUT_MS = 60000;
const HASH_TIMEOUT_MS = 4000;
const CROWD_TIMEOUT_MS = 3000;
const ASR_TIMEOUT_MS = 25000;

function bounded<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function qualityFailureReason(error: unknown): QualityUnknownReason {
  const message = String(error ?? "").toLowerCase();
  if (message.includes("timeout") || message.includes("cancelled")) return "timeout";
  if (message.includes("ffmpeg-unavailable") || message.includes("ffmpeg not found"))
    return "ffmpeg-unavailable";
  // An installed FFmpeg can fail because the stream rejected a range request,
  // rejected authentication, or lacks the selected audio track. Do not report
  // those failures as "FFmpeg is missing".
  if (
    message.includes("ffmpeg-failed:") ||
    message.includes("audio-decode:") ||
    message.includes("audio") ||
    message.includes("no stream")
  )
    return "audio-unavailable";
  if (message.includes("unsupported") || message.includes("not supported")) return "not-supported";
  return "provider-error";
}

async function boundedMeasurement(
  measurement: Promise<QualityMeasurement>,
  ms: number,
  method: string,
): Promise<QualityMeasurement> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      measurement.catch((error) => unknownQuality(qualityFailureReason(error), method)),
      new Promise<QualityMeasurement>((resolve) => {
        timer = setTimeout(() => resolve(unknownQuality("timeout", method)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type AutoSyncExtraPorts = {
  measureQuality?: TierPorts["measureQuality"];
  crowdDb?: TierPorts["crowdDb"];
  vadPiecewise?: TierPorts["vadPiecewise"];
  asrMatch?: TierPorts["asrMatch"];
  metadataBounds?: TierPorts["metadataBounds"];
};

export type BuildTierPortsOpts = {
  osConfig?: OsConfig | null;
  authKey?: string | null;
  extra?: AutoSyncExtraPorts;
  torrent?: { fileIdx?: number; getPositionSec?: () => number };
};

type AutoSyncFlags = {
  subtitleAutoSyncCrowd?: boolean;
  subtitleAutoSyncAsr?: boolean;
};

function flagsOf(settings: Settings): AutoSyncFlags {
  return settings as AutoSyncFlags;
}

function isTorrentSource(ctx: PipelineContext): boolean {
  return (
    ctx.sourceKind === "torrent" && typeof ctx.infoHash === "string" && ctx.infoHash.length > 0
  );
}

function affineParams(t: SyncTransform): { offsetSec: number; ratio: number } {
  if (t.kind === "affine") return { offsetSec: t.offsetSec, ratio: t.ratio };
  const s = t.segments[0];
  return s ? { offsetSec: s.offsetSec, ratio: s.ratio } : { offsetSec: 0, ratio: 1 };
}

async function directScore(
  ctx: PipelineContext,
  transform: SyncTransform,
  request?: QualityMeasurementRequest,
  diagnostic?: (code: string) => void,
): Promise<QualityMeasurement> {
  const method = "subsync-score-transform";
  try {
    const q = await invoke<NativeDirectScore | null>(
      "subsync_score_transform",
      directScoreInvokeArgs(ctx, transform, request),
    );
    if (q === null) diagnostic?.("audio:native-no-score");
    if (q && diagnostic && request?.purpose === "validation") {
      if (typeof q.speechFraction === "number" && Number.isFinite(q.speechFraction))
        diagnostic(`audio:speech-fraction-${q.speechFraction.toFixed(3)}`);
      if (typeof q.subtitleFraction === "number" && Number.isFinite(q.subtitleFraction))
        diagnostic(`audio:cue-fraction-${q.subtitleFraction.toFixed(3)}`);
      if (typeof q.speechSegments === "number")
        diagnostic(`audio:speech-segments-${q.speechSegments}`);
      if (typeof q.subtitleSegments === "number")
        diagnostic(`audio:cue-segments-${q.subtitleSegments}`);
    }
    const measurement = directScoreMeasurement(q, request, method);
    if (q !== null && request?.purpose === "validation" && measurement.status === "unknown") {
      diagnostic?.("audio:heldout-provenance-rejected");
    }
    return measurement;
  } catch (error) {
    // Propagate only allowlisted failure categories to exportable mpv logs.
    // Never log native errors verbatim: FFmpeg may include signed media URLs.
    const message = String(error ?? "");
    const decoded =
      /ffmpeg-failed:(http-auth|audio-track|remote-seek|network-timeout|container|audio-decode|other)/.exec(
        message,
      )?.[1];
    if (decoded) diagnostic?.(`audio:${decoded}`);
    else if (/scoring-timeout/i.test(message)) diagnostic?.("audio:scoring-timeout");
    else if (/scoring-no-(speech|subtitle)-timing-contrast/i.test(message)) {
      diagnostic?.("audio:timing-mask-no-contrast");
      return unknownQuality("insufficient-data", method);
    } else if (/scoring-too-few-cues-in-sampled-windows/i.test(message)) {
      diagnostic?.("audio:sampled-windows-too-few-cues");
      return unknownQuality("insufficient-data", method);
    } else if (/scoring-no-speech-in-sampled-windows|audio-window-no-speech/i.test(message)) {
      diagnostic?.("audio:sampled-windows-no-speech");
      return unknownQuality("insufficient-data", method);
    }
    return unknownQuality(qualityFailureReason(error), method);
  }
}

async function torrentScore(
  ctx: PipelineContext,
  transform: SyncTransform,
  infoHash: string,
  fileIdx: number,
  positionSec: number | null,
  request?: QualityMeasurementRequest,
): Promise<QualityMeasurement> {
  const method = "torrent-score-transform";
  if (transform.kind !== "affine") {
    return unknownQuality("not-supported", method);
  }
  try {
    const q = await invoke<NativeDirectScore | null>(
      "torrent_score_transform",
      torrentScoreInvokeArgs(ctx, transform, infoHash, fileIdx, positionSec, request),
    );
    return nativeScoreMeasurement(q, request, method, "torrent");
  } catch (error) {
    return unknownQuality(qualityFailureReason(error), method);
  }
}

async function directVad(
  ctx: PipelineContext,
  diagnostic?: (message: string) => void,
): Promise<VadResult | null> {
  try {
    const out = await estimateSubtitleOffset({
      mediaUrl: ctx.mediaUrl,
      headers: ctx.headers,
      cues: ctx.cues,
      durationSec: ctx.durationSec,
      infoHash: null,
      audioMap: ctx.audioMap,
      sessionId: ctx.analysisSessionId,
      reportFailures: true,
    });
    if (!out) {
      diagnostic?.("vad:no-candidate");
      dinfo("[autosync/vad] audio analyzed, no confident offset");
      return null;
    }
    diagnostic?.("vad:candidate");
    dinfo(
      `[autosync/vad] offset=${out.offsetSec.toFixed(2)}s ratio=${out.ratio.toFixed(4)} conf=${out.confidence.toFixed(2)}`,
    );
    const quality: AlignmentQuality = {
      ncc: out.confidence,
      coverage: CANDIDATE_COVERAGE,
      z: out.confidence >= 0.55 ? 8 : 0,
    };
    return {
      transform: { kind: "affine", offsetSec: out.offsetSec, ratio: out.ratio },
      rawScore: out.confidence,
      quality,
      fitWindowIds: out.fitWindowIds?.length ? out.fitWindowIds : undefined,
    };
  } catch (e) {
    const detail = String(e ?? "");
    const ncc = /ncc=(-?[0-9]+(?:\.[0-9]+)?)/.exec(detail)?.[1];
    const bucket = detail.includes("subsync-low-confidence")
      ? `vad:low-confidence-ncc-${Number(ncc ?? 0).toFixed(2)}`
      : detail.includes("timeout")
        ? "vad:timeout"
        : detail.includes("ffmpeg")
          ? "vad:ffmpeg-error"
          : detail.includes("no-audio") || detail.includes("audio-windows")
            ? "vad:audio-unavailable"
            : "vad:unavailable";
    diagnostic?.(bucket);
    dwarn("[autosync/vad] audio engine unavailable", bucket);
    return null;
  }
}

async function torrentVad(
  ctx: PipelineContext,
  wantLate: boolean,
  infoHash: string,
  fileIdx: number,
  positionSec: number | null,
): Promise<VadResult | null> {
  try {
    const out = await invoke<{
      offsetSec: number;
      ratio: number;
      confidence: number;
      fitWindowIds?: string[];
    } | null>("torrent_sync_subtitle", {
      infoHash,
      fileIdx,
      url: ctx.mediaUrl,
      headers: ctx.headers ?? null,
      cues: ctx.cues,
      durationSec: ctx.durationSec,
      mapSpec: ctx.audioMap ?? null,
      confMin: null,
      wantLate,
      positionSec,
    });
    if (!out) return null;
    const quality: AlignmentQuality = {
      ncc: out.confidence,
      coverage: CANDIDATE_COVERAGE,
      z: out.confidence >= 0.55 ? 8 : 0,
    };
    return {
      transform: { kind: "affine", offsetSec: out.offsetSec, ratio: out.ratio },
      rawScore: out.confidence,
      quality,
      fitWindowIds: out.fitWindowIds?.length ? out.fitWindowIds : undefined,
    };
  } catch {
    return null;
  }
}

function hashExactPort(os: OsConfig): NonNullable<TierPorts["hashExact"]> {
  return async (ctx) => {
    const t0 = await resolveTier0({
      url: ctx.mediaUrl,
      headers: ctx.headers,
      size: ctx.moviebytesize,
      langs: ctx.languages,
      imdbId: ctx.meta?.imdbId,
      cfg: os,
    });
    if (t0.status !== "exact" || !t0.exact) return null;
    const file = t0.exact.files[0];
    const result: HashExactResult = {
      transform: { kind: "affine", offsetSec: 0, ratio: 1 },
      rawScore: t0.exact.fromTrusted ? 1 : Math.min(1, t0.exact.downloadCount / 200),
      subSwap: file
        ? { url: `os:file:${file.fileId}`, format: "srt", downloadCount: t0.exact.downloadCount }
        : undefined,
    };
    return result;
  };
}

export function defaultOsConfig(settings: Settings): OsConfig | null {
  if (settings.subProvidersEnabled?.opensubtitles === false) return null;
  const apiKey = settings.opensubtitlesApiKey || "";
  if (!apiKey) return null;
  return { apiKey, userAgent: "Harbor autosync" };
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function makePiecewisePort(
  score: TierPorts["measureQuality"],
  fitWindowIds: () => string[] | undefined,
): NonNullable<TierPorts["vadPiecewise"]> {
  return async (ctx, seed) => {
    if (ctx.cues.length < 8) return null;
    const starts = ctx.cues.map((c) => c[0]);
    const mid = median(starts);
    if (!Number.isFinite(mid) || mid <= starts[0] || mid >= starts[starts.length - 1]) return null;
    const a = affineParams(seed);
    const baseMeasurement = await score(ctx, {
      kind: "affine",
      offsetSec: a.offsetSec,
      ratio: a.ratio,
    });
    if (baseMeasurement.status !== "measured") return null;
    const base = baseMeasurement.value;
    let best: { q: AlignmentQuality; t: SyncTransform } = {
      q: base,
      t: { kind: "affine", offsetSec: a.offsetSec, ratio: a.ratio },
    };
    for (const d of PIECE_OFFSETS) {
      if (d === 0) continue;
      const segments: PiecewiseSegment[] = [
        { fromSec: 0, toSec: mid, offsetSec: a.offsetSec, ratio: a.ratio },
        { fromSec: mid, toSec: Infinity, offsetSec: a.offsetSec + d, ratio: a.ratio },
      ];
      const t: SyncTransform = { kind: "piecewise", segments };
      const measurement = await score(ctx, t);
      if (measurement.status !== "measured") continue;
      const q = measurement.value;
      if (q.ncc > best.q.ncc) best = { q, t };
    }
    if (best.t.kind !== "piecewise" || best.q.ncc < base.ncc + PIECE_MARGIN) return null;
    const result: PiecewiseResult = {
      transform: best.t,
      rawScore: best.q.ncc,
      quality: best.q,
      fitWindowIds: fitWindowIds(),
    };
    return result;
  };
}

function flattenAsr(out: AsrWindowRaw[] | null): AsrTranscript {
  if (!Array.isArray(out)) return { phrases: [], detectedLanguage: null };
  const segs: AsrPhrase[] = [];
  const sampledWindows: AsrWindowSpec[] = [];
  const languageCounts = new Map<string, number>();
  for (const w of out) {
    if (
      typeof w.startSec === "number" &&
      Number.isFinite(w.startSec) &&
      typeof w.lenSec === "number" &&
      Number.isFinite(w.lenSec) &&
      w.lenSec > 0
    ) {
      sampledWindows.push({ startSec: w.startSec, lenSec: w.lenSec });
    }
    const lang = normalizeLang(w.lang ?? "");
    if (lang) languageCounts.set(lang, (languageCounts.get(lang) ?? 0) + 1);
    for (const tk of w.tokens ?? []) {
      const text = String(tk.text ?? "").trim();
      if (text && Number.isFinite(tk.t0) && Number.isFinite(tk.t1)) {
        segs.push({ start: Number(tk.t0), end: Number(tk.t1), text });
      }
    }
  }
  segs.sort((x, y) => x.start - y.start);
  const detectedLanguage =
    [...languageCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
    null;
  return { phrases: segs, detectedLanguage, sampledWindows };
}

function makeAsrTranscribePort(
  diagnostic?: (message: string) => void,
  language = "auto",
): NonNullable<TierPorts["asrTranscribe"]> {
  return async (ctx, windows) => {
    const modelLanguage = resolveMoonshineLanguage(language, ctx.audioLanguage);
    if (!modelLanguage) {
      diagnostic?.("moonshine:language-unsupported");
      return { phrases: [], detectedLanguage: null };
    }
    const status = await invoke<{ installed: boolean; runtimeInstalled: boolean; supported: boolean }>(
      "moonshine_model_status", { language: modelLanguage },
    ).catch(() => null);
    if (!status?.installed) {
      if (status?.supported && status.runtimeInstalled) {
        announceMoonshineModelMissing(modelLanguage);
      }
      diagnostic?.("moonshine:model-unavailable");
      return { phrases: [], detectedLanguage: null };
    }
    const spans: AsrWindowSpec[] = Array.isArray(windows)
      ? windows.filter((w) => w != null && Number.isFinite(w.lenSec))
      : [];
    const probeCount = spans.length > 0 ? spans.length : 3;
    const windowSec = spans.length > 0 ? median(spans.map((w) => Math.max(5, w.lenSec))) : null;
    try {
      const out = await invoke<AsrWindowRaw[]>("moonshine_transcribe_windows", {
        url: ctx.mediaUrl,
        headers: ctx.headers ?? null,
        durationSec: ctx.durationSec,
        subLang: modelLanguage,
        probeCount,
        windowSec,
        mapSpec: ctx.audioMap ?? null,
        sessionId: ctx.analysisSessionId ?? null,
      });
      const transcript = flattenAsr(out);
      diagnostic?.(transcript.phrases.length > 0 ? "moonshine:transcribed" : "moonshine:no-speech");
      return transcript;
    } catch {
      diagnostic?.("moonshine:transcription-failed");
      return { phrases: [], detectedLanguage: null };
    }
  };
}

function consensusConfig(
  ctx: PipelineContext,
  settings: Settings,
  authKey?: string | null,
): ConsensusConfig {
  const enabled = settings.subProvidersEnabled;
  const langs = consensusLanguages(ctx, settings.preferredSubLangs);
  return {
    providers: {
      wyzie: enabled?.wyzie === true,
      addons: enabled?.addons !== false,
      opensubtitles: enabled?.opensubtitles !== false,
    },
    preferredLangs: langs,
    netAllowed: true,
    authKey: authKey ?? null,
  };
}

export function buildTierPorts(
  ctx: PipelineContext,
  settings: Settings,
  opts: BuildTierPortsOpts = {},
): TierPorts {
  const os = opts.osConfig ?? defaultOsConfig(settings);
  const extra = opts.extra ?? {};
  const flags = flagsOf(settings);
  const routeTorrent = isTorrentSource(ctx);
  const infoHash = ctx.infoHash ?? "";
  const fileIdx = opts.torrent?.fileIdx ?? 0;
  const getPositionSec = opts.torrent?.getPositionSec;
  const positionOf = (): number | null => getPositionSec?.() ?? null;
  const diagnosticNotes: string[] = [];
  const record = (message: string) => {
    if (diagnosticNotes.length < 28) diagnosticNotes.push(message);
  };

  const scoreTimeout = routeTorrent ? TORRENT_SCORE_TIMEOUT_MS : SCORE_TIMEOUT_MS;
  const measureQuality: TierPorts["measureQuality"] = async (mctx, transform, request) => {
    const result = await boundedMeasurement(
      routeTorrent
        ? torrentScore(mctx, transform, infoHash, fileIdx, positionOf(), request)
        : directScore(mctx, transform, request, record),
      scoreTimeout,
      routeTorrent ? "torrent-score-transform" : "subsync-score-transform",
    );
    if (request?.purpose === "validation") {
      const identity =
        transform.kind === "affine" && transform.offsetSec === 0 && transform.ratio === 1;
      const stage = identity ? "baseline" : "post";
      if (result.status === "measured") {
        record(`${stage}:ncc-${result.value.ncc.toFixed(3)}`);
        record(`${stage}:coverage-${result.value.coverage.toFixed(2)}`);
      } else {
        record(`${stage}:${result.reason}`);
      }
    }
    return result;
  };

  let fitWindowIds: string[] | undefined;
  const vadAffine: NonNullable<TierPorts["vadAffine"]> = async (mctx, win) => {
    const before = diagnosticNotes.length;
    const result = await bounded(
      routeTorrent
        ? torrentVad(mctx, win.lateWindow, infoHash, fileIdx, positionOf())
        : directVad(mctx, record),
      routeTorrent ? TORRENT_VAD_TIMEOUT_MS : VAD_TIMEOUT_MS,
      null,
    );
    if (diagnosticNotes.length === before) {
      record(result ? "vad:candidate" : "vad:timeout-or-no-candidate");
    }
    fitWindowIds = result?.fitWindowIds;
    return result;
  };

  const rawMeasure = extra.measureQuality;
  const effectiveMeasure: TierPorts["measureQuality"] = rawMeasure
    ? (mctx, transform, request) =>
        boundedMeasurement(rawMeasure(mctx, transform, request), scoreTimeout, "custom-quality")
    : measureQuality;
  const ports: TierPorts = {
    measureQuality: effectiveMeasure,
    vadAffine,
    diagnosticNotes: () => [...diagnosticNotes],
  };
  if (os) {
    const rawHash = hashExactPort(os);
    ports.hashExact = (hctx) => bounded(rawHash(hctx), HASH_TIMEOUT_MS, null);
    ports.resolveSwapCues = (_ctx, swap) => resolveSwapCues(swap, os);
  }
  if (flags.subtitleAutoSyncCrowd !== false) {
    const crowdCfg = crowdConfigFromSettings(settings);
    const crowdPort = extra.crowdDb ?? (crowdCfg ? createCrowdDbPort(crowdCfg) : undefined);
    if (crowdPort) ports.crowdDb = (cctx) => bounded(crowdPort(cctx), CROWD_TIMEOUT_MS, null);
  }
  const piecewise =
    extra.vadPiecewise ??
    (routeTorrent ? undefined : makePiecewisePort(effectiveMeasure, () => fitWindowIds));
  if (piecewise) ports.vadPiecewise = piecewise;
  if (flags.subtitleAutoSyncAsr === true) {
    if (extra.asrMatch) ports.asrMatch = extra.asrMatch;
    const transcribe = makeAsrTranscribePort(record, settings.subtitleMoonshineLanguage);
    ports.asrTranscribe = (actx, windows) =>
      bounded(
        transcribe(actx, windows),
        windows.some((window) => window.lenSec > 12) ? 45_000 : ASR_TIMEOUT_MS,
        {
          phrases: [],
          detectedLanguage: null,
        },
      );
  }
  if (extra.metadataBounds) ports.metadataBounds = extra.metadataBounds;
  const consensus = createConsensusPort(consensusConfig(ctx, settings, opts.authKey));
  ports.consensus = async (cctx) => {
    const result = await consensus(cctx);
    record(`consensus:${result?.verdict ?? "unavailable"}`);
    record(`consensus:anchors-${result?.textAnchors?.length ?? 0}`);
    return result;
  };
  return ports;
}
