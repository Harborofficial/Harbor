import {
  fuseConfidence,
  isAgreeingSignal,
  DEFAULT_PRIOR,
  toLogOdds,
  type SignalEvidence,
  type TierId,
  type Calibrator,
  type CrowdTier,
} from "./confidence";
import {
  evaluateBestEffort,
  evaluateGate,
  unknownQuality,
  outcomeRank,
  DEFAULT_BOUNDS,
  THRESHOLDS,
  type AlignmentQuality,
  type Bounds,
  type CandidateKind,
  type GateDecision,
  type QualityMeasurement,
  type QualityMeasurementRequest,
  type SubtitleFormat,
  type SyncTransform,
  type AffineTransform,
} from "./fp-gate";
import {
  classifyContent,
  metadataEvidence,
  subtitleShapeFromCues,
  type ClassCVerdict,
  type EpisodeRef,
} from "./metadata-priors";
import type { SwapCues } from "./opensubtitles";
import {
  canUseLexicalAsr,
  escalateTryHarder,
  consensusAnchorFit,
  consensusSignal,
  wrongContentOutcome,
} from "./smart-layer";
import {
  applyFusedCalibration,
  calibratorFor,
  DEFAULT_BUNDLE,
  isReleaseReady,
  reliabilityFor,
  type CalibrationBundle,
} from "./calibration";

export type SourceKind = "local" | "http" | "hls" | "debrid" | "torrent";

export type ConsensusCandidate = { url: string; lang: string; source: string; format?: string };
export type ConsensusResult = {
  verdict: "right" | "wrong" | "unknown";
  bestCandidate: ConsensusCandidate | null;
  agreement: number;
  textAnchors: Array<[number, number]> | null;
};
export type AsrWindowSpec = { startSec: number; lenSec: number };
export type AsrPhrase = { start: number; end: number; text: string };
export type AsrTranscript = { phrases: AsrPhrase[]; detectedLanguage: string | null; sampledWindows?: AsrWindowSpec[] };

export type MediaMeta = {
  expectedRuntimeSec?: number;
  fps?: number;
  imdbId?: string;
  tmdbId?: number;
  season?: number;
  episode?: number;
  isAnime?: boolean;
};

export type PipelineContext = {
  mediaUrl: string;
  headers?: Record<string, string>;
  infoHash?: string | null;
  sourceKind: SourceKind;
  durationSec: number;
  cues: Array<[number, number]>;
  cueText?: string[];
  moviehash?: string;
  moviebytesize?: number;
  /** ffmpeg stream specifier for the selected audio track, e.g. "0:a:1". */
  audioMap?: string;
  /** Native request lifetime, shared by quality, speech and transcription jobs. */
  analysisSessionId?: string;
  audioLanguage?: string | null;
  subtitleLanguage?: string | null;
  preferredSubtitleLanguages?: string[];
  subtitleFormat?: SubtitleFormat;
  /** Subtitle-only lookup languages retained for existing provider ports. */
  languages: string[];
  meta?: MediaMeta;
};

export type WindowPolicy = { earlyWindow: boolean; lateWindow: boolean };

export type SwapRef = { url: string; format: "srt" | "vtt"; downloadCount?: number };
export type { SwapCues };

export type HashExactResult = {
  transform: SyncTransform;
  rawScore: number;
  subSwap?: SwapRef;
};
export type CrowdResult = {
  transform: SyncTransform;
  rawScore: number;
  votes: number;
  verified: boolean;
  tier: CrowdTier;
};
export type VadResult = {
  transform: AffineTransform;
  rawScore: number;
  quality: AlignmentQuality;
  fitWindowIds?: string[];
};
export type PiecewiseResult = {
  transform: SyncTransform;
  rawScore: number;
  quality: AlignmentQuality;
  fitWindowIds?: string[];
};
export type AsrResult = { wordMatch: number; supportsTransform: number };

export type TierPorts = {
  /** Sanitized stage diagnostics; no media URLs, file paths or subtitle text. */
  diagnosticNotes?: () => string[];
  metadataBounds?: (ctx: PipelineContext, base: Bounds) => Bounds;
  hashExact?: (ctx: PipelineContext) => Promise<HashExactResult | null>;
  crowdDb?: (ctx: PipelineContext) => Promise<CrowdResult | null>;
  consensus?: (ctx: PipelineContext) => Promise<ConsensusResult | null>;
  vadAffine?: (ctx: PipelineContext, win: WindowPolicy) => Promise<VadResult | null>;
  vadPiecewise?: (ctx: PipelineContext, seed: SyncTransform) => Promise<PiecewiseResult | null>;
  asrMatch?: (ctx: PipelineContext, candidate: SyncTransform) => Promise<AsrResult | null>;
  asrTranscribe?: (ctx: PipelineContext, windows: AsrWindowSpec[]) => Promise<AsrTranscript>;
  resolveSwapCues?: (ctx: PipelineContext, swap: SwapRef) => Promise<SwapCues | null>;
  measureQuality: (
    ctx: PipelineContext,
    transform: SyncTransform,
    request?: QualityMeasurementRequest,
  ) => Promise<QualityMeasurement>;
};

export type PipelineOptions = {
  tryHarder?: boolean;
  prior?: number;
  calibrators?: Partial<Record<TierId, Calibrator>>;
  calibration?: CalibrationBundle;
  allowStructuralAutoApply?: boolean;
};

export type PipelineOutcome = {
  decision: GateDecision;
  candidate: SyncTransform | null;
  subSwap?: { url: string; format: "srt" | "vtt"; lang?: string; source?: string };
  evidence: SignalEvidence[];
  tiersRun: TierId[];
  bestEffort?: boolean;
};

const IDENTITY: AffineTransform = { kind: "affine", offsetSec: 0, ratio: 1 };
const MIN_SWAP_CUES = 4;
const MANUAL_OFFER_FLOOR = 0.5;
const GLOBAL_ESCALATION_VETOES = new Set(["conflict", "already-good", "metadata-hard-refuse"]);

const TIER_GROUP: Record<TierId, string> = {
  hash_exact: "hash",
  crowd_db: "crowd",
  vad_affine: "vad",
  vad_piecewise: "vad",
  asr_match: "asr",
  consensus: "consensus",
  metadata_prior: "meta",
};

function signal(
  tier: TierId,
  rawScore: number,
  clearedFloor: boolean,
  opts: PipelineOptions,
  extra?: Partial<SignalEvidence>,
): SignalEvidence {
  const bundle = opts.calibration ?? DEFAULT_BUNDLE;
  return {
    tier,
    rawScore,
    calibrator: opts.calibrators?.[tier] ?? calibratorFor(bundle, tier),
    reliability: reliabilityFor(bundle, tier),
    independenceGroup: TIER_GROUP[tier],
    clearedFloor,
    ...extra,
  };
}

function fusedConfidence(evidence: SignalEvidence[], prior: number, bundle: CalibrationBundle) {
  const raw = fuseConfidence(evidence, prior);
  const pCorrect = applyFusedCalibration(bundle, raw.pCorrect);
  return pCorrect === raw.pCorrect ? raw : { ...raw, pCorrect, logOdds: toLogOdds(pCorrect) };
}

function subtitleLanguages(ctx: PipelineContext): string[] {
  return [
    ctx.subtitleLanguage ?? undefined,
    ...(ctx.preferredSubtitleLanguages ?? []),
    ...ctx.languages,
  ]
    .filter((lang): lang is string => typeof lang === "string" && lang.length > 0)
    .filter((lang, index, all) => all.indexOf(lang) === index);
}

function windowPolicy(kind: SourceKind, tryHarder: boolean): WindowPolicy {
  if (kind === "torrent" || kind === "debrid") return { earlyWindow: true, lateWindow: tryHarder };
  return { earlyWindow: true, lateWindow: true };
}

function buildBounds(ctx: PipelineContext, ports: TierPorts): Bounds {
  const base: Bounds = { ...DEFAULT_BOUNDS };
  const exp = ctx.meta?.expectedRuntimeSec;
  if (exp && ctx.durationSec > 0 && Math.abs(ctx.durationSec - exp) < exp * 0.02) {
    base.maxOffsetSec = Math.min(base.maxOffsetSec, 20);
  }
  return ports.metadataBounds ? ports.metadataBounds(ctx, base) : base;
}

function runtimeOk(ctx: PipelineContext): boolean | undefined {
  const exp = ctx.meta?.expectedRuntimeSec;
  if (!exp || ctx.durationSec <= 0) return undefined;
  return Math.abs(ctx.durationSec - exp) <= exp * 0.15;
}

function episodeRefFromMeta(meta: MediaMeta): EpisodeRef {
  const kind = meta.season !== undefined && meta.episode !== undefined ? "episode" : "movie";
  return {
    kind,
    imdbId: meta.imdbId,
    tmdbId: meta.tmdbId,
    season: meta.season,
    episode: meta.episode,
    isAnime: meta.isAnime,
  };
}

function isAlreadyGood(before: QualityMeasurement): boolean {
  return before.status === "measured" && before.value.ncc >= THRESHOLDS.alreadyGoodNcc;
}

function enforceMetadataHardRefuse(
  decision: GateDecision,
  transform: SyncTransform,
  verdict: ClassCVerdict | null,
): GateDecision {
  if (!verdict?.hardRefuse || decision.decision === "refuse") return decision;
  return {
    decision: "refuse",
    reason: `wrong content: ${verdict.reasons[0] ?? "metadata hard refuse"}`,
    bindingRule: "metadata-hard-refuse",
    pCorrect: decision.pCorrect,
    transform,
  };
}

function needsPiecewise(v: VadResult): boolean {
  return v.quality.coverage < 0.75 && v.quality.ncc >= 0.5;
}

function crowdReliability(c: CrowdResult): number {
  const v = Math.min(1, c.votes / 5);
  return 0.6 + 0.35 * v;
}

function shouldRunAsr(
  evidence: SignalEvidence[],
  ctx: PipelineContext,
  opts: PipelineOptions,
  verdict: ClassCVerdict | null,
): boolean {
  if (!canUseLexicalAsr(ctx)) return false;
  if (opts.tryHarder) return true;
  const structural = evidence.some((e) => e.independenceGroup === "vad" && e.clearedFloor);
  if (!structural) return false;
  if (verdict?.demandAsr === true) return true;
  const independentCleared = new Set(
    evidence.filter(isAgreeingSignal).map((e) => e.independenceGroup),
  );
  const anime =
    ctx.meta?.isAnime === true ||
    (ctx.meta?.season !== undefined && ctx.meta?.episode !== undefined);
  return independentCleared.size < 2 || anime;
}

export async function runAutoSync(
  ctx: PipelineContext,
  ports: TierPorts,
  opts: PipelineOptions = {},
): Promise<PipelineOutcome> {
  const prior = opts.prior ?? DEFAULT_PRIOR;
  const calibration = opts.calibration ?? DEFAULT_BUNDLE;
  const calibrationReady = isReleaseReady(calibration);
  const bounds = buildBounds(ctx, ports);
  const validationRequest: QualityMeasurementRequest = { purpose: "validation" };
  const measureQuality = (
    measurementCtx: PipelineContext,
    transform: SyncTransform,
    request: QualityMeasurementRequest,
  ) =>
    ports
      .measureQuality(measurementCtx, transform, request)
      .catch(() => unknownQuality("provider-error", "quality-port"));
  const qualityBeforeP = measureQuality(ctx, IDENTITY, validationRequest);
  const consensusP: Promise<ConsensusResult | null> = ports.consensus
    ? ports.consensus(ctx).catch(() => null)
    : Promise.resolve(null);
  const priorRuntimeOk = runtimeOk(ctx);
  const evidence: SignalEvidence[] = [];
  const tiersRun: TierId[] = [];
  const metaVerdict =
    ctx.cues.length > 0
      ? classifyContent({
          videoDurationSec: ctx.durationSec,
          sub: subtitleShapeFromCues(ctx.cues, ctx.cueText),
          facts: [],
          wantLangs: subtitleLanguages(ctx),
          ref: ctx.meta ? episodeRefFromMeta(ctx.meta) : undefined,
        })
      : null;

  let best: PipelineOutcome = {
    decision: {
      decision: "refuse",
      reason: "no candidate produced",
      bindingRule: "default",
      pCorrect: prior,
      transform: IDENTITY,
    },
    candidate: null,
    evidence,
    tiersRun,
  };

  const keep = (out: PipelineOutcome) => {
    const rank = outcomeRank(out.decision.decision);
    const bestRank = outcomeRank(best.decision.decision);
    if (rank > bestRank || (rank === bestRank && best.decision.bindingRule === "default")) {
      best = out;
    }
  };

  const gateFor = async (
    transform: SyncTransform,
    candidateKind: CandidateKind,
    exactIdentity: boolean,
    over: {
      asrWordMatch?: number;
      qualityAfter?: QualityMeasurement;
      qualityBefore?: QualityMeasurement;
      requireImprovement?: boolean;
      fitWindowIds?: string[];
    } = {},
  ): Promise<GateDecision> => {
    const request: QualityMeasurementRequest = {
      purpose: "validation",
      excludeWindowIds: over.fitWindowIds,
    };
    const before =
      over.qualityBefore ??
      (over.fitWindowIds?.length
        ? await measureQuality(ctx, IDENTITY, request)
        : await qualityBeforeP);
    const qualityAfter = over.qualityAfter ?? (await measureQuality(ctx, transform, request));
    const confidence = fusedConfidence(evidence, prior, calibration);
    return evaluateGate({
      transform,
      confidence,
      qualityBefore: before,
      qualityAfter,
      bounds,
      exactIdentity,
      candidateKind,
      calibrationReady,
      structuralAutoApplyEnabled: opts.allowStructuralAutoApply === true,
      subtitleFormat: ctx.subtitleFormat ?? "unknown",
      fitWindowIds: over.fitWindowIds,
      asrWordMatch: over.asrWordMatch,
      priorRuntimeOk,
      inputAlreadyGood: isAlreadyGood(before),
      requireImprovement: over.requireImprovement,
      offerFloor: opts.tryHarder ? MANUAL_OFFER_FLOOR : undefined,
    });
  };

  const gateSubSwap = async (swap: SwapRef): Promise<PipelineOutcome> => {
    const swapOut = { url: swap.url, format: swap.format };
    const resolved = ports.resolveSwapCues
      ? await ports.resolveSwapCues(ctx, swap).catch(() => null)
      : null;
    if (!resolved || resolved.cues.length < MIN_SWAP_CUES) {
      const pCorrect = fusedConfidence(evidence, prior, calibration).pCorrect;
      const decision: GateDecision = {
        decision: "offer",
        reason: "hash-matched subtitle available, swapped timing unverified",
        bindingRule: "swap-unverified",
        pCorrect,
        transform: IDENTITY,
      };
      return { decision, candidate: IDENTITY, subSwap: swapOut, evidence, tiersRun };
    }
    const swapCtx: PipelineContext = { ...ctx, cues: resolved.cues, cueText: resolved.cueText };
    const swapQuality = await measureQuality(swapCtx, IDENTITY, validationRequest);
    const decision = await gateFor(IDENTITY, "exact-file-hash", true, {
      qualityAfter: swapQuality,
      requireImprovement: true,
    });
    return { decision, candidate: IDENTITY, subSwap: swapOut, evidence, tiersRun };
  };

  if (ports.hashExact) {
    const h = await ports.hashExact(ctx);
    if (h) {
      tiersRun.push("hash_exact");
      evidence.push(signal("hash_exact", h.rawScore, true, opts));
      let out: PipelineOutcome;
      if (h.subSwap) {
        out = await gateSubSwap(h.subSwap);
      } else {
        const decision = await gateFor(h.transform, "exact-file-hash", true);
        out = { decision, candidate: h.transform, evidence, tiersRun };
      }
      keep(out);
      if (h.subSwap) return out;
      if (out.decision.decision === "apply") return out;
    }
  }

  if (ports.crowdDb) {
    const c = await ports.crowdDb(ctx);
    if (c && c.verified) {
      tiersRun.push("crowd_db");
      evidence.push(
        signal("crowd_db", c.rawScore, true, opts, {
          reliability: crowdReliability(c),
          crowdTier: c.tier,
        }),
      );
      const decision = await gateFor(c.transform, "structural", c.tier === "A");
      const out: PipelineOutcome = { decision, candidate: c.transform, evidence, tiersRun };
      keep(out);
      if (decision.decision === "apply") return out;
    }
  }

  let consensusRes: ConsensusResult | null = null;
  let consensusEvidencePushed = false;
  if (ports.consensus) {
    consensusRes = await consensusP;
    if (consensusRes) {
      tiersRun.push("consensus");
      if (consensusRes.verdict === "wrong") {
        evidence.push(consensusSignal(consensusRes, null));
        const out = wrongContentOutcome(
          consensusRes,
          fusedConfidence(evidence, prior, calibration).pCorrect,
          evidence,
          tiersRun,
        );
        keep(out);
        if (!opts.tryHarder) return out;
      }
    }
  }

  // Audio verification is mandatory for structural changes. If the first
  // independent seek has already timed out (or cannot extract audio), running
  // VAD, ASR and another validation against that same remote source merely
  // stacks more network delays. Preserve any verified earlier result, but do
  // not synthesize or apply a timing correction without measured audio.
  if (ctx.sourceKind === "http" || ctx.sourceKind === "hls" || ctx.sourceKind === "debrid") {
    const baseline = await qualityBeforeP;
    if (
      baseline.status === "unknown" &&
      (baseline.reason === "timeout" ||
        baseline.reason === "audio-unavailable" ||
        baseline.reason === "ffmpeg-unavailable")
    ) {
      if (best.decision.decision === "offer" || best.decision.decision === "apply") {
        return best;
      }

      // Strong agreement between independently sourced subtitle timings can
      // suggest an offset, but cannot prove the actual movie audio matches
      // those timings. Only expose this as a user-confirmed, unverified offer.
      // Never auto-apply it, even when structural auto-apply is enabled.
      if (consensusRes?.verdict === "right" && consensusRes.agreement >= 0.75) {
        const fit = consensusAnchorFit(consensusRes);
        if (fit) {
          const offsetValid = Math.abs(fit.offsetSec) <= bounds.hardOffsetCapSec;
          const ratioValid = Math.abs(fit.ratio - 1) <= bounds.maxFramerateDev;
          const noChange = Math.abs(fit.offsetSec) < 0.25 && Math.abs(fit.ratio - 1) < 0.001;
          const canRewrite =
            ctx.subtitleFormat === "srt" ||
            ctx.subtitleFormat === "vtt" ||
            ((ctx.subtitleFormat === "ass" || ctx.subtitleFormat === "ssa") &&
              Math.abs(fit.ratio - 1) < 0.000001);
          if (offsetValid && ratioValid && !noChange && canRewrite && !metaVerdict?.hardRefuse) {
            const transform: SyncTransform = {
              kind: "affine",
              offsetSec: fit.offsetSec,
              ratio: fit.ratio,
            };
            return {
              candidate: transform,
              decision: {
                decision: "offer",
                reason: "Matching subtitle files suggest this timing, but video audio could not be verified.",
                bindingRule: "consensus-audio-unverified",
                pCorrect: 0.5,
                transform,
              },
              evidence,
              tiersRun,
              bestEffort: true,
            };
          }
        }
      }
      return {
        ...best,
        candidate: null,
        decision: {
          ...best.decision,
          decision: "refuse",
          reason: `pre-sync quality is unknown (${baseline.reason}), so remote audio verification could not finish`,
          bindingRule: "quality-measurement",
        },
      };
    }
  }

  if (consensusRes && consensusRes.verdict === "right") {
    const fastFit = consensusAnchorFit(consensusRes);
    if (fastFit) {
      const fastT: SyncTransform = {
        kind: "affine",
        offsetSec: fastFit.offsetSec,
        ratio: fastFit.ratio,
      };
      evidence.push(consensusSignal(consensusRes, fastT));
      consensusEvidencePushed = true;
      const fastBefore = await qualityBeforeP;
      const fastAfter = await measureQuality(ctx, fastT, validationRequest);
      let decision = enforceMetadataHardRefuse(
        await gateFor(fastT, "structural", false, {
          qualityBefore: fastBefore,
          qualityAfter: fastAfter,
        }),
        fastT,
        metaVerdict,
      );
      let bestEffort = false;
      if (decision.decision !== "apply" && !metaVerdict?.hardRefuse) {
        const be = evaluateBestEffort({
          transform: fastT,
          confidence: fusedConfidence(evidence, prior, calibration),
          qualityBefore: fastBefore,
          qualityAfter: fastAfter,
          bounds,
          exactIdentity: false,
          candidateKind: "structural",
          calibrationReady,
          structuralAutoApplyEnabled: opts.allowStructuralAutoApply === true,
          subtitleFormat: ctx.subtitleFormat ?? "unknown",
          inputAlreadyGood: isAlreadyGood(fastBefore),
        });
        if (be.decision === "offer" && outcomeRank(be.decision) >= outcomeRank(decision.decision)) {
          decision = be;
          bestEffort = true;
        }
      }
      const out: PipelineOutcome = { decision, candidate: fastT, evidence, tiersRun, bestEffort };
      keep(out);
      if (decision.decision === "apply") {
        return out;
      }
    }
  }

  let lead: SyncTransform | null = null;
  let leadNcc = 0;
  let leadFitWindowIds: string[] | undefined;
  if (ports.vadAffine) {
    const v = await ports.vadAffine(ctx, windowPolicy(ctx.sourceKind, opts.tryHarder === true));
    if (v) {
      tiersRun.push("vad_affine");
      evidence.push(signal("vad_affine", v.rawScore, v.quality.ncc >= 0.55, opts));
      lead = v.transform;
      leadNcc = v.quality.ncc;
      leadFitWindowIds = v.fitWindowIds;
      if (ports.vadPiecewise && needsPiecewise(v)) {
        const p = await ports.vadPiecewise(ctx, v.transform);
        if (p) {
          tiersRun.push("vad_piecewise");
          evidence.push(signal("vad_piecewise", p.rawScore, p.quality.ncc >= 0.55, opts));
          if (p.quality.ncc > v.quality.ncc) {
            lead = p.transform;
            leadNcc = p.quality.ncc;
            leadFitWindowIds = p.fitWindowIds;
          }
        }
      }
    }
  }

  if (consensusRes && consensusRes.verdict !== "wrong" && !consensusEvidencePushed) {
    evidence.push(consensusSignal(consensusRes, lead));
  }

  if (ctx.cues.length > 0) {
    tiersRun.push("metadata_prior");
    if (metaVerdict) evidence.push(metadataEvidence(metaVerdict));
  }

  let asrWordMatch: number | undefined;
  if (lead && ports.asrMatch && shouldRunAsr(evidence, ctx, opts, metaVerdict)) {
    const a = await ports.asrMatch(ctx, lead);
    if (a) {
      tiersRun.push("asr_match");
      asrWordMatch = a.wordMatch;
      evidence.push(
        signal("asr_match", a.supportsTransform, a.wordMatch >= 0.2, opts, {
          supportsWrong: 1 - a.wordMatch,
        }),
      );
    }
  }

  if (lead) {
    const request: QualityMeasurementRequest = {
      purpose: "validation",
      excludeWindowIds: leadFitWindowIds,
    };
    const leadBefore =
      ctx.sourceKind === "torrent" || leadFitWindowIds?.length
        ? await measureQuality(ctx, IDENTITY, request)
        : await qualityBeforeP;
    let decision = await gateFor(lead, "structural", false, {
      asrWordMatch,
      qualityBefore: leadBefore,
      fitWindowIds: leadFitWindowIds,
    });
    decision = enforceMetadataHardRefuse(decision, lead, metaVerdict);
    keep({ decision, candidate: lead, evidence, tiersRun });
  }

  // Escalation can only reproduce these vetoes, so ASR would just delay the answer.
  const settledVeto =
    best.decision.bindingRule === "already-good" ||
    best.decision.bindingRule === "metadata-hard-refuse";
  if (
    !settledVeto &&
    best.decision.decision !== "apply" &&
    !best.subSwap &&
    (opts.tryHarder || !!ports.asrTranscribe)
  ) {
    const escalationBefore = await qualityBeforeP;
    const esc = await escalateTryHarder({
      ctx,
      ports,
      lead,
      leadNcc,
      consensus: consensusRes,
      bounds,
      qualityBefore: escalationBefore,
      inputAlreadyGood: isAlreadyGood(escalationBefore),
      wrongContentReason: metaVerdict?.hardRefuse
        ? `wrong content: ${metaVerdict.reasons[0] ?? "metadata hard refuse"}`
        : undefined,
      evidence,
      tiersRun,
      calibrationReady,
      structuralAutoApplyEnabled: opts.allowStructuralAutoApply === true,
      subtitleFormat: ctx.subtitleFormat ?? "unknown",
    });
    if (esc) {
      if (
        esc.decision.decision === "refuse" &&
        GLOBAL_ESCALATION_VETOES.has(esc.decision.bindingRule)
      ) {
        return esc;
      }
      keep(esc);
    }
  }

  if (best.candidate === null && best.decision.bindingRule === "default") {
    const before = await qualityBeforeP;
    // No offset candidate is not proof of misalignment. A trusted held-out
    // score may instead establish that the subtitles are already correct.
    if (
      before.status === "measured" &&
      before.validation?.kind === "held-out" &&
      before.value.ncc >= THRESHOLDS.alreadyGoodNcc &&
      before.value.coverage >= THRESHOLDS.minCoverage &&
      before.value.z >= 6
    ) {
      return {
        ...best,
        decision: {
          ...best.decision,
          reason: "The subtitles are already aligned to the detected speech.",
          bindingRule: "already-good",
        },
      };
    }
    // A missing audio measurement and a measured but weak match require
    // different next steps. Neither justifies fabricating an offset.
    const notes = ports.diagnosticNotes?.() ?? [];
    const speechModelUnavailable = notes.includes("asr:model-unavailable");
    const vadLowConfidence = notes.some((note) => note.startsWith("vad:low-confidence"));
    const reason =
      before.status === "unknown" && vadLowConfidence
        ? "Audio was analyzed, but speech did not align reliably with this subtitle. The timing could not be verified. Try another subtitle release, Sync from playback, or Manual offset."
        : before.status === "unknown"
          ? `No reliable offset was found, and audio verification was unavailable (${before.reason}). Try another playable source or Manual offset.`
        : vadLowConfidence
          ? "The detected speech did not match the subtitle timing reliably. Try a subtitle for this release or another audio track."
          : "Audio analysis and subtitle comparison did not establish a reliable offset. Try a different subtitle release or a scene with clear dialogue.";
    const suffix = speechModelUnavailable
      ? " Speech recognition is unavailable in this build."
      : "";
    return { ...best, decision: { ...best.decision, reason: reason + suffix, bindingRule: "no-candidate" } };

  }

  return best;
}
