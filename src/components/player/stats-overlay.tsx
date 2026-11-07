import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Check } from "lucide-react";
import type { PlayerSnapshot, TrackInfo } from "@/lib/player/bridge";
import type { EngineStats } from "@/lib/torrent/engine-stats";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type VoPass = {
  desc: string;
  last: number;
  avg: number;
  peak: number;
  count?: number;
};

type VoPassesData = {
  fresh?: VoPass[];
  redraw?: VoPass[];
};

function parseStringProp(val: unknown, fallback = ""): string {
  if (val == null) return fallback;
  if (typeof val === "string") return val.trim() || fallback;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) {
    const list = val.map((x) => parseStringProp(x)).filter(Boolean);
    return list.length > 0 ? list.join(", ") : fallback;
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.current === "string" && obj.current) return obj.current;
    if (typeof obj.name === "string" && obj.name) return obj.name;
    if (typeof obj.value === "string" && obj.value) return obj.value;
    if (typeof obj.id === "string" && obj.id) return obj.id;
    for (const v of Object.values(obj)) {
      if (typeof v === "string" && v) return v;
    }
    return fallback;
  }
  return fallback;
}

function parseFilterList(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const entry = item as Record<string, unknown>;
          const name = typeof entry.name === "string" ? entry.name : "";
          if (!name) return "";
          const label = typeof entry.label === "string" && entry.label ? `@${entry.label}: ` : "";
          const disabled = entry.enabled === false ? " (disabled)" : "";
          let params = "";
          if (entry.params && typeof entry.params === "object") {
            const pPairs = Object.entries(entry.params)
              .map(([k, v]) => (v != null && v !== "" ? `${k}=${v}` : k))
              .join(" ");
            if (pPairs) params = ` [${pPairs}]`;
          }
          return `${label}${name}${disabled}${params}`;
        }
        return String(item).trim();
      })
      .filter((s) => s.length > 0);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
  }
  return [];
}

type MpvOverviewStats = {
  // File & Stream
  mediaTitle: string | null;
  chapter: string | null;
  fileSize: number | null;
  fileFormat: string | null;
  demuxerCacheDuration: number | null;
  demuxerCacheBytes: number | null;

  // Active Video Enhancements (Organized inside Video Section)
  sharpen: number | null;
  deband: boolean | null;
  debandIterations: number | null;
  debandThreshold: number | null;
  interpolation: boolean | null;
  tscale: string | null;
  toneMapping: string | null;
  videoFilters: unknown;
  audioFilters: unknown;
  vapoursynthActive: boolean;

  // Display & Output
  currentVo: string | null;
  gpuContext: string | null;
  displayNames: string | null;
  displayFps: number | null;
  hwdec: string | null;
  avsync: number | null;
  decoderDrops: number | null;
  outputDrops: number | null;
  freshTimingSummary: string | null;
  redrawTimingSummary: string | null;
  outW: number | null;
  outH: number | null;
  outAspect: string | null;
  outFormat: string | null;
  outLevels: string | null;
  outColormatrix: string | null;
  outPrimaries: string | null;
  outTransfer: string | null;

  // HDR10 & Dolby Vision Metadata
  targetPeak: number | null;
  maxCll: number | null;
  maxFall: number | null;
  minLuma: number | null;
  maxLuma: number | null;
  sigPeak: number | null;
  doviProfile: string | null;
  doviLevel: string | null;
  doviRpu: boolean | null;

  // Video Stream
  videoCodec: string | null;
  videoFormat: string | null;
  estimatedFps: number | null;
  containerFps: number | null;
  srcW: number | null;
  srcH: number | null;
  srcAspect: string | null;
  pixelFormat: string | null;
  colorLevels: string | null;
  chromaLocation: string | null;
  colormatrix: string | null;
  primaries: string | null;
  gamma: string | null;
  videoBitrate: number | null;

  // Audio Stream
  audioCodec: string | null;
  audioFormat: string | null;
  currentAo: string | null;
  audioDevice: string | null;
  aoVolume: number | null;
  audioChannels: string | null;
  audioInFormat: string | null;
  audioOutFormat: string | null;
  audioSampleRate: number | null;
  audioBitrate: number | null;

  // Cache Page
  cacheBufferingState: number | null;
  demuxerCacheTime: number | null;
  cacheSpeed: number | null;

  // Shaders Page
  voPasses: VoPassesData | null;
  glslShaders: string | string[] | null;

  // Scripts Page
  scriptList: Array<{ name: string; path?: string }> | null;
};

const EMPTY_STATS: MpvOverviewStats = {
  mediaTitle: null,
  chapter: null,
  fileSize: null,
  fileFormat: null,
  demuxerCacheDuration: null,
  demuxerCacheBytes: null,

  sharpen: null,
  deband: null,
  debandIterations: null,
  debandThreshold: null,
  interpolation: null,
  tscale: null,
  toneMapping: null,
  videoFilters: null,
  audioFilters: null,
  vapoursynthActive: false,

  currentVo: null,
  gpuContext: null,
  displayNames: null,
  displayFps: null,
  hwdec: null,
  avsync: null,
  decoderDrops: null,
  outputDrops: null,
  freshTimingSummary: null,
  redrawTimingSummary: null,
  outW: null,
  outH: null,
  outAspect: null,
  outFormat: null,
  outLevels: null,
  outColormatrix: null,
  outPrimaries: null,
  outTransfer: null,

  targetPeak: null,
  maxCll: null,
  maxFall: null,
  minLuma: null,
  maxLuma: null,
  sigPeak: null,
  doviProfile: null,
  doviLevel: null,
  doviRpu: null,

  videoCodec: null,
  videoFormat: null,
  estimatedFps: null,
  containerFps: null,
  srcW: null,
  srcH: null,
  srcAspect: null,
  pixelFormat: null,
  colorLevels: null,
  chromaLocation: null,
  colormatrix: null,
  primaries: null,
  gamma: null,
  videoBitrate: null,

  audioCodec: null,
  audioFormat: null,
  currentAo: null,
  audioDevice: null,
  aoVolume: null,
  audioChannels: null,
  audioInFormat: null,
  audioOutFormat: null,
  audioSampleRate: null,
  audioBitrate: null,

  cacheBufferingState: null,
  demuxerCacheTime: null,
  cacheSpeed: null,

  voPasses: null,
  scriptList: null,
  glslShaders: null,
};

async function getProp<T = unknown>(name: string): Promise<T | null> {
  if (!isTauri) return null;
  try {
    const v = await invoke<T>("mpv_get_property", { name });
    return v ?? null;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function formatBitrate(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return "—";
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} kbps`;
  return `${bps.toFixed(0)} bps`;
}

function fmtSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 ** 2) return `${(bytesPerSec / 1024 ** 2).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

// -------------------------------------------------------------
// SELECTIVE HEALTH COLOR HELPERS (Green = OK, Orange = Warning, Red = Severe)
// -------------------------------------------------------------
function avSyncColor(av: number | null): string {
  if (av == null) return "text-ink";
  const abs = Math.abs(av);
  if (abs <= 0.04) return "text-emerald-400"; // <= 40ms: healthy
  if (abs <= 0.15) return "text-amber-400"; // 40-150ms: moderate jitter
  return "text-rose-400"; // > 150ms: severe desync
}

function dropColor(drops: number | null): string {
  if (drops == null || drops === 0) return "text-emerald-400"; // 0 drops: perfect
  if (drops <= 5) return "text-amber-400"; // minor drop glitch
  return "text-rose-400"; // severe dropping
}

function fpsColor(estimated: number | null, container: number | null): string {
  if (estimated == null || container == null) return "text-ink";
  const diff = container - estimated;
  if (diff <= 0.5) return "text-emerald-400";
  if (diff <= 2.0) return "text-amber-400";
  return "text-rose-400";
}

function cacheDurationColor(durationSec: number | null): string {
  if (durationSec == null) return "text-ink";
  if (durationSec >= 10) return "text-emerald-400";
  if (durationSec >= 3) return "text-amber-400";
  return "text-rose-400";
}

export function StatsOverlay({
  snap,
  engine,
  page = 1,
  onPageChange,
  onClose,
  engineStats,
}: {
  snap: PlayerSnapshot;
  engine: "html5" | "mpv";
  page?: 1 | 2 | 3 | 4 | 5;
  onPageChange?: (page: 1 | 2 | 3 | 4 | 5) => void;
  onClose?: () => void;
  engineStats?: EngineStats | null;
}) {
  const tr = useT();
  const { settings } = useSettings();
  const [stats, setStats] = useState<MpvOverviewStats>(EMPTY_STATS);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isDetailed = Boolean(settings.mpvDetailedStats && engine === "mpv");

  // Keyboard Up/Down scrolling for long shader / tracks / scripts lists
  useEffect(() => {
    if (!isDetailed || (page !== 2 && page !== 4 && page !== 5)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollRef.current?.scrollBy({ top: -45, behavior: "smooth" });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollRef.current?.scrollBy({ top: 45, behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDetailed, page]);

  useEffect(() => {
    if (engine !== "mpv") return;
    let cancelled = false;

    const tick = async () => {
      if (!isDetailed) {
        // Simple brief stats query
        const [vb, ab, fdd, fdo, fps, vc, ac, hw, cfps, cb] = await Promise.all([
          getProp<number>("video-bitrate"),
          getProp<number>("audio-bitrate"),
          getProp<number>("decoder-frame-drop-count"),
          getProp<number>("frame-drop-count"),
          getProp<number>("estimated-vf-fps"),
          getProp<string>("video-codec"),
          getProp<string>("audio-codec"),
          getProp<string>("hwdec-current"),
          getProp<number>("container-fps"),
          getProp<number>("cache-buffering-state"),
        ]);
        if (cancelled) return;
        setStats((prev) => ({
          ...prev,
          videoBitrate: vb,
          audioBitrate: ab,
          decoderDrops: fdd,
          outputDrops: fdo,
          estimatedFps: fps,
          videoCodec: vc,
          audioCodec: ac,
          hwdec: hw,
          containerFps: cfps,
          cacheBufferingState: cb,
        }));
        return;
      }

      // Detailed Mode - Page 1: Comprehensive Media & Display Overview
      if (page === 1) {
        const [
          title,
          fsize,
          fformat,
          dcd,
          cvo,
          hw,
          av,
          fdd,
          fdo,
          vtpW,
          vtpH,
          vtpAsp,
          vtpPf,
          vtpCl,
          vtpCm,
          vtpPr,
          vtpTrf,
          gpuCtx,
          ow,
          oh,
          oasp,
          opf,
          olv,
          ocm,
          opr,
          otr,
          vc,
          vf,
          fps,
          cfps,
          sw,
          sh,
          sasp,
          spf,
          slv,
          scl,
          scm,
          spr,
          strf,
          vb,
          ac,
          af,
          ao,
          adev,
          ach,
          aif,
          aof,
          asr,
          ab,
          passes,
          dstate,
          sharpenVal,
          debandVal,
          debandIter,
          debandThresh,
          interpVal,
          tscaleVal,
          toneMapVal,
          vfStr,
          rawShaders,
          mcll,
          mfall,
          minL,
          maxL,
          tpeak,
          dfps,
          dnames,
          afStr,
          aVol,
          chap,
          sigPeakVal,
          doviProf,
          doviLvl,
          doviRpuVal,
          altGpuCtx,
          vCodecProf,
        ] = await Promise.all([
          getProp<string>("media-title"),
          getProp<number>("file-size"),
          getProp<string>("file-format"),
          getProp<number>("demuxer-cache-duration"),
          getProp<string>("current-vo"),
          getProp<string>("hwdec-current"),
          getProp<number>("avsync"),
          getProp<number>("decoder-frame-drop-count"),
          getProp<number>("frame-drop-count"),
          getProp<number>("video-target-params/w"),
          getProp<number>("video-target-params/h"),
          getProp<string>("video-target-params/aspect"),
          getProp<string>("video-target-params/pixelformat"),
          getProp<string>("video-target-params/colorlevels"),
          getProp<string>("video-target-params/colormatrix"),
          getProp<string>("video-target-params/primaries"),
          getProp<string>("video-target-params/gamma"),
          getProp<string>("current-gpu-context"),
          getProp<number>("video-out-params/w"),
          getProp<number>("video-out-params/h"),
          getProp<string>("video-out-params/aspect"),
          getProp<string>("video-out-params/pixelformat"),
          getProp<string>("video-out-params/colorlevels"),
          getProp<string>("video-out-params/colormatrix"),
          getProp<string>("video-out-params/primaries"),
          getProp<string>("video-out-params/gamma"),
          getProp<string>("video-codec"),
          getProp<string>("video-format"),
          getProp<number>("estimated-vf-fps"),
          getProp<number>("container-fps"),
          getProp<number>("video-params/w"),
          getProp<number>("video-params/h"),
          getProp<string>("video-params/aspect"),
          getProp<string>("video-params/pixelformat"),
          getProp<string>("video-params/colorlevels"),
          getProp<string>("video-params/chroma-location"),
          getProp<string>("video-params/colormatrix"),
          getProp<string>("video-params/primaries"),
          getProp<string>("video-params/gamma"),
          getProp<number>("video-bitrate"),
          getProp<string>("audio-codec"),
          getProp<string>("audio-format"),
          getProp<string>("current-ao"),
          getProp<string>("audio-device"),
          getProp<string>("audio-params/channels"),
          getProp<string>("audio-params/format"),
          getProp<string>("audio-out-params/format"),
          getProp<number>("audio-params/samplerate"),
          getProp<number>("audio-bitrate"),
          getProp<VoPassesData>("vo-passes"),
          getProp<Record<string, unknown>>("demuxer-cache-state"),
          getProp<number | string>("sharpen"),
          getProp<string | boolean>("deband"),
          getProp<number>("deband-iterations"),
          getProp<number>("deband-threshold"),
          getProp<string | boolean>("interpolation"),
          getProp<string>("tscale"),
          getProp<string>("tone-mapping"),
          getProp<string>("vf"),
          getProp<string | string[]>("glsl-shaders"),
          getProp<number>("video-params/max-cll"),
          getProp<number>("video-params/max-fall"),
          getProp<number>("video-params/min-luma"),
          getProp<number>("video-params/max-luma"),
          getProp<number>("target-peak"),
          getProp<number>("display-fps"),
          getProp<string>("display-names"),
          getProp<string>("af"),
          getProp<number>("ao-volume"),
          getProp<string>("chapter-metadata/title"),
          getProp<number>("video-params/sig-peak"),
          getProp<string>("video-params/dovi-profile"),
          getProp<string>("video-params/dovi-level"),
          getProp<boolean>("video-params/dovi-rpu-present"),
          getProp<unknown>("gpu-context"),
          getProp<string>("video-codec-profile"),
        ]);
        if (cancelled) return;

        // Calculate fresh and redraw summary in μs if passes present
        let freshSum: string | null = null;
        let redrawSum: string | null = null;
        if (passes?.fresh && Array.isArray(passes.fresh) && passes.fresh.length > 0) {
          const lastTotal = Math.round(
            passes.fresh.reduce((acc, p) => acc + (p.last || 0), 0) / 1000,
          );
          const avgTotal = Math.round(
            passes.fresh.reduce((acc, p) => acc + (p.avg || 0), 0) / 1000,
          );
          const peakTotal = Math.round(
            passes.fresh.reduce((acc, p) => acc + (p.peak || 0), 0) / 1000,
          );
          freshSum = `${lastTotal} / ${avgTotal} / ${peakTotal}`;
        }
        if (passes?.redraw && Array.isArray(passes.redraw) && passes.redraw.length > 0) {
          const lastTotal = Math.round(
            passes.redraw.reduce((acc, p) => acc + (p.last || 0), 0) / 1000,
          );
          const avgTotal = Math.round(
            passes.redraw.reduce((acc, p) => acc + (p.avg || 0), 0) / 1000,
          );
          const peakTotal = Math.round(
            passes.redraw.reduce((acc, p) => acc + (p.peak || 0), 0) / 1000,
          );
          redrawSum = `${lastTotal} / ${avgTotal} / ${peakTotal}`;
        }

        const cacheBytes =
          typeof dstate?.["total-bytes"] === "number"
            ? (dstate["total-bytes"] as number)
            : typeof dstate?.["fw-bytes"] === "number"
              ? (dstate["fw-bytes"] as number)
              : null;

        const numSharpen =
          typeof sharpenVal === "number"
            ? sharpenVal
            : typeof sharpenVal === "string"
              ? parseFloat(sharpenVal)
              : null;
        const isDeband = debandVal === true || debandVal === "yes";
        const isInterp = interpVal === true || interpVal === "yes";
        const isVapourSynth = JSON.stringify(vfStr ?? "")
          .toLowerCase()
          .includes("vapoursynth");

        const contextStr = parseStringProp(gpuCtx) || parseStringProp(altGpuCtx, "d3d11");
        const isDoviProfile = doviProf != null && String(doviProf).trim().length > 0;
        const codecProfLower = String(vCodecProf || "").toLowerCase();
        const isDoviCodec =
          codecProfLower.includes("dolby vision") ||
          codecProfLower.includes("dovi") ||
          codecProfLower.includes("dvhe") ||
          codecProfLower.includes("dvh1");
        let detectedDovi = isDoviProfile ? `Profile ${doviProf}` : null;
        if (!detectedDovi && isDoviCodec) {
          const match = String(vCodecProf).match(
            /(?:profile|dv|dovi|dvhe\.|dvh1\.)\s*([0-9]+(?:\.[0-9]+)?)/i,
          );
          detectedDovi = match ? `Profile ${match[1]}` : String(vCodecProf);
        }

        setStats((prev) => ({
          ...prev,
          mediaTitle: title,
          chapter: chap,
          fileSize: fsize,
          fileFormat: fformat,
          demuxerCacheDuration: dcd,
          demuxerCacheBytes: cacheBytes,
          sharpen:
            Number.isFinite(numSharpen) && (numSharpen as number) > 0
              ? (numSharpen as number)
              : null,
          deband: isDeband,
          debandIterations: debandIter,
          debandThreshold: debandThresh,
          interpolation: isInterp,
          tscale: tscaleVal,
          toneMapping:
            toneMapVal && toneMapVal !== "auto" && toneMapVal !== "no" ? toneMapVal : null,
          videoFilters: vfStr,
          audioFilters: afStr,
          vapoursynthActive: isVapourSynth,
          currentVo: cvo,
          hwdec: hw,
          avsync: av,
          decoderDrops: fdd,
          outputDrops: fdo,
          freshTimingSummary: freshSum,
          redrawTimingSummary: redrawSum,
          outW: vtpW || ow,
          outH: vtpH || oh,
          outAspect: vtpAsp || oasp,
          outFormat: vtpPf || opf,
          outLevels: vtpCl || olv,
          outColormatrix: vtpCm || ocm,
          outPrimaries: vtpPr || opr,
          outTransfer: vtpTrf || otr,
          gpuContext: contextStr,
          targetPeak: tpeak,
          maxCll: mcll,
          maxFall: mfall,
          minLuma: minL,
          maxLuma: maxL,
          sigPeak: sigPeakVal,
          doviProfile: detectedDovi,
          doviLevel: doviLvl ? String(doviLvl) : null,
          doviRpu: doviRpuVal === true,
          displayFps: dfps,
          displayNames: dnames,
          videoCodec: vc,
          videoFormat: vf,
          estimatedFps: fps,
          containerFps: cfps,
          srcW: sw,
          srcH: sh,
          srcAspect: sasp,
          pixelFormat: spf,
          colorLevels: slv,
          chromaLocation: scl,
          colormatrix: scm,
          primaries: spr,
          gamma: strf,
          videoBitrate: vb,
          audioCodec: ac,
          audioFormat: af,
          currentAo: ao,
          audioDevice: adev,
          aoVolume: aVol,
          audioChannels: ach,
          audioInFormat: aif,
          audioOutFormat: aof,
          audioSampleRate: asr,
          audioBitrate: ab,
          glslShaders: rawShaders,
        }));
      }

      // Detailed Mode - Page 2: Shaders & Extended Frame Timings
      else if (page === 2) {
        const [passes, shaders] = await Promise.all([
          getProp<VoPassesData>("vo-passes"),
          getProp<string | string[]>("glsl-shaders"),
        ]);
        if (cancelled) return;
        setStats((prev) => ({
          ...prev,
          voPasses: passes,
          glslShaders: shaders,
        }));
      }

      // Detailed Mode - Page 3: Demuxer Cache Statistics
      else if (page === 3) {
        const [cb, dcd, dct, cs, dstate] = await Promise.all([
          getProp<number>("cache-buffering-state"),
          getProp<number>("demuxer-cache-duration"),
          getProp<number>("demuxer-cache-time"),
          getProp<number>("cache-speed"),
          getProp<Record<string, unknown>>("demuxer-cache-state"),
        ]);
        if (cancelled) return;
        const cacheBytes =
          typeof dstate?.["total-bytes"] === "number" ? (dstate["total-bytes"] as number) : null;
        setStats((prev) => ({
          ...prev,
          cacheBufferingState: cb,
          demuxerCacheDuration: dcd,
          demuxerCacheTime: dct,
          cacheSpeed: cs,
          demuxerCacheBytes: cacheBytes,
        }));
      }

      // Detailed Mode - Page 4: Tracks (Uses live snapshot tracks)

      // Detailed Mode - Page 5: Scripts Log & External Profiler
      else if (page === 5) {
        const [rawSlist, shaders] = await Promise.all([
          getProp<unknown>("script-list"),
          getProp<string | string[]>("glsl-shaders"),
        ]);
        if (cancelled) return;
        let parsedScripts: Array<{ name: string; path?: string }> | null = null;
        if (Array.isArray(rawSlist)) {
          parsedScripts = rawSlist;
        } else if (typeof rawSlist === "string") {
          try {
            const p = JSON.parse(rawSlist);
            if (Array.isArray(p)) parsedScripts = p;
          } catch {}
        }
        setStats((prev) => ({
          ...prev,
          scriptList: parsedScripts,
          glslShaders: shaders,
        }));
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [engine, isDetailed, page]);

  // Brief View (When mpvDetailedStats is OFF or on HTML5 engine)
  if (!isDetailed) {
    const audioTrack = snap.audioTracks.find((t) => t.selected) ?? null;
    const subTrack = snap.subtitleTracks.find((t) => t.selected) ?? null;
    const fps = stats.estimatedFps ?? stats.containerFps;

    const rows: Array<[string, string]> = [];
    rows.push([tr("Engine"), engine === "mpv" ? "libmpv" : "HTML5"]);
    rows.push([
      tr("Resolution"),
      snap.videoWidth && snap.videoHeight ? `${snap.videoWidth}×${snap.videoHeight}` : "—",
    ]);
    if (fps != null) rows.push([tr("Frame rate"), `${fps.toFixed(2)} fps`]);
    if (stats.videoCodec) rows.push([tr("Video codec"), stats.videoCodec]);
    if (stats.audioCodec) rows.push([tr("Audio codec"), stats.audioCodec]);
    if (stats.hwdec) rows.push([tr("HW decode"), stats.hwdec]);
    if (stats.videoBitrate != null)
      rows.push([tr("Video bitrate"), formatBitrate(stats.videoBitrate)]);
    if (stats.audioBitrate != null)
      rows.push([tr("Audio bitrate"), formatBitrate(stats.audioBitrate)]);
    if (stats.decoderDrops != null || stats.outputDrops != null)
      rows.push([
        tr("Dropped (decode / vo)"),
        `${stats.decoderDrops ?? "—"} / ${stats.outputDrops ?? "—"}`,
      ]);
    if (stats.cacheBufferingState != null)
      rows.push([tr("Cache buffering"), `${stats.cacheBufferingState.toFixed(0)}%`]);
    rows.push([
      tr("Audio track"),
      audioTrack ? audioTrack.title || audioTrack.lang || audioTrack.id : "—",
    ]);
    rows.push([
      tr("Subtitle track"),
      subTrack ? subTrack.title || subTrack.lang || subTrack.id : tr("Off"),
    ]);
    rows.push([tr("Speed"), `${snap.rate.toFixed(2)}×`]);
    rows.push([
      tr("Volume"),
      `${Math.round(snap.volume * 100)}%${snap.muted ? tr(" · muted") : ""}`,
    ]);

    return (
      <div className="pointer-events-none absolute start-6 top-20 z-20 max-w-[320px] animate-fade-in rounded-2xl border border-edge-soft bg-canvas/85 p-4 font-mono text-[11.5px] leading-relaxed text-ink shadow-[0_18px_50px_-15px_rgba(0,0,0,0.7)] backdrop-blur-md">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-ink-subtle">
          {tr("Playback stats · press I to hide")}
        </p>
        <dl className="flex flex-col gap-0.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-muted">{k}</dt>
              <dd className="truncate text-end">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  // 5-PAGE ADVANCED TECHNICAL HUD (Clean Boxed Layout with Harbor Styling)
  const TABS: Array<{ id: 1 | 2 | 3 | 4 | 5; label: string }> = [
    { id: 1, label: tr("Overview") },
    { id: 2, label: tr("Shaders") },
    { id: 3, label: tr("Cache") },
    { id: 4, label: tr("Tracks") },
    { id: 5, label: tr("Scripts") },
  ];

  return (
    <div className="pointer-events-auto absolute start-6 top-16 z-20 w-[460px] max-w-[calc(100vw-48px)] animate-fade-in select-none rounded-2xl border border-edge-soft bg-canvas/92 p-4 font-mono text-[10.5px] leading-relaxed text-ink shadow-[0_24px_70px_-15px_rgba(0,0,0,0.85)] backdrop-blur-md">
      {/* Top Tab Bar */}
      <div className="mb-2.5 flex items-center justify-between border-b border-edge-soft/60 pb-2">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => {
            const active = page === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onPageChange?.(tab.id)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  active
                    ? "bg-accent/20 text-accent ring-1 ring-accent/40"
                    : "text-ink-muted hover:bg-surface/80 hover:text-ink"
                }`}
              >
                <span className="opacity-60">{tab.id}:</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-surface hover:text-ink"
            aria-label={tr("Close stats")}
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* Viewport for Pages */}
      <div ref={scrollRef} className="max-h-[380px] overflow-y-auto pr-1">
        {page === 1 && <PageOverview snap={snap} stats={stats} tr={tr} />}
        {page === 2 && <PageShaders stats={stats} tr={tr} />}
        {page === 3 && <PageCache stats={stats} engineStats={engineStats} tr={tr} />}
        {page === 4 && <PageTracks snap={snap} tr={tr} />}
        {page === 5 && <PageScripts stats={stats} tr={tr} />}
      </div>

      {/* Footer Navigation Hints */}
      <div className="mt-2.5 flex items-center justify-between border-t border-edge-soft/40 pt-1.5 text-[9.5px] text-ink-subtle">
        <span>
          {page === 2 || page === 4 || page === 5
            ? tr("Press 1–5 to switch · ↑/↓ to scroll")
            : tr("Press 1–5 to switch pages")}
        </span>
        <span>{tr("Press I or Esc to hide")}</span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// BOXED SUB-LAYOUT HELPERS
// -------------------------------------------------------------
function StatCard({
  title,
  children,
  badge,
}: {
  title: string;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-edge-soft/60 bg-surface/35 p-2.5 flex flex-col gap-2">
      <div className="flex items-center justify-between border-b border-edge-soft/30 pb-1 text-[9.5px] font-bold uppercase tracking-wider text-accent/90">
        <span>{title}</span>
        {badge}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function StatRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 border-b border-edge-soft/15 last:border-none">
      <span className="text-ink-muted text-[10px] shrink-0">{label}</span>
      <span className={`truncate text-end font-medium ${valueClass ?? "text-ink"}`}>{value}</span>
    </div>
  );
}

function ColorPipelineGrid({
  matrix,
  primaries,
  transfer,
}: {
  matrix: string | null;
  primaries: string | null;
  transfer: string | null;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-surface/60 p-2 border border-edge-soft/40">
      <div className="flex flex-col">
        <span className="text-[8.5px] uppercase tracking-wider text-ink-subtle">Colormatrix</span>
        <span className="truncate text-[10.5px] font-mono font-medium text-ink">
          {matrix || "—"}
        </span>
      </div>
      <div className="flex flex-col border-l border-edge-soft/40 pl-2">
        <span className="text-[8.5px] uppercase tracking-wider text-ink-subtle">Primaries</span>
        <span className="truncate text-[10.5px] font-mono font-medium text-ink">
          {primaries || "—"}
        </span>
      </div>
      <div className="flex flex-col border-l border-edge-soft/40 pl-2">
        <span className="text-[8.5px] uppercase tracking-wider text-ink-subtle">Transfer</span>
        <span className="truncate text-[10.5px] font-mono font-medium text-ink">
          {transfer || "—"}
        </span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// PAGE 1: FULL TECHNICAL OVERVIEW (Matching MPV stats.lua structure)
// -------------------------------------------------------------
function PageOverview({
  snap,
  stats,
  tr,
}: {
  snap: PlayerSnapshot;
  stats: MpvOverviewStats;
  tr: ReturnType<typeof useT>;
}) {
  const fps = stats.estimatedFps ?? stats.containerFps;
  const isHw = Boolean(stats.hwdec && stats.hwdec !== "no");
  const cacheSec =
    stats.demuxerCacheDuration != null ? `${stats.demuxerCacheDuration.toFixed(1)}s` : null;
  const cacheBytes = formatBytes(stats.demuxerCacheBytes);
  const cacheInfo =
    cacheBytes !== "—" ? `${cacheBytes}${cacheSec ? ` (${cacheSec})` : ""}` : (cacheSec ?? "—");

  // Check active video filters & processing (Displayed inside Video Stream)
  const hasSharpen = stats.sharpen != null && stats.sharpen > 0;
  const hasDeband = stats.deband === true;
  const hasVapourSynth = stats.vapoursynthActive;
  const hasInterpolation = stats.interpolation === true;
  const hasToneMapping = Boolean(stats.toneMapping);

  const activeCustomVf = parseFilterList(stats.videoFilters).filter(
    (f) => !f.toLowerCase().includes("anime4k") && !f.toLowerCase().includes("vapoursynth"),
  );

  const rawShaders = stats.glslShaders;
  const activeShaders: string[] = Array.isArray(rawShaders)
    ? (rawShaders as string[])
    : typeof rawShaders === "string"
      ? (rawShaders as string)
          .split(/[;,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const hasVideoFilters =
    hasSharpen ||
    hasDeband ||
    hasVapourSynth ||
    hasInterpolation ||
    hasToneMapping ||
    activeShaders.length > 0 ||
    activeCustomVf.length > 0;

  // Check active audio filters (Displayed inside Audio Stream)
  const activeCustomAf = parseFilterList(stats.audioFilters);
  const hasAudioFilters = activeCustomAf.length > 0 || snap.audioNormalize;

  // HDR status & metadata
  const hasDovi = Boolean(stats.doviProfile);
  const isHdrOutput =
    hasDovi ||
    stats.outTransfer === "pq" ||
    stats.outTransfer === "hlg" ||
    stats.outPrimaries === "bt.2020" ||
    stats.gamma === "pq" ||
    stats.gamma === "hlg" ||
    (stats.targetPeak != null && stats.targetPeak > 0) ||
    (stats.maxCll != null && stats.maxCll > 0);

  return (
    <div className="flex flex-col gap-2.5">
      {/* File & Source Card */}
      <StatCard title={tr("File & Buffer")}>
        <StatRow label={tr("Title")} value={stats.mediaTitle || "—"} />
        {stats.chapter && <StatRow label={tr("Chapter")} value={stats.chapter} />}
        <StatRow label={tr("File Size")} value={formatBytes(stats.fileSize)} />
        <StatRow label={tr("Format / Protocol")} value={stats.fileFormat ?? "hls / stream"} />
        <StatRow
          label={tr("Demuxer Cache")}
          value={cacheInfo}
          valueClass={`tabular-nums font-semibold ${cacheDurationColor(stats.demuxerCacheDuration)}`}
        />
      </StatCard>

      {/* Display & Output Context Card */}
      <StatCard title={tr("Display & Output Canvas")}>
        {/* 3-Cell Health & Refresh Micro-grid */}
        <div className="grid grid-cols-3 gap-1.5 mb-1">
          <div className="flex flex-col rounded-lg bg-surface/60 border border-edge-soft/40 p-1.5">
            <span className="text-[8.5px] uppercase tracking-wider text-ink-subtle">A-V Sync</span>
            <span className={`text-[11px] font-bold tabular-nums ${avSyncColor(stats.avsync)}`}>
              {stats.avsync != null
                ? `${stats.avsync >= 0 ? "+" : ""}${(stats.avsync * 1000).toFixed(0)} ms`
                : "+0 ms"}
            </span>
          </div>

          <div className="flex flex-col rounded-lg bg-surface/60 border border-edge-soft/40 p-1.5">
            <span className="text-[8.5px] uppercase tracking-wider text-ink-subtle">
              Dropped Frames
            </span>
            <span className="text-[11px] font-bold tabular-nums">
              <span className={dropColor(stats.decoderDrops)}>{stats.decoderDrops ?? 0}</span>
              <span className="text-ink-subtle font-normal text-[9px]"> dec / </span>
              <span className={dropColor(stats.outputDrops)}>{stats.outputDrops ?? 0}</span>
              <span className="text-ink-subtle font-normal text-[9px]"> out</span>
            </span>
          </div>

          <div className="flex flex-col rounded-lg bg-surface/60 border border-edge-soft/40 p-1.5">
            <span className="text-[8.5px] uppercase tracking-wider text-ink-subtle">
              Refresh Rate
            </span>
            <span className="text-[11px] font-bold text-ink truncate tabular-nums">
              {stats.displayFps ? `${stats.displayFps.toFixed(0)} Hz` : "60 Hz"}
              <span className="text-[9px] font-normal text-ink-subtle"> (display)</span>
            </span>
          </div>
        </div>

        <StatRow
          label={tr("Display & Context")}
          value={`${stats.currentVo ?? "gpu-next"} ${stats.displayNames ? `(${stats.displayNames})` : ""} · Context: ${stats.gpuContext || "d3d11"}`}
        />

        {stats.freshTimingSummary && (
          <StatRow
            label={tr("Frame Timings")}
            value={
              <span className="tabular-nums text-[10px]">
                <span className="font-semibold text-ink">{stats.freshTimingSummary}</span>
                <span className="text-ink-subtle text-[9px]"> μs (fresh)</span>
                {stats.redrawTimingSummary && (
                  <>
                    <span className="text-ink-subtle"> · </span>
                    <span className="font-semibold text-ink">{stats.redrawTimingSummary}</span>
                    <span className="text-ink-subtle text-[9px]"> μs (redraw)</span>
                  </>
                )}
              </span>
            }
          />
        )}

        <StatRow
          label={tr("Canvas Resolution")}
          value={
            stats.outW && stats.outH
              ? `${stats.outW}×${stats.outH} ${stats.outAspect ? `(${stats.outAspect})` : ""}`
              : `${snap.videoWidth}×${snap.videoHeight}`
          }
        />
        <StatRow
          label={tr("Output Pixel Format")}
          value={`${stats.outFormat ?? "—"} · Levels: ${stats.outLevels ?? "—"}`}
        />

        {/* Display Canvas Color Pipeline Grid */}
        <div className="mt-1 flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-wider text-ink-subtle">
            {tr("Canvas Color Space")}
          </span>
          <ColorPipelineGrid
            matrix={stats.outColormatrix ?? "rgb"}
            primaries={stats.outPrimaries ?? "bt.709"}
            transfer={stats.outTransfer ?? "bt.1886"}
          />
        </div>

        {/* HDR / Dolby Vision Metadata (Rendered when HDR is active or DV is detected) */}
        {isHdrOutput && (
          <div className="mt-2 rounded-lg bg-surface/70 border border-edge-soft/50 p-2 flex flex-col gap-1">
            <div className="flex items-center justify-between text-[9.5px] font-bold uppercase tracking-wider text-accent border-b border-edge-soft/40 pb-1">
              <span>{hasDovi ? "Dolby Vision / HDR Output" : "HDR Output & Display"}</span>
              <span className="text-emerald-400 font-semibold text-[9px]">Active</span>
            </div>
            {hasDovi && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] pt-0.5 border-b border-edge-soft/30 pb-1">
                <div className="flex justify-between">
                  <span className="text-ink-subtle">Dolby Vision:</span>
                  <span className="text-ink font-mono font-medium">{stats.doviProfile}</span>
                </div>
                {stats.doviLevel && (
                  <div className="flex justify-between">
                    <span className="text-ink-subtle">Level:</span>
                    <span className="text-ink font-mono font-medium">{stats.doviLevel}</span>
                  </div>
                )}
                {stats.doviRpu && (
                  <div className="flex justify-between">
                    <span className="text-ink-subtle">RPU:</span>
                    <span className="text-emerald-400 font-mono font-medium">Present</span>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] pt-0.5">
              <div className="flex justify-between">
                <span className="text-ink-subtle">Display Peak:</span>
                <span className="text-ink font-mono font-medium">
                  0 / {stats.targetPeak ?? 300} cd/m²
                </span>
              </div>
              {stats.sigPeak != null && stats.sigPeak > 0 && (
                <div className="flex justify-between">
                  <span className="text-ink-subtle">Signal Peak:</span>
                  <span className="text-ink font-mono font-medium">
                    {stats.sigPeak.toFixed(1)} cd/m²
                  </span>
                </div>
              )}
              {(stats.maxCll != null || stats.maxFall != null) && (
                <div className="flex justify-between">
                  <span className="text-ink-subtle">MaxCLL / MaxFALL:</span>
                  <span className="text-ink font-mono font-medium">
                    {stats.maxCll ?? "—"} / {stats.maxFall ?? "—"} nits
                  </span>
                </div>
              )}
              {(stats.minLuma != null || stats.maxLuma != null) && (
                <div className="flex justify-between col-span-2">
                  <span className="text-ink-subtle">Mastering Luminance:</span>
                  <span className="text-ink font-mono font-medium">
                    Min: {stats.minLuma ?? 0} cd/m² · Max: {stats.maxLuma ?? 1000} cd/m²
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </StatCard>

      {/* Video Stream Card */}
      <StatCard title={tr("Video Stream")}>
        <StatRow
          label={tr("Video Codec")}
          value={
            <span>
              {stats.videoCodec || stats.videoFormat || "—"}
              {stats.videoFormat && stats.videoCodec !== stats.videoFormat
                ? ` [${stats.videoFormat}]`
                : ""}
              <span className="ms-1.5 rounded bg-surface px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                HW: {isHw ? stats.hwdec : "None (CPU)"}
              </span>
            </span>
          }
        />
        <StatRow
          label={tr("Frame Rate")}
          value={
            <span className="tabular-nums">
              <span className={`font-semibold ${fpsColor(stats.estimatedFps, stats.containerFps)}`}>
                {fps != null ? `${fps.toFixed(3)} fps` : "—"}
              </span>
              {stats.containerFps ? (
                <span className="text-ink-subtle text-[9.5px]">
                  {" "}
                  (container: {stats.containerFps.toFixed(3)})
                </span>
              ) : null}
            </span>
          }
        />
        <StatRow
          label={tr("Native Resolution")}
          value={
            stats.srcW && stats.srcH
              ? `${stats.srcW}×${stats.srcH} ${stats.srcAspect ? `(${stats.srcAspect})` : ""}`
              : `${snap.videoWidth}×${snap.videoHeight}`
          }
        />
        <StatRow label={tr("Video Bitrate")} value={formatBitrate(stats.videoBitrate)} />
        <StatRow
          label={tr("Pixel Format")}
          value={`${stats.pixelFormat ?? "—"} · Levels: ${stats.colorLevels ?? "—"}`}
        />
        <StatRow label={tr("Chroma Location")} value={stats.chromaLocation ?? "—"} />

        {/* Video Source Color Pipeline Grid */}
        <div className="mt-1 flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-wider text-ink-subtle">
            {tr("Video Stream Color Space")}
          </span>
          <ColorPipelineGrid
            matrix={stats.colormatrix ?? "—"}
            primaries={stats.primaries ?? "—"}
            transfer={stats.gamma ?? "—"}
          />
        </div>

        {/* Video Filters & Processing (Rendered cleanly inside Video Stream ONLY when active) */}
        {hasVideoFilters && (
          <div className="mt-2 flex flex-col gap-1 border-t border-edge-soft/50 pt-2">
            <span className="text-[9px] uppercase tracking-wider text-accent font-bold">
              Filters:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {hasVapourSynth && (
                <div className="flex items-center gap-1 rounded bg-surface px-2 py-0.5 text-[9.5px] border border-edge-soft/40">
                  <span className="text-ink-subtle">VapourSynth / SVP</span>
                  <span className="text-emerald-400 font-semibold">Active</span>
                </div>
              )}
              {activeShaders.length > 0 && (
                <div className="flex items-center gap-1 rounded bg-surface px-2 py-0.5 text-[9.5px] border border-edge-soft/40">
                  <span className="text-ink-subtle">GLSL Shaders</span>
                  <span className="text-amber-300 font-semibold">
                    {activeShaders.length} active
                  </span>
                </div>
              )}
              {hasDeband && (
                <div className="flex items-center gap-1 rounded bg-surface px-2 py-0.5 text-[9.5px] border border-edge-soft/40">
                  <span className="text-ink-subtle">Deband</span>
                  <span className="text-ink font-semibold">
                    {stats.debandIterations ? `${stats.debandIterations} iter` : "Active"}
                  </span>
                </div>
              )}
              {hasSharpen && (
                <div className="flex items-center gap-1 rounded bg-surface px-2 py-0.5 text-[9.5px] border border-edge-soft/40">
                  <span className="text-ink-subtle">Sharpen</span>
                  <span className="text-amber-300 font-semibold">+{stats.sharpen?.toFixed(2)}</span>
                </div>
              )}
              {hasInterpolation && (
                <div className="flex items-center gap-1 rounded bg-surface px-2 py-0.5 text-[9.5px] border border-edge-soft/40">
                  <span className="text-ink-subtle">Interpolation</span>
                  <span className="text-ink font-semibold">{stats.tscale ?? "Active"}</span>
                </div>
              )}
              {hasToneMapping && (
                <div className="flex items-center gap-1 rounded bg-surface px-2 py-0.5 text-[9.5px] border border-edge-soft/40">
                  <span className="text-ink-subtle">Tonemap</span>
                  <span className="text-ink font-semibold">{stats.toneMapping}</span>
                </div>
              )}
              {activeCustomVf.map((vf, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1 rounded bg-surface px-2 py-0.5 text-[9.5px] border border-edge-soft/40"
                >
                  <span className="text-ink font-mono truncate max-w-[200px]">{vf}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </StatCard>

      {/* Audio Stream Card */}
      <StatCard title={tr("Audio Stream & Playback")}>
        <StatRow
          label={tr("Audio Codec")}
          value={`${stats.audioCodec || stats.audioFormat || "—"}${stats.audioFormat && stats.audioCodec !== stats.audioFormat ? ` [${stats.audioFormat}]` : ""}`}
        />
        <StatRow
          label={tr("Audio Output (AO)")}
          value={`${stats.currentAo ?? "wasapi"} · Volume: ${stats.aoVolume ? `${Math.round(stats.aoVolume)}%` : `${Math.round(snap.volume * 100)}%`}`}
        />
        <StatRow label={tr("Audio Device")} value={stats.audioDevice ?? "Default Audio Device"} />
        <StatRow
          label={tr("Channels")}
          value={stats.audioChannels ? `${stats.audioChannels} channels` : "—"}
        />
        <StatRow
          label={tr("Audio Format")}
          value={`${stats.audioInFormat || "—"} → ${stats.audioOutFormat || "—"}`}
        />
        <StatRow
          label={tr("Sample Rate")}
          value={stats.audioSampleRate ? `${stats.audioSampleRate} Hz` : "—"}
        />
        <StatRow label={tr("Audio Bitrate")} value={formatBitrate(stats.audioBitrate)} />
        <StatRow label={tr("Playback Speed")} value={`${snap.rate.toFixed(2)}×`} />

        {/* Audio Filters (Rendered cleanly inside Audio Stream ONLY when active) */}
        {hasAudioFilters && (
          <div className="mt-2 flex flex-col gap-1 border-t border-edge-soft/50 pt-2">
            <span className="text-[9px] uppercase tracking-wider text-accent font-bold">
              Filters:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {snap.audioNormalize && (
                <div className="flex items-center gap-1 rounded bg-surface px-2 py-0.5 text-[9.5px] border border-edge-soft/40">
                  <span className="text-ink-subtle">Normalizer</span>
                  <span className="text-emerald-400 font-semibold">dynaudnorm</span>
                </div>
              )}
              {activeCustomAf.map((af, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1 rounded bg-surface px-2 py-0.5 text-[9.5px] border border-edge-soft/40"
                >
                  <span className="text-ink font-mono truncate max-w-[200px]">{af}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </StatCard>
    </div>
  );
}

// -------------------------------------------------------------
// PAGE 2: EXTENDED FRAME TIMINGS & SHADERS
// -------------------------------------------------------------
function PageShaders({ stats, tr }: { stats: MpvOverviewStats; tr: ReturnType<typeof useT> }) {
  const freshPasses = stats.voPasses?.fresh || [];
  const redrawPasses = stats.voPasses?.redraw || [];
  const totalFreshNs = freshPasses.reduce((sum, p) => sum + (p.last || 0), 0) || 1;

  const rawShaders = stats.glslShaders;
  const shadersList: string[] = Array.isArray(rawShaders)
    ? (rawShaders as string[])
    : typeof rawShaders === "string"
      ? (rawShaders as string)
          .split(/[;,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  return (
    <div className="flex flex-col gap-3">
      {/* Active GLSL Shaders & Hooks */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between border-b border-edge-soft/50 pb-1 text-[10px]">
          <span className="font-bold uppercase tracking-wider text-accent">
            {tr("Active GLSL Shaders & Hooks")}
          </span>
          <span className="text-ink-subtle">{shadersList.length} hooked</span>
        </div>
        {shadersList.length === 0 ? (
          <div className="rounded-lg bg-surface/50 p-3 text-center text-ink-muted text-[10.5px]">
            {tr("No external GLSL shaders or Anime4K passes currently active.")}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {shadersList.map((path, idx) => {
              const basename =
                typeof path === "string" ? path.split(/[/\\]/).pop() || path : String(path);
              return (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface/60 border border-edge-soft/50 px-2.5 py-1.5 text-[10.5px]"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-accent/80 font-mono text-[9px]">{idx + 1}.</span>
                    <span className="text-amber-300 font-medium truncate" title={path}>
                      {basename}
                    </span>
                  </div>
                  <span className="shrink-0 rounded bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 text-[9px] font-semibold">
                    {tr("Compiled / Active")}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* GPU Passes & Frame Timings */}
      <section className="flex flex-col gap-2 border-t border-edge-soft/40 pt-2">
        <div className="flex items-baseline justify-between border-b border-edge-soft/50 pb-1 text-[10px]">
          <span className="font-bold uppercase tracking-wider text-accent">
            Frame Timings: (last / avg / peak μs)
          </span>
          <span className="text-ink-subtle">{freshPasses.length} passes</span>
        </div>

        {freshPasses.length === 0 && redrawPasses.length === 0 ? (
          <div className="rounded-lg bg-surface/30 p-4 text-center text-ink-muted text-[10px]">
            {tr("Direct GPU output pipeline. Sub-millisecond raster passes active.")}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="text-[9.5px] font-bold uppercase text-ink-muted">Fresh:</div>
            {freshPasses.map((pass, idx) => {
              const lastUs = Math.round((pass.last || 0) / 1000);
              const avgUs = Math.round((pass.avg || 0) / 1000);
              const peakUs = Math.round((pass.peak || 0) / 1000);
              const pct = Math.min(100, Math.round(((pass.last || 0) / totalFreshNs) * 100));
              const isShader =
                pass.desc.toLowerCase().includes("shader") ||
                pass.desc.toLowerCase().includes("anime4k");

              return (
                <div key={idx} className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="w-24 shrink-0 tabular-nums text-ink font-medium">
                    {lastUs} / {avgUs} / {peakUs}
                  </span>
                  <div className="flex w-12 shrink-0 items-center gap-1">
                    <span className="w-6 text-end tabular-nums text-ink-muted text-[9px]">
                      {pct}%
                    </span>
                    <div className="h-1.5 w-6 overflow-hidden rounded-full bg-surface">
                      <div
                        className={`h-full rounded-full ${isShader ? "bg-amber-400" : "bg-red-500"}`}
                        style={{ width: `${Math.max(8, pct)}%` }}
                      />
                    </div>
                  </div>
                  <span
                    className={`truncate flex-1 text-end ${isShader ? "text-amber-200 font-semibold" : "text-ink-muted"}`}
                    title={pass.desc}
                  >
                    {pass.desc}
                  </span>
                </div>
              );
            })}

            {redrawPasses.length > 0 && (
              <>
                <div className="mt-2 text-[9.5px] font-bold uppercase text-ink-muted border-t border-edge-soft/40 pt-1">
                  Redraw:
                </div>
                {redrawPasses.map((pass, idx) => {
                  const lastUs = Math.round((pass.last || 0) / 1000);
                  const avgUs = Math.round((pass.avg || 0) / 1000);
                  const peakUs = Math.round((pass.peak || 0) / 1000);

                  return (
                    <div key={idx} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="w-24 shrink-0 tabular-nums text-ink font-medium">
                        {lastUs} / {avgUs} / {peakUs}
                      </span>
                      <span className="truncate flex-1 text-end text-ink-muted" title={pass.desc}>
                        {pass.desc}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// -------------------------------------------------------------
// PAGE 3: DEMUXER & NETWORK CACHE LEVEL METERS
// -------------------------------------------------------------
function PageCache({
  stats,
  engineStats,
  tr,
}: {
  stats: MpvOverviewStats;
  engineStats?: EngineStats | null;
  tr: ReturnType<typeof useT>;
}) {
  const bufPct = Math.min(100, Math.max(0, stats.cacheBufferingState ?? 100));
  const aheadSec = stats.demuxerCacheDuration ?? 0;
  const aheadPct = Math.min(100, Math.max(0, (aheadSec / 60) * 100));
  const p2pPeers = engineStats
    ? engineStats.unchoked > 0
      ? engineStats.unchoked
      : engineStats.peers
    : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Demuxer Buffer Fill Level Meter */}
      <div className="flex flex-col gap-1.5 rounded-xl border border-edge-soft/50 bg-surface/40 p-2.5">
        <div className="flex items-center justify-between text-[10.5px]">
          <span className="text-ink-muted">{tr("Demuxer buffer fill")}</span>
          <span
            className={`font-semibold tabular-nums ${
              stats.cacheBufferingState != null && stats.cacheBufferingState < 50
                ? "text-rose-400"
                : stats.cacheBufferingState != null && stats.cacheBufferingState < 90
                  ? "text-amber-400"
                  : "text-emerald-400"
            }`}
          >
            {stats.cacheBufferingState != null
              ? `${stats.cacheBufferingState.toFixed(0)}%`
              : "100%"}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface ring-1 ring-edge-soft/50">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${bufPct}%` }}
          />
        </div>
      </div>

      {/* Lookahead Duration Meter */}
      <div className="flex flex-col gap-1.5 rounded-xl border border-edge-soft/50 bg-surface/40 p-2.5">
        <div className="flex items-center justify-between text-[10.5px]">
          <span className="text-ink-muted">{tr("Buffered ahead")}</span>
          <span
            className={`font-semibold tabular-nums ${cacheDurationColor(stats.demuxerCacheDuration)}`}
          >
            {stats.demuxerCacheDuration != null ? `${stats.demuxerCacheDuration.toFixed(1)}s` : "—"}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface ring-1 ring-edge-soft/50">
          <div
            className="h-full rounded-full bg-emerald-500/80 transition-all duration-300"
            style={{ width: `${aheadPct}%` }}
          />
        </div>
      </div>

      {/* Numerical Cache Specs */}
      <dl className="flex flex-col gap-1 text-[10.5px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">{tr("Total cache in memory")}</dt>
          <dd className="tabular-nums font-medium text-ink">
            {formatBytes(stats.demuxerCacheBytes)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">{tr("Cache read rate")}</dt>
          <dd className="tabular-nums font-medium text-ink">
            {stats.cacheSpeed != null && stats.cacheSpeed > 0
              ? fmtSpeed(stats.cacheSpeed)
              : "Idle (sufficient)"}
          </dd>
        </div>
        {stats.demuxerCacheTime != null && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-muted">{tr("Demuxer reader position")}</dt>
            <dd className="tabular-nums font-medium text-ink">
              {stats.demuxerCacheTime.toFixed(1)}s
            </dd>
          </div>
        )}
        {engineStats && (
          <>
            <div className="flex items-baseline justify-between gap-3 border-t border-edge-soft/40 pt-1 mt-1">
              <dt className="text-ink-muted">{tr("P2P connected swarm")}</dt>
              <dd className="tabular-nums font-medium text-accent">
                {p2pPeers ?? 0} {tr("peers")} ({engineStats.unchoked ?? 0} unchoked)
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-muted">{tr("P2P torrent download speed")}</dt>
              <dd className="tabular-nums font-medium text-emerald-300">
                {fmtSpeed(engineStats.downloadSpeed)}
              </dd>
            </div>
          </>
        )}
      </dl>
    </div>
  );
}

// -------------------------------------------------------------
// PAGE 4: CONTAINER TRACKS (Audio & Subtitles)
// -------------------------------------------------------------
function PageTracks({ snap, tr }: { snap: PlayerSnapshot; tr: ReturnType<typeof useT> }) {
  const audioTracks = snap.audioTracks || [];
  const subtitleTracks = snap.subtitleTracks || [];

  return (
    <div className="flex flex-col gap-3">
      {/* Audio Tracks */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between border-b border-edge-soft/50 pb-1 text-[10px]">
          <span className="font-bold uppercase tracking-wider text-accent/80">
            {tr("Audio Streams")}
          </span>
          <span className="text-ink-subtle">{audioTracks.length} available</span>
        </div>
        {audioTracks.length === 0 ? (
          <span className="text-ink-muted py-1">{tr("No audio tracks found.")}</span>
        ) : (
          audioTracks.map((track: TrackInfo, idx: number) => {
            const isSelected = track.selected;
            const name = track.title || track.label || track.lang || `Track ${idx + 1}`;
            return (
              <div
                key={track.id || idx}
                className={`flex items-center justify-between gap-2 rounded-lg p-1.5 text-[10px] transition-colors ${
                  isSelected
                    ? "bg-accent/15 border border-accent/30 text-ink"
                    : "bg-surface/30 text-ink-muted"
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-ink-subtle font-mono text-[9px] shrink-0">#{idx + 1}</span>
                  <span
                    className={`truncate font-medium ${isSelected ? "text-ink" : "text-ink-muted"}`}
                  >
                    {name}
                  </span>
                  {track.lang && (
                    <span className="rounded bg-surface px-1 py-0.2 text-[8.5px] uppercase text-ink-subtle">
                      {track.lang}
                    </span>
                  )}
                  {track.codec && (
                    <span className="rounded bg-surface px-1 py-0.2 text-[8.5px] text-ink-subtle">
                      {track.codec}
                    </span>
                  )}
                  {track.channels && (
                    <span className="text-[8.5px] text-ink-subtle">{track.channels}</span>
                  )}
                </div>
                {isSelected && (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400 shrink-0">
                    <Check size={11} strokeWidth={3} />
                    {tr("Active")}
                  </span>
                )}
              </div>
            );
          })
        )}
      </section>

      {/* Subtitle Tracks */}
      <section className="flex flex-col gap-1.5 border-t border-edge-soft/40 pt-1.5">
        <div className="flex items-baseline justify-between border-b border-edge-soft/50 pb-1 text-[10px]">
          <span className="font-bold uppercase tracking-wider text-accent/80">
            {tr("Subtitle Streams")}
          </span>
          <span className="text-ink-subtle">{subtitleTracks.length} available</span>
        </div>
        {subtitleTracks.length === 0 ? (
          <span className="text-ink-muted py-1">{tr("No subtitle tracks found.")}</span>
        ) : (
          subtitleTracks.map((track: TrackInfo, idx: number) => {
            const isSelected = track.selected;
            const name = track.title || track.label || track.lang || `Track ${idx + 1}`;
            return (
              <div
                key={track.id || idx}
                className={`flex items-center justify-between gap-2 rounded-lg p-1.5 text-[10px] transition-colors ${
                  isSelected
                    ? "bg-accent/15 border border-accent/30 text-ink"
                    : "bg-surface/30 text-ink-muted"
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-ink-subtle font-mono text-[9px] shrink-0">#{idx + 1}</span>
                  <span
                    className={`truncate font-medium ${isSelected ? "text-ink" : "text-ink-muted"}`}
                  >
                    {name}
                  </span>
                  {track.lang && (
                    <span className="rounded bg-surface px-1 py-0.2 text-[8.5px] uppercase text-ink-subtle">
                      {track.lang}
                    </span>
                  )}
                  {track.external && (
                    <span className="rounded bg-accent/20 text-accent px-1 py-0.2 text-[8.5px]">
                      {tr("External")}
                    </span>
                  )}
                  {track.forced && (
                    <span className="rounded bg-surface px-1 py-0.2 text-[8.5px] text-ink-subtle">
                      {tr("Forced")}
                    </span>
                  )}
                </div>
                {isSelected ? (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400 shrink-0">
                    <Check size={11} strokeWidth={3} />
                    {tr("Active")}
                  </span>
                ) : (
                  <span className="text-[9px] text-ink-subtle shrink-0">{tr("Off")}</span>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

// -------------------------------------------------------------
// PAGE 5: SCRIPTS LOG & INTERNAL PROFILER
// -------------------------------------------------------------
function PageScripts({ stats, tr }: { stats: MpvOverviewStats; tr: ReturnType<typeof useT> }) {
  const { settings } = useSettings();
  const rawShaders = stats.glslShaders;
  const shadersList: string[] = Array.isArray(rawShaders)
    ? (rawShaders as string[])
    : typeof rawShaders === "string"
      ? (rawShaders as string)
          .split(/[;,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const mpvScripts = Array.isArray(stats.scriptList) ? stats.scriptList : [];
  const configuredScripts = (settings.customMpvScripts || []).filter(
    (s) => s.enabled && s.path?.trim(),
  );

  // Also parse scripts specified directly in extra options
  const extraScriptLines = (settings.mpvExtraOptions || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
  const extraScripts: Array<{ name: string; path: string }> = [];
  for (const line of extraScriptLines) {
    const [k, v] = line.split("=").map((s) => s.trim());
    if ((k === "script" || k === "load-script" || k === "--script") && v) {
      const name = v.split(/[/\\]/).pop() || v;
      extraScripts.push({ name, path: v });
    }
  }

  // Merge scripts by lowercase path or name so no duplicate entries
  const scriptMap = new Map<string, { name: string; path?: string; source: string }>();

  // 1. Configured custom scripts
  for (const cs of configuredScripts) {
    const key = (cs.path || cs.name).toLowerCase();
    scriptMap.set(key, { name: cs.name || cs.path, path: cs.path, source: "Settings (Active)" });
  }

  // 2. Extra options scripts
  for (const es of extraScripts) {
    const key = (es.path || es.name).toLowerCase();
    if (!scriptMap.has(key)) {
      scriptMap.set(key, { name: es.name, path: es.path, source: "Extra Options" });
    }
  }

  // 3. MPV live reported scripts
  for (const ms of mpvScripts) {
    const p = ms.path || ms.name;
    const key = p ? p.toLowerCase() : ms.name.toLowerCase();
    const existing = scriptMap.get(key);
    if (existing) {
      existing.source = "Loaded in MPV";
      if (!existing.path && ms.path) existing.path = ms.path;
    } else {
      scriptMap.set(key, { name: ms.name, path: ms.path, source: "MPV Internal" });
    }
  }

  const displayScripts = Array.from(scriptMap.values());

  return (
    <div className="flex flex-col gap-3">
      {/* 1. Active External Shaders */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between border-b border-edge-soft/50 pb-1 text-[10px]">
          <span className="font-bold uppercase tracking-wider text-accent">
            {tr("Active External Shaders")}
          </span>
          <span className="text-ink-subtle">{shadersList.length} loaded</span>
        </div>
        {shadersList.length === 0 ? (
          <div className="rounded-lg bg-surface/50 p-3 text-center text-ink-muted text-[10.5px]">
            {tr("No external GLSL shaders active.")}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {shadersList.map((path, idx) => {
              const basename =
                typeof path === "string" ? path.split(/[/\\]/).pop() || path : String(path);
              return (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface/60 border border-edge-soft/50 px-2.5 py-1.5 text-[10.5px]"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-accent/80 font-mono text-[9px]">{idx + 1}.</span>
                    <span className="text-amber-300 font-medium truncate" title={path}>
                      {basename}
                    </span>
                  </div>
                  <span className="shrink-0 rounded bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 text-[9px] font-semibold">
                    {tr("Active")}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Loaded mpv Scripts */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between border-b border-edge-soft/50 pb-1 text-[10px]">
          <span className="font-bold uppercase tracking-wider text-accent">
            {tr("Loaded Scripts")}
          </span>
          <span className="text-ink-subtle">{displayScripts.length} registered</span>
        </div>
        {displayScripts.length === 0 ? (
          <div className="rounded-lg bg-surface/50 p-4 text-center text-ink-muted text-[10.5px] flex flex-col gap-1">
            <span className="font-semibold text-ink">
              {tr("No external Lua or JavaScript scripts loaded.")}
            </span>
            <span className="text-[9.5px] text-ink-subtle">
              {tr("Add scripts under Settings → Advanced (Lua Scripts) to load them.")}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {displayScripts.map((s, idx) => {
              const scriptName = s.name || `Script ${idx + 1}`;
              const scriptPath = s.path;
              return (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface/60 border border-edge-soft/50 px-2.5 py-1.5 text-[10.5px]"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-accent/80 font-mono text-[9px]">{idx + 1}.</span>
                    <span
                      className="text-ink font-medium truncate"
                      title={scriptPath || scriptName}
                    >
                      {scriptName}
                    </span>
                    {typeof scriptPath === "string" && scriptPath && (
                      <span className="text-[9px] text-ink-subtle truncate max-w-[200px]">
                        ({scriptPath.split(/[/\\]/).pop()})
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 rounded bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 text-[9px] font-semibold">
                    {s.source}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
