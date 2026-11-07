import { useEffect, useState, useRef, memo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import type { PlayerSnapshot } from "@/lib/player/bridge";
import { useSettings } from "@/lib/settings";

export const PAGE_METAS: Record<number, { title: string }> = {
  0: { title: "Internal Performance Info" },
  1: { title: "Overview" },
  2: { title: "Frame Timings" },
  3: { title: "Cache Info" },
  4: { title: "Active Key Bindings" },
  5: { title: "Selected Tracks Info" },
};

const STATS_TABS: Array<{ id: 0 | 1 | 2 | 3 | 4 | 5; label: string }> = [
  { id: 1, label: "Overview" },
  { id: 2, label: "Frame Timings" },
  { id: 3, label: "Cache Info" },
  { id: 4, label: "Key Bindings" },
  { id: 5, label: "Tracks Info" },
  { id: 0, label: "Internal" },
];

function parseString(val: unknown, fallback = ""): string {
  if (val == null) return fallback;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed || trimmed === "[object Object]") return fallback;
    return trimmed;
  }
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) {
    const list = val.map((x) => parseString(x)).filter((s) => s && s !== "[object Object]");
    return list.length > 0 ? list.join(", ") : fallback;
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const preferredKeys = ["current", "name", "value", "id", "title", "text", "desc", "label"];
    for (const key of preferredKeys) {
      if (typeof obj[key] === "string" && obj[key] && obj[key] !== "[object Object]") {
        return (obj[key] as string).trim();
      }
    }
    for (const v of Object.values(obj)) {
      if (typeof v === "string" && v && v !== "[object Object]") {
        return v.trim();
      }
      if (typeof v === "number" || typeof v === "boolean") {
        return String(v);
      }
    }
    return fallback;
  }
  return fallback;
}

function parseNumber(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function pqEotf(x: number | null | undefined): number {
  if (x == null || isNaN(x) || x <= 0) return 0;
  const PQ_M1 = (2610.0 / 4096) * (1.0 / 4);
  const PQ_M2 = (2523.0 / 4096) * 128;
  const PQ_C1 = 3424.0 / 4096;
  const PQ_C2 = (2413.0 / 4096) * 32;
  const PQ_C3 = (2392.0 / 4096) * 32;
  const y = Math.pow(x, 1.0 / PQ_M2);
  const num = Math.max(y - PQ_C1, 0.0);
  const den = PQ_C2 - PQ_C3 * y;
  const z = den > 0 ? num / den : 0;
  return Math.pow(z, 1.0 / PQ_M1) * 10000.0;
}

type FilterEntry = {
  name?: string;
  label?: string;
  enabled?: boolean;
  params?: Record<string, unknown> | string;
};

function formatFilters(raw: unknown): string[] {
  if (!raw) return ["none"];
  if (Array.isArray(raw)) {
    if (raw.length === 0) return ["none"];
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item === "string") {
        const s = item.trim();
        if (s) out.push(s);
      } else if (typeof item === "object" && item !== null) {
        const f = item as FilterEntry;
        const name = f.name || "filter";
        const disabled = f.enabled === false ? " (disabled)" : "";
        const label = f.label ? `@${f.label}: ` : "";
        let params = "";
        if (f.params) {
          if (typeof f.params === "string") {
            params = ` [${f.params}]`;
          } else if (typeof f.params === "object") {
            const pObj = f.params as Record<string, unknown>;
            if (pObj.graph) {
              params = ` [graph=${pObj.graph}]`;
            } else {
              const entries = Object.entries(pObj).map(([k, v]) => `${k}=${v}`);
              if (entries.length > 0) {
                params = ` [${entries.join(" ")}]`;
              }
            }
          }
        }
        out.push(`${label}${name}${disabled}${params}`);
      }
    }
    return out.length > 0 ? out : ["none"];
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "none") return ["none"];
    return [trimmed];
  }
  return ["none"];
}

function getAspectName(aspect: number): string | null {
  if (Math.abs(aspect - 1.777) < 0.03 || Math.abs(aspect - 16 / 9) < 0.03) return "16:9";
  if (Math.abs(aspect - 1.333) < 0.03 || Math.abs(aspect - 4 / 3) < 0.03) return "4:3";
  if (aspect >= 1.65 && aspect <= 1.76) return "Early 35mm Widescreen Ratio";
  if (Math.abs(aspect - 1.85) < 0.03) return "Flat (1.85:1)";
  if (Math.abs(aspect - 2.35) < 0.03) return "Anamorphic Scope (2.35:1)";
  if (Math.abs(aspect - 2.39) < 0.04 || Math.abs(aspect - 2.4) < 0.04) return "Scope (2.39:1)";
  if (Math.abs(aspect - 1.375) < 0.02) return "Academy Ratio (1.37:1)";
  if (Math.abs(aspect - 2.0) < 0.03) return "Univisium (2:1)";
  return null;
}

function formatCanvasResolution(
  r: Record<string, unknown> | null,
  od?: Record<string, unknown> | null,
  directAspectName?: string | null,
): string | null {
  // If osd-dimensions is present, it gives the exact canvas window metrics matching stats.lua
  const odW = parseNumber(od?.w);
  const odH = parseNumber(od?.h);
  const w = odW ?? parseNumber(r?.w);
  const h = odH ?? parseNumber(r?.h);
  if (!w || !h) return null;

  let res = `${w} x ${h}`;

  const aspect = parseNumber(od?.aspect) ?? (h > 0 ? w / h : undefined) ?? parseNumber(r?.aspect);
  const aspectName =
    parseString(directAspectName) ||
    parseString(r?.["aspect-name"]) ||
    (aspect != null ? getAspectName(aspect) : null);

  if (aspect) {
    res += `  ${aspect.toFixed(2)}:1`;
    if (aspectName) {
      res += ` (${aspectName})`;
    }
  } else if (aspectName) {
    res += ` (${aspectName})`;
  }

  // Crop calculation from osd-dimensions matching mpv's stats.lua:
  // r["crop-x"] = od["ml"]
  // r["crop-y"] = od["mt"]
  // r["crop-w"] = od["w"] - od["ml"] - od["mr"]
  // r["crop-h"] = od["h"] - od["mt"] - od["mb"]
  const ml = parseNumber(od?.ml);
  const mr = parseNumber(od?.mr);
  const mt = parseNumber(od?.mt);
  const mb = parseNumber(od?.mb);

  let cropX = parseNumber(r?.["crop-x"]);
  let cropY = parseNumber(r?.["crop-y"]);
  let cropW = parseNumber(r?.["crop-w"]);
  let cropH = parseNumber(r?.["crop-h"]);

  if (ml != null && mr != null && mt != null && mb != null && odW != null && odH != null) {
    cropX = ml;
    cropY = mt;
    cropW = odW - ml - mr;
    cropH = odH - mt - mb;
  }

  // crop_noop check: only display crop rectangle if it differs from (0, 0, w, h)
  const isNoop = cropX === 0 && cropY === 0 && cropW === w && cropH === h;
  if (!isNoop && cropW != null && cropH != null) {
    res += `  [x: ${cropX ?? 0}, y: ${cropY ?? 0}, w: ${cropW}, h: ${cropH}]`;
  }

  return res;
}

function formatVideoResolution(
  vParams: Record<string, unknown> | null,
  fallbackW?: number,
  fallbackH?: number,
): string {
  const w = parseNumber(vParams?.w) ?? fallbackW;
  const h = parseNumber(vParams?.h) ?? fallbackH;
  if (!w || !h) return "—";

  let res = `${w} x ${h}`;
  const aspect = parseNumber(vParams?.aspect) ?? (h > 0 ? w / h : undefined);
  const aspectName =
    parseString(vParams?.["aspect-name"]) || (aspect != null ? getAspectName(aspect) : null);
  if (aspect) {
    res += `  ${aspect.toFixed(2)}:1`;
    if (aspectName) {
      res += ` (${aspectName})`;
    }
  } else if (aspectName) {
    res += ` (${aspectName})`;
  }
  return res;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || isNaN(bytes) || bytes <= 0) return "0.00 MiB";
  const mib = bytes / (1024 * 1024);
  if (mib >= 1024) return `${(mib / 1024).toFixed(3)} GiB`;
  return `${mib.toFixed(2)} MiB`;
}

function formatDuration(sec: number | null | undefined): string {
  if (sec == null || isNaN(sec) || sec < 0) return "00:00:00";
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

async function getMpvProp<T>(name: string): Promise<T | null> {
  try {
    return await invoke<T>("mpv_get_property", { name });
  } catch {
    return null;
  }
}

async function getMpvPropWithFallback<T>(primary: string, fallback: string): Promise<T | null> {
  const val = await getMpvProp<T>(primary);
  if (val != null) return val;
  return getMpvProp<T>(fallback);
}

async function getMpvOsdProp(name: string): Promise<string | null> {
  try {
    return await invoke<string>("mpv_get_property_osd", { name });
  } catch {
    return null;
  }
}

type TrackEntry = {
  id: number;
  type: string;
  "src-id"?: number;
  title?: string;
  lang?: string;
  codec?: string;
  "codec-desc"?: string;
  "codec-profile"?: string;
  decoder?: string;
  "decoder-desc"?: string;
  "demux-w"?: number;
  "demux-h"?: number;
  "demux-fps"?: number;
  "demux-channels"?: number;
  "demux-channel-count"?: number;
  "demux-samplerate"?: number;
  "demux-bitrate"?: number;
  "dolby-vision-profile"?: number | string;
  "dolby-vision-level"?: number | string;
  "dovi-profile"?: number | string;
  "dovi-level"?: number | string;
  "dovi-rpu-present"?: boolean;
  selected?: boolean;
  default?: boolean;
  external?: boolean;
  "external-filename"?: string;
  "ff-index"?: number;
};

type DoviInfo = {
  detected: boolean;
  profile?: string;
  level?: string;
  rpu?: boolean;
};

function detectDolbyVision(
  vParams: Record<string, unknown> | null,
  directDoviProf: string | number | null | undefined,
  directDoviLvl: string | number | null | undefined,
  directDoviRpu: boolean | null | undefined,
  codecProfile: string | null,
  filteredMetadata: Record<string, unknown> | null,
  trackList?: TrackEntry[] | null,
): DoviInfo {
  // 1. Direct mpv video properties
  if (directDoviProf != null && String(directDoviProf).trim().length > 0) {
    return {
      detected: true,
      profile: `Profile ${directDoviProf}`,
      level:
        directDoviLvl != null && String(directDoviLvl).trim().length > 0
          ? String(directDoviLvl)
          : undefined,
      rpu: directDoviRpu === true,
    };
  }

  // 2. Check track-list video tracks (mpv native tracks)
  if (trackList) {
    const videoTrack = trackList.find(
      (t) => t.type === "video" && (t.selected || trackList.length === 1),
    );
    if (videoTrack) {
      const doviProf = videoTrack["dolby-vision-profile"] ?? videoTrack["dovi-profile"];
      const doviLvl = videoTrack["dolby-vision-level"] ?? videoTrack["dovi-level"];
      const doviRpu = videoTrack["dovi-rpu-present"] === true;
      if (doviProf != null && String(doviProf).trim().length > 0) {
        return {
          detected: true,
          profile: `Profile ${doviProf}`,
          level: doviLvl != null && String(doviLvl).trim().length > 0 ? String(doviLvl) : undefined,
          rpu: doviRpu,
        };
      }
      const desc = String(videoTrack["decoder-desc"] || videoTrack.codec || "").toLowerCase();
      if (
        desc.includes("dolby vision") ||
        desc.includes("dovi") ||
        desc.includes("dvhe") ||
        desc.includes("dvh1")
      ) {
        const match = desc.match(/(?:profile|dv|dovi|dvhe\.|dvh1\.)\s*([0-9]+(?:\.[0-9]+)?)/i);
        return { detected: true, profile: match ? `Profile ${match[1]}` : "Detected" };
      }
    }
  }

  // 3. Check video-params dictionary
  if (vParams) {
    const profile = vParams["dolby-vision-profile"] ?? vParams["dovi-profile"];
    const level = vParams["dolby-vision-level"] ?? vParams["dovi-level"];
    const rpu = vParams["dovi-rpu-present"] === true;
    if (profile != null && String(profile).trim().length > 0) {
      return {
        detected: true,
        profile: `Profile ${profile}`,
        level: level != null && String(level).trim().length > 0 ? String(level) : undefined,
        rpu,
      };
    }
    const matrix = String(vParams.colormatrix || "").toLowerCase();
    const gamma = String(vParams.gamma || "").toLowerCase();
    if (matrix.includes("dolby") || matrix.includes("dovi") || gamma.includes("dovi")) {
      return { detected: true, profile: "Detected" };
    }
  }

  // 4. Check codec profile (e.g. "Main 10 / Dolby Vision Profile 8.1" or "dvhe.08.06")
  if (codecProfile) {
    const cpLower = codecProfile.toLowerCase();
    if (
      cpLower.includes("dolby vision") ||
      cpLower.includes("dovi") ||
      cpLower.includes("dvhe") ||
      cpLower.includes("dvh1")
    ) {
      const match = codecProfile.match(
        /(?:profile|dv|dovi|dvhe\.|dvh1\.)\s*([0-9]+(?:\.[0-9]+)?)/i,
      );
      return {
        detected: true,
        profile: match ? `Profile ${match[1]}` : codecProfile,
      };
    }
  }

  // 5. Check metadata tags
  if (filteredMetadata) {
    for (const [k, v] of Object.entries(filteredMetadata)) {
      const kLower = k.toLowerCase();
      if (kLower.includes("dovi") || kLower.includes("dolby")) {
        return { detected: true, profile: String(v) };
      }
    }
  }

  return { detected: false };
}

type HdrInfo = {
  isHdr: boolean;
  type: string;
  maxCll?: number;
  maxFall?: number;
  minLuma?: number;
  maxLuma?: number;
  sigPeak?: number;
};

function detectHdr(
  vParams: Record<string, unknown> | null,
  _targetParams: Record<string, unknown> | null,
  outParams: Record<string, unknown> | null,
  dovi: DoviInfo,
  directHdrProps?: {
    maxCll?: number;
    maxFall?: number;
    minLuma?: number;
    maxLuma?: number;
    sigPeak?: number;
  },
): HdrInfo {
  const gamma = String(vParams?.gamma ?? outParams?.gamma ?? "").toLowerCase();
  const primaries = String(vParams?.primaries ?? outParams?.primaries ?? "").toLowerCase();
  const colormatrix = String(vParams?.colormatrix ?? outParams?.colormatrix ?? "").toLowerCase();

  const maxCll =
    directHdrProps?.maxCll ?? parseNumber(vParams?.["max-cll"] ?? outParams?.["max-cll"]);
  const maxFall =
    directHdrProps?.maxFall ?? parseNumber(vParams?.["max-fall"] ?? outParams?.["max-fall"]);
  const minLuma =
    directHdrProps?.minLuma ?? parseNumber(vParams?.["min-luma"] ?? outParams?.["min-luma"]);
  const maxLuma =
    directHdrProps?.maxLuma ?? parseNumber(vParams?.["max-luma"] ?? outParams?.["max-luma"]);
  const sigPeak =
    directHdrProps?.sigPeak ?? parseNumber(vParams?.["sig-peak"] ?? outParams?.["sig-peak"]);

  const hasPq = gamma === "pq" || gamma === "smpte2084";
  const hasHlg = gamma === "hlg" || gamma === "arib-std-b67";
  const hasBt2020 = primaries === "bt.2020" || colormatrix.includes("2020");
  const hasMetadata = (maxCll != null && maxCll > 0) || (maxLuma != null && maxLuma > 100);

  const isHdr = dovi.detected || hasPq || hasHlg || (hasBt2020 && hasMetadata);

  let type = "SDR";
  if (dovi.detected && hasPq) type = "Dolby Vision / HDR10";
  else if (dovi.detected) type = "Dolby Vision";
  else if (hasPq && hasMetadata) type = "HDR10";
  else if (hasPq) type = "PQ (HDR)";
  else if (hasHlg) type = "HLG";
  else if (isHdr) type = "HDR";

  return {
    isHdr,
    type,
    maxCll: maxCll && maxCll > 0 ? maxCll : undefined,
    maxFall: maxFall && maxFall > 0 ? maxFall : undefined,
    minLuma,
    maxLuma: maxLuma && maxLuma > 0 ? maxLuma : undefined,
    sigPeak: sigPeak && sigPeak > 0 ? sigPeak : undefined,
  };
}

// -------------------------------------------------------------
// PAGE 1: Overview
// -------------------------------------------------------------
async function fetchPage1(): Promise<string> {
  const [
    path,
    mediaTitle,
    chapterIndex,
    chapterCount,
    chapterTitle,
    fileSize,
    fileFormat,
    cacheDuration,
    cacheState,
    vo,
    currentGpuContext,
    gpuContext,
    displayNames,
    avsync,
    containerFps,
    estimatedFps,
    displayFps,
    decDrops,
    voDrops,
    mistimedDrops,
    delayedDrops,
    vTargetParams,
    osdDimensions,
    aspectNameProp,
    vParams,
    vOutParams,
    videoCodec,
    videoCodecProfile,
    hwdec,
    videoBitrate,
    vfRaw,
    vfOsd,
    targetPeak,
    displayPeak,
    toneMapping,
    audioCodec,
    audioCodecName,
    ao,
    audioDevice,
    aoVolume,
    aParams,
    aOutParams,
    audioBitrate,
    afRaw,
    afOsd,
    voPasses,
    trackList,
    filteredMetadata,
    directMaxCll,
    directMaxFall,
    directMinLuma,
    directMaxLuma,
    directSigPeak,
    outMaxCll,
    outMaxFall,
    outSigPeak,
    maxPqYVal,
    avgPqYVal,
    doviProfProp,
    doviLevelProp,
    doviRpuProp,
  ] = await Promise.all([
    getMpvProp<string>("path"),
    getMpvProp<string>("media-title"),
    getMpvProp<number>("chapter"),
    getMpvProp<number>("chapter-list/count") || getMpvProp<number>("chapters"),
    getMpvProp<string>("chapter-metadata/title") ||
      getMpvProp<string>("chapter-list/by-current/title"),
    getMpvProp<number>("file-size"),
    getMpvProp<string>("file-format"),
    getMpvProp<number>("demuxer-cache-duration"),
    getMpvProp<Record<string, unknown>>("demuxer-cache-state"),
    getMpvProp<string>("current-vo") || getMpvProp<string>("vo"),
    getMpvProp<unknown>("current-gpu-context"),
    getMpvProp<unknown>("gpu-context"),
    getMpvProp<unknown>("display-names"),
    getMpvProp<number>("avsync"),
    getMpvProp<number>("container-fps"),
    getMpvProp<number>("estimated-vf-fps"),
    getMpvProp<number>("display-fps"),
    getMpvPropWithFallback<number>("decoder-frame-drop-count", "drop-frame-count"),
    getMpvPropWithFallback<number>("frame-drop-count", "vo-drop-frame-count"),
    getMpvProp<number>("mistimed-frame-count"),
    getMpvPropWithFallback<number>("vo-delayed-frame-count", "delayed-frame-count"),
    getMpvProp<Record<string, unknown>>("video-target-params"),
    getMpvProp<Record<string, unknown>>("osd-dimensions"),
    getMpvProp<string>("video-target-params/aspect-name") ||
      getMpvProp<string>("video-params/aspect-name"),
    getMpvProp<Record<string, unknown>>("video-params"),
    getMpvProp<Record<string, unknown>>("video-out-params"),
    getMpvProp<string>("video-codec"),
    getMpvProp<string>("video-codec-profile") || getMpvProp<string>("video-format"),
    getMpvProp<string>("hwdec-current") || getMpvProp<string>("hwdec"),
    getMpvProp<number>("video-bitrate"),
    getMpvProp<unknown>("vf"),
    getMpvOsdProp("vf"),
    getMpvProp<number>("target-peak"),
    getMpvProp<number>("display-peak"),
    getMpvProp<string>("tone-mapping"),
    getMpvProp<string>("audio-codec"),
    getMpvProp<string>("audio-codec-name"),
    getMpvProp<string>("current-ao") || getMpvProp<string>("ao"),
    getMpvProp<string>("audio-device"),
    getMpvProp<number>("ao-volume"),
    getMpvProp<Record<string, unknown>>("audio-params"),
    getMpvProp<Record<string, unknown>>("audio-out-params"),
    getMpvProp<number>("audio-bitrate"),
    getMpvProp<unknown>("af"),
    getMpvOsdProp("af"),
    getMpvProp<{
      fresh?: Array<{ last: number; avg: number; peak: number }>;
      redraw?: Array<{ last: number; avg: number; peak: number }>;
    }>("vo-passes"),
    getMpvProp<TrackEntry[]>("track-list"),
    getMpvProp<Record<string, unknown>>("filtered-metadata"),
    getMpvProp<number>("video-params/max-cll"),
    getMpvProp<number>("video-params/max-fall"),
    getMpvProp<number>("video-params/min-luma"),
    getMpvProp<number>("video-params/max-luma"),
    getMpvProp<number>("video-params/sig-peak"),
    getMpvProp<number>("video-out-params/max-cll"),
    getMpvProp<number>("video-out-params/max-fall"),
    getMpvProp<number>("video-out-params/sig-peak"),
    getMpvProp<number>("video-out-params/max-pq-y") || getMpvProp<number>("video-params/max-pq-y"),
    getMpvProp<number>("video-out-params/avg-pq-y") || getMpvProp<number>("video-params/avg-pq-y"),
    getMpvProp<string | number>("video-params/dovi-profile"),
    getMpvProp<string | number>("video-params/dovi-level"),
    getMpvProp<boolean>("video-params/dovi-rpu-present"),
  ]);

  const filename = path ? path.replace(/^.*[\\/]/, "") : "Unknown";
  const title = mediaTitle && mediaTitle !== filename ? mediaTitle : "";
  const size = formatBytes(fileSize);
  const fmt = parseString(fileFormat, "stream");
  const cacheBytes =
    parseNumber(cacheState?.["total-bytes"]) ?? parseNumber(cacheState?.["fw-bytes"]);
  const totalCache = `${formatBytes(cacheBytes)} (${(cacheDuration || 0).toFixed(1)} sec)`;

  // Chapter line: e.g. "Chapter: Main Episode (3 / 4)"
  const chIndex = parseNumber(chapterIndex);
  const chCount = parseNumber(chapterCount);
  let chapterLine: string | null = null;
  if (chIndex != null && chIndex >= 0) {
    const chTitle = parseString(chapterTitle) || `Chapter ${chIndex + 1}`;
    if (chCount != null && chCount > 0) {
      chapterLine = `Chapter: ${chTitle} (${chIndex + 1} / ${chCount})`;
    } else {
      chapterLine = `Chapter: ${chTitle}`;
    }
  } else if (chapterTitle) {
    chapterLine = `Chapter: ${parseString(chapterTitle)}`;
  }

  // Clean context resolution: stringified, never [object Object]
  const contextName = parseString(currentGpuContext) || parseString(gpuContext) || "d3d11";
  const displayStr = parseString(displayNames, "\\\\.\\DISPLAY1");
  const voName = parseString(vo, "gpu-next");
  const display = `${voName} (${displayStr})  Context: ${contextName}`;

  // A-V sync matching native mpv: e.g. "A-V: +0"
  const av =
    avsync != null
      ? avsync >= 0
        ? `+${(avsync * 1000).toFixed(0)}`
        : `${(avsync * 1000).toFixed(0)}`
      : "+0";
  const refresh = `${(displayFps || 60).toFixed(0)} Hz (specified)`;
  const decDropsCount = parseNumber(decDrops) || 0;
  const voDropsCount = parseNumber(voDrops) || 0;
  const mistimedCount = parseNumber(mistimedDrops) || 0;
  const delayedCount = parseNumber(delayedDrops) || 0;

  const dropParts: string[] = [`${decDropsCount} (decoder)`, `${voDropsCount} (output)`];
  if (mistimedCount > 0) {
    dropParts.push(`${mistimedCount} (mistimed)`);
  }
  if (delayedCount > 0) {
    dropParts.push(`${delayedCount} (delayed)`);
  }
  const drops = dropParts.join("  ");

  // Frame Timings formatted with aligned columns matching native mpv
  let freshSummary = "     0 /      0 /      0   Fresh";
  let redrawSummary = "     0 /      0 /      0   Redraw";
  if (voPasses?.fresh && voPasses.fresh.length > 0) {
    const fLast = Math.round(voPasses.fresh.reduce((acc, p) => acc + (p.last || 0), 0) / 1000);
    const fAvg = Math.round(voPasses.fresh.reduce((acc, p) => acc + (p.avg || 0), 0) / 1000);
    const fPeak = Math.round(voPasses.fresh.reduce((acc, p) => acc + (p.peak || 0), 0) / 1000);
    freshSummary = `${String(fLast).padStart(6, " ")} / ${String(fAvg).padStart(6, " ")} / ${String(fPeak).padStart(6, " ")}   Fresh`;
  }
  if (voPasses?.redraw && voPasses.redraw.length > 0) {
    const rLast = Math.round(voPasses.redraw.reduce((acc, p) => acc + (p.last || 0), 0) / 1000);
    const rAvg = Math.round(voPasses.redraw.reduce((acc, p) => acc + (p.avg || 0), 0) / 1000);
    const rPeak = Math.round(voPasses.redraw.reduce((acc, p) => acc + (p.peak || 0), 0) / 1000);
    redrawSummary = `${String(rLast).padStart(6, " ")} / ${String(rAvg).padStart(6, " ")} / ${String(rPeak).padStart(6, " ")}   Redraw`;
  }

  // Display / Output Canvas Resolution & Color pipeline (with aspect ratio name & crop rect matching stats.lua)
  const outRes = formatCanvasResolution(vTargetParams ?? vOutParams, osdDimensions, aspectNameProp);

  const outFormat = parseString(vTargetParams?.pixelformat ?? vOutParams?.pixelformat);
  const outLevels = parseString(vTargetParams?.colorlevels ?? vOutParams?.colorlevels);
  const outFmt = [
    outFormat ? `Format: ${outFormat}` : null,
    outLevels ? `Levels: ${outLevels}` : null,
  ]
    .filter(Boolean)
    .join("  ");

  const outColormatrix = parseString(vTargetParams?.colormatrix ?? vOutParams?.colormatrix);
  const outPrimaries = parseString(vTargetParams?.primaries ?? vOutParams?.primaries);
  const outTransfer = parseString(vTargetParams?.gamma ?? vOutParams?.gamma);
  const outColor = [
    outColormatrix ? `Colormatrix: ${outColormatrix}` : null,
    outPrimaries ? `Primaries: ${outPrimaries}` : null,
    outTransfer ? `Transfer: ${outTransfer}` : null,
  ]
    .filter(Boolean)
    .join("  ");

  const dispPeak =
    parseNumber(displayPeak) ??
    parseNumber(targetPeak) ??
    parseNumber(vTargetParams?.["target-peak"]);
  const tMap = parseString(toneMapping);
  const showToneMap = tMap && tMap !== "no" && tMap !== "auto";

  // Video Stream Codec & Metrics (track codec-desc + [profile] in brackets)
  const selectedVTrack = trackList?.find(
    (t) =>
      t.type === "video" &&
      (t.selected || trackList.filter((x) => x.type === "video").length === 1),
  );
  const vCodecDesc = parseString(selectedVTrack?.["codec-desc"]) || parseString(videoCodec);
  const vProfile = parseString(selectedVTrack?.["codec-profile"]) || parseString(videoCodecProfile);
  const vDecoder = parseString(selectedVTrack?.decoder);
  const vCodecShort = parseString(selectedVTrack?.codec);
  let vCodecDisplay = vCodecDesc || "Video";
  if (vProfile) {
    vCodecDisplay += ` [${vProfile}]`;
  }
  if (vDecoder && vCodecShort && vDecoder !== vCodecShort) {
    vCodecDisplay += ` [${vDecoder}]`;
  }

  const hwdecName = parseString(hwdec);
  const hwText = hwdecName && hwdecName !== "no" ? hwdecName : "no";

  const fps = parseNumber(containerFps) ?? parseNumber(estimatedFps);
  const vFps = fps != null ? `${fps.toFixed(3)} fps` : "—";

  // Video resolution with aspect ratio tag: e.g. "3840 x 2160  1.78:1 (16:9)"
  const vRes = formatVideoResolution(vOutParams ?? vParams);

  // In native mpv stats.lua: append_img_params(s, r, ro) sets `r = ro or r`
  // ro is video-out-params, r is video-params. Filtered output properties take precedence!
  const activeVParams = vOutParams && Object.keys(vOutParams).length > 0 ? vOutParams : vParams;

  const vFmtName =
    parseString(activeVParams?.["hw-pixelformat"]) ||
    parseString(activeVParams?.pixelformat) ||
    parseString(vParams?.["hw-pixelformat"]) ||
    parseString(vParams?.pixelformat);
  const vLevels = parseString(activeVParams?.colorlevels) || parseString(vParams?.colorlevels);
  const vChroma =
    parseString(activeVParams?.["chroma-location"]) || parseString(vParams?.["chroma-location"]);
  const vFmt = [
    vFmtName ? `Format: ${vFmtName}` : null,
    vLevels ? `Levels: ${vLevels}` : null,
    vChroma && vChroma !== "unknown" ? `Chroma Loc: ${vChroma}` : null,
  ]
    .filter(Boolean)
    .join("  ");

  const vMatrix = parseString(activeVParams?.colormatrix) || parseString(vParams?.colormatrix);
  const vPrim = parseString(activeVParams?.primaries) || parseString(vParams?.primaries);
  const vTrc = parseString(activeVParams?.gamma) || parseString(vParams?.gamma);
  const vColor = [
    vMatrix ? `Colormatrix: ${vMatrix}` : null,
    vPrim ? `Primaries: ${vPrim}` : null,
    vTrc ? `Transfer: ${vTrc}` : null,
  ]
    .filter(Boolean)
    .join("  ");

  const vBitrate = videoBitrate ? `${(videoBitrate / 1000).toFixed(0)} kbps` : "—";

  // Video Filters: formatted with labels and graph params matching native mpv
  const vFiltersList = formatFilters(vfRaw ?? vfOsd);
  const vFiltersFormatted =
    vFiltersList.length === 1 && vFiltersList[0] === "none"
      ? "Filters: none"
      : `Filters:\n  ${vFiltersList.join("\n  ")}`;

  // Dynamic Dolby Vision & HDR Detection across direct properties, dictionaries & tracks
  const dovi = detectDolbyVision(
    vParams,
    doviProfProp,
    doviLevelProp,
    doviRpuProp,
    videoCodecProfile,
    filteredMetadata,
    trackList,
  );
  const hdr = detectHdr(vParams, vTargetParams, vOutParams, dovi, {
    maxCll: parseNumber(directMaxCll ?? outMaxCll),
    maxFall: parseNumber(directMaxFall ?? outMaxFall),
    minLuma: parseNumber(directMinLuma),
    maxLuma: parseNumber(directMaxLuma),
    sigPeak: parseNumber(directSigPeak ?? outSigPeak),
  });

  // Audio Stream Metrics (track codec-desc + [profile] in brackets + ASCII arrow)
  const selectedATrack = trackList?.find(
    (t) =>
      t.type === "audio" &&
      (t.selected || trackList.filter((x) => x.type === "audio").length === 1),
  );
  const aCodecDesc =
    parseString(selectedATrack?.["codec-desc"]) ||
    parseString(audioCodecName) ||
    parseString(audioCodec, "Audio");
  const aProfile = parseString(selectedATrack?.["codec-profile"]);
  const aCodecDisplay = aProfile ? `${aCodecDesc} [${aProfile}]` : aCodecDesc;

  const aoText = parseString(ao, "wasapi");
  const aDev = parseString(audioDevice, "Autoselect device");
  const volText = aoVolume != null ? `${Math.round(aoVolume)}%` : "100%";
  const aChCount =
    parseNumber(selectedATrack?.["demux-channel-count"]) ??
    parseNumber(aParams?.["channel-count"]) ??
    parseNumber(aParams?.channels);
  const aCh = aChCount != null ? String(aChCount) : parseString(aParams?.channels, "—");

  const aInFmt = parseString(aParams?.format);
  const aOutFmt = parseString(aOutParams?.format);
  const aFmt =
    aInFmt && aOutFmt && aInFmt !== aOutFmt ? `${aInFmt} -> ${aOutFmt}` : aOutFmt || aInFmt || "—";

  const aRate = parseNumber(aParams?.samplerate) ?? parseNumber(aOutParams?.samplerate);
  const aRateText = aRate ? `${aRate} Hz` : "—";
  const aBitrate = audioBitrate ? `${(audioBitrate / 1000).toFixed(0)} kbps` : "—";

  // Audio Filters
  const aFiltersList = formatFilters(afRaw ?? afOsd);
  const aFiltersFormatted =
    aFiltersList.length === 1 && aFiltersList[0] === "none"
      ? "Filters: none"
      : `Filters:\n  ${aFiltersList.join("\n  ")}`;

  // Construct Page 1
  const displayLines: string[] = [
    `Display: ${display}`,
    `A-V: ${av}`,
    `Refresh Rate: ${refresh}`,
    `Dropped Frames: ${drops}`,
    `Frame Timings: (last/average/peak µs)`,
    `  ${freshSummary}`,
    `  ${redrawSummary}`,
  ];
  if (outRes) displayLines.push(`Resolution: ${outRes}`);
  if (outFmt) displayLines.push(outFmt);
  if (outColor) displayLines.push(outColor);
  if (dispPeak != null && dispPeak > 0 && (outTransfer === "pq" || outTransfer === "hlg")) {
    displayLines.push(`HDR10: Display: 0 / ${Math.round(dispPeak)} cd/m²`);
  }
  if (showToneMap) {
    displayLines.push(`Tone Mapping: ${tMap}`);
  }

  const videoLines: string[] = [
    `Video: ${vCodecDisplay}  HW: ${hwText}`,
    `Frame Rate: ${vFps}`,
    `Resolution: ${vRes}`,
  ];
  if (vFmt) videoLines.push(vFmt);
  if (vColor) videoLines.push(vColor);

  // Dolby Vision: On Page 1, only rendered when stream is actually outputting Dolby Vision (not stripped to HDR10 via dolbyvision=no). Demuxer track details are on Page 5.
  if (dovi.detected && (vMatrix === "dolbyvision" || vMatrix?.includes("dolby"))) {
    const doviParts = [
      dovi.profile ? `Profile: ${dovi.profile}` : null,
      dovi.level ? `Level: ${dovi.level}` : null,
      dovi.rpu ? "RPU: present" : null,
    ].filter(Boolean);
    videoLines.push(`Dolby Vision: ${doviParts.length > 0 ? doviParts.join("  ") : "Detected"}`);
  }

  // HDR Metadata: Formatted on a single unified line matching native mpv
  if (hdr.isHdr) {
    if (hdr.type && !dovi.detected && hdr.type !== "HDR10") {
      videoLines.push(`HDR Format: ${hdr.type}`);
    }

    const hasDml =
      (hdr.minLuma != null && Math.abs(hdr.minLuma - 0.203) > 1e-4) ||
      (hdr.maxLuma != null && Math.abs(hdr.maxLuma - 203) > 1e-4);
    const hasCll = hdr.maxCll != null && hdr.maxCll > 0;
    const hasFall = hdr.maxFall != null && hdr.maxFall > 0;

    if (hasDml || hasCll || hasFall) {
      const parts: string[] = [];
      if (hasDml) {
        const minL = hdr.minLuma != null && hdr.minLuma <= 1e-6 ? 0 : hdr.minLuma;
        const minStr =
          minL != null ? (minL === 0 ? "0" : minL < 0.01 ? minL.toFixed(4) : minL.toFixed(2)) : "0";
        const maxStr = hdr.maxLuma != null ? Math.round(hdr.maxLuma).toString() : "1000";
        parts.push(`Mastering display: ${minStr} / ${maxStr} cd/m²`);
      }
      if (hasCll) {
        parts.push(`MaxCLL: ${Math.round(hdr.maxCll!)} cd/m²`);
      }
      if (hasFall) {
        parts.push(`MaxFALL: ${Math.round(hdr.maxFall!)} cd/m²`);
      }
      videoLines.push(`HDR10: ${parts.join("  ")}`);
    }

    // Dynamic PQ(Y) Frame Luminance
    const maxPq = parseNumber(maxPqYVal ?? vOutParams?.["max-pq-y"] ?? vParams?.["max-pq-y"]);
    const avgPq = parseNumber(avgPqYVal ?? vOutParams?.["avg-pq-y"] ?? vParams?.["avg-pq-y"]);
    if (maxPq != null && avgPq != null && maxPq > 0) {
      const maxNit = pqEotf(maxPq);
      const avgNit = pqEotf(avgPq);
      videoLines.push(
        `PQ(Y): Max: ${maxNit.toFixed(2)} cd/m² (${(maxPq * 100).toFixed(2)}% PQ)  Avg: ${avgNit.toFixed(2)} cd/m² (${(avgPq * 100).toFixed(2)}% PQ)`,
      );
    } else if (hdr.sigPeak != null && hdr.sigPeak > 0) {
      videoLines.push(`Signal Peak: ${hdr.sigPeak.toFixed(1)} cd/m²`);
    }
  }

  videoLines.push(`Bitrate: ${vBitrate}`);
  videoLines.push(vFiltersFormatted);

  const audioLines: string[] = [
    `Audio: ${aCodecDisplay}  AO: ${aoText}`,
    `Device: ${aDev}  AO Volume: ${volText}`,
    `Channels: ${aCh}  Format: ${aFmt}`,
    `Sample Rate: ${aRateText}`,
    `Bitrate: ${aBitrate}`,
    aFiltersFormatted,
  ];

  return `File: ${filename}
${title ? `Title: ${title}\n` : ""}${chapterLine ? `${chapterLine}\n` : ""}Size: ${size}  Format/Protocol: ${fmt}
Total Cache: ${totalCache}

${displayLines.join("\n")}

${videoLines.join("\n")}

${audioLines.join("\n")}`;
}

// -------------------------------------------------------------
// PAGE 2: Frame Timings & Shader Passes
// -------------------------------------------------------------
type VoPassEntry = {
  desc: string;
  last: number;
  avg: number;
  peak: number;
  count?: number;
};

function ppUs(ns: number | undefined): string {
  const us = Math.round((ns || 0) / 1000);
  return String(us).padStart(6, " ");
}

async function fetchPage2(): Promise<string> {
  const [passes, shaders] = await Promise.all([
    getMpvProp<{ fresh?: VoPassEntry[]; redraw?: VoPassEntry[] }>("vo-passes"),
    getMpvProp<string | string[]>("glsl-shaders"),
  ]);

  const lines: string[] = ["Frame Timings: (last/average/peak µs) (hint: scroll with UP/DOWN)"];

  // Active GLSL Shaders chain
  const shaderList = Array.isArray(shaders)
    ? shaders
    : typeof shaders === "string" && shaders.trim()
      ? shaders
          .split(/[;,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  if (shaderList.length > 0) {
    lines.push(`\nActive Shaders (${shaderList.length}):`);
    for (const sh of shaderList) {
      lines.push(`  • ${sh}`);
    }
  }

  if (passes?.fresh && passes.fresh.length > 0) {
    lines.push("\nFresh:");
    const fTotalLast = passes.fresh.reduce((sum, p) => sum + (p.last || 0), 0);
    const fTotalAvg = passes.fresh.reduce((sum, p) => sum + (p.avg || 0), 0);
    const fTotalPeak = passes.fresh.reduce((sum, p) => sum + (p.peak || 0), 0);

    for (const p of passes.fresh) {
      const pct = fTotalAvg > 0 ? Math.round(((p.avg || 0) / fTotalAvg) * 100) : 0;
      const timing = `${ppUs(p.last)} / ${ppUs(p.avg)} / ${ppUs(p.peak)}`;
      lines.push(`  ${timing}   ${pct.toString().padStart(3)}%  ${p.desc}`);
    }
    const totalTiming = `${ppUs(fTotalLast)} / ${ppUs(fTotalAvg)} / ${ppUs(fTotalPeak)}`;
    lines.push(`  ${totalTiming}   Total`);
  }

  if (passes?.redraw && passes.redraw.length > 0) {
    lines.push("\nRedraw:");
    const rTotalLast = passes.redraw.reduce((sum, p) => sum + (p.last || 0), 0);
    const rTotalAvg = passes.redraw.reduce((sum, p) => sum + (p.avg || 0), 0);
    const rTotalPeak = passes.redraw.reduce((sum, p) => sum + (p.peak || 0), 0);

    for (const p of passes.redraw) {
      const pct = rTotalAvg > 0 ? Math.round(((p.avg || 0) / rTotalAvg) * 100) : 0;
      const timing = `${ppUs(p.last)} / ${ppUs(p.avg)} / ${ppUs(p.peak)}`;
      lines.push(`  ${timing}   ${pct.toString().padStart(3)}%  ${p.desc}`);
    }
    const totalTiming = `${ppUs(rTotalLast)} / ${ppUs(rTotalAvg)} / ${ppUs(rTotalPeak)}`;
    lines.push(`  ${totalTiming}   Total`);
  }

  if (lines.length === 1) {
    lines.push("\nNo active video passes or shaders reported.");
  }

  return lines.join("\n");
}

// -------------------------------------------------------------
// PAGE 3: Cache Info
// -------------------------------------------------------------
type CacheState = {
  "reader-pts"?: number;
  "cache-end"?: number;
  "bof-cached"?: boolean;
  "eof-cached"?: boolean;
  "total-bytes"?: number;
  "fw-bytes"?: number;
  "file-cache-bytes"?: number;
  "raw-input-rate"?: number;
  "seekable-ranges"?: Array<{ start: number; end: number }>;
};

async function fetchPage3(): Promise<string> {
  const [cache, readahead, timePos, bufferingState, cacheSpeed] = await Promise.all([
    getMpvProp<CacheState>("demuxer-cache-state"),
    getMpvProp<number>("demuxer-cache-duration"),
    getMpvProp<number>("time-pos"),
    getMpvProp<number>("cache-buffering-state"),
    getMpvProp<number>("cache-speed"),
  ]);

  const pos = timePos || 0;
  const startPts = cache?.["reader-pts"] != null ? cache["reader-pts"] : pos;
  const endPts = cache?.["cache-end"] != null ? cache["cache-end"] : pos + (readahead || 0);

  const speedVal = cache?.["raw-input-rate"] ?? cacheSpeed;
  const speed =
    speedVal != null && speedVal > 0
      ? `${(speedVal / (1024 * 1024)).toFixed(2)} MB/s (${speedVal.toFixed(0)} B/s)`
      : "0.00 B/s";
  const ram = formatBytes(cache?.["total-bytes"]);
  const fwRam = formatBytes(cache?.["fw-bytes"]);
  const disk = cache?.["file-cache-bytes"] ? formatBytes(cache["file-cache-bytes"]) : "(disabled)";
  const state = cache?.["eof-cached"]
    ? "eof"
    : bufferingState != null && bufferingState < 100
      ? `buffering (${bufferingState}%)`
      : readahead && readahead > 0
        ? "buffering / ready"
        : "idle";

  const ranges = cache?.["seekable-ranges"] || [];
  const rangeLines =
    ranges.length > 0
      ? ranges.map(
          (r, i) => `  Range ${i + 1}: ${formatDuration(r.start)} - ${formatDuration(r.end)}`,
        )
      : [`  Range 1: ${formatDuration(startPts)} - ${formatDuration(endPts)}`];

  return `Cache Info:
Packet-Queue: ${formatDuration(startPts)} - ${formatDuration(endPts)}
Readahead: ${formatDuration(readahead || 0)}
State: ${state}
Speed: ${speed}
Total RAM: ${ram}
Forward RAM: ${fwRam}
Disk Cache: ${disk}
Ranges:
  Start Cached: ${cache?.["bof-cached"] ? "yes" : "no"}
  End Cached: ${cache?.["eof-cached"] ? "yes" : "no"}
${rangeLines.join("\n")}`;
}

// -------------------------------------------------------------
// PAGE 4: Active Key Bindings
// -------------------------------------------------------------
type BindingEntry = {
  key: string;
  cmd: string;
  comment?: string;
  priority?: number;
};

const OFFICIAL_MPV_KEYBINDS: BindingEntry[] = [
  // Seek / Playback
  { key: "SPACE", cmd: "cycle pause", comment: "toggle pause/playback mode" },
  { key: "p", cmd: "cycle pause", comment: "toggle pause/playback mode" },
  { key: "RIGHT", cmd: "seek 5", comment: "seek 5 seconds forward" },
  { key: "LEFT", cmd: "seek -5", comment: "seek 5 seconds backward" },
  { key: "UP", cmd: "seek 60", comment: "seek 1 minute forward" },
  { key: "DOWN", cmd: "seek -60", comment: "seek 1 minute backward" },
  { key: "Shift+RIGHT", cmd: "seek 1 exact", comment: "exact seek 1s forward" },
  { key: "Shift+LEFT", cmd: "seek -1 exact", comment: "exact seek 1s backward" },
  { key: "Shift+UP", cmd: "seek 5 exact", comment: "exact seek 5s forward" },
  { key: "Shift+DOWN", cmd: "seek -5 exact", comment: "exact seek -5s backward" },
  { key: "Ctrl+LEFT", cmd: "sub-seek -1", comment: "seek to previous subtitle" },
  { key: "Ctrl+RIGHT", cmd: "sub-seek 1", comment: "seek to next subtitle" },
  { key: ".", cmd: "frame-step", comment: "advance one frame and pause" },
  { key: ",", cmd: "frame-back-step", comment: "go back one frame and pause" },
  { key: ">", cmd: "playlist-next", comment: "skip to next file" },
  { key: "<", cmd: "playlist-prev", comment: "skip to previous file" },
  // Speed
  { key: "[", cmd: "multiply speed 1/1.1", comment: "scale playback speed down" },
  { key: "]", cmd: "multiply speed 1.1", comment: "scale playback speed up" },
  { key: "{", cmd: "multiply speed 0.5", comment: "halve playback speed" },
  { key: "}", cmd: "multiply speed 2.0", comment: "double playback speed" },
  { key: "BS", cmd: "set speed 1.0", comment: "reset playback speed to normal" },
  // Audio & Volume
  { key: "9", cmd: "add volume -2", comment: "decrease volume" },
  { key: "0", cmd: "add volume 2", comment: "increase volume" },
  { key: "/", cmd: "add volume -2", comment: "decrease volume" },
  { key: "*", cmd: "add volume 2", comment: "increase volume" },
  { key: "m", cmd: "cycle mute", comment: "toggle mute" },
  { key: "#", cmd: "cycle audio", comment: "switch audio track" },
  { key: "Ctrl++", cmd: "add audio-delay 0.1", comment: "shift audio 100 ms" },
  { key: "Ctrl+-", cmd: "add audio-delay -0.1", comment: "shift audio -100 ms" },
  // Subtitles
  { key: "v", cmd: "cycle sub-visibility", comment: "hide/show subtitles" },
  { key: "j", cmd: "cycle sub", comment: "switch subtitle track" },
  { key: "J", cmd: "cycle sub down", comment: "switch subtitle track backwards" },
  { key: "z", cmd: "add sub-delay -0.1", comment: "shift subtitles -100 ms" },
  { key: "Z", cmd: "add sub-delay 0.1", comment: "shift subtitles 100 ms" },
  { key: "r", cmd: "add sub-pos -1", comment: "move subtitles up" },
  { key: "R", cmd: "add sub-pos +1", comment: "move subtitles down" },
  { key: "u", cmd: 'cycle-values sub-ass-override "force" "no"', comment: "toggle style override" },
  { key: "V", cmd: "cycle sub-ass-vsfilter-aspect-compat", comment: "toggle aspect compatibility" },
  // Video & Window
  { key: "f", cmd: "cycle fullscreen", comment: "toggle fullscreen" },
  { key: "s", cmd: "screenshot", comment: "take screenshot with subtitles" },
  { key: "S", cmd: "screenshot video", comment: "take screenshot without subtitles" },
  { key: "Ctrl+s", cmd: "screenshot window", comment: "take screenshot of player window" },
  { key: "w", cmd: "add panscan -0.1", comment: "zoom out / reduce panscan" },
  { key: "W", cmd: "add panscan 0.1", comment: "zoom in / increase panscan" },
  {
    key: "A",
    cmd: 'cycle-values video-aspect-override "16:9" "4:3" "2.35:1" "-1"',
    comment: "cycle aspect ratio",
  },
  { key: "_", cmd: "cycle video", comment: "switch video track" },
  // Video Equalizer
  { key: "1", cmd: "add contrast -1", comment: "decrease contrast" },
  { key: "2", cmd: "add contrast 1", comment: "increase contrast" },
  { key: "3", cmd: "add brightness -1", comment: "decrease brightness" },
  { key: "4", cmd: "add brightness 1", comment: "increase brightness" },
  { key: "5", cmd: "add gamma -1", comment: "decrease gamma" },
  { key: "6", cmd: "add gamma 1", comment: "increase gamma" },
  { key: "7", cmd: "add saturation -1", comment: "decrease saturation" },
  { key: "8", cmd: "add saturation 1", comment: "increase saturation" },
  // OSD & Script Bindings
  { key: "o", cmd: "show-progress", comment: "show playback progress bar" },
  { key: "P", cmd: "show-progress", comment: "show playback progress bar" },
  { key: "O", cmd: "no-osd cycle-values osd-level 3 1", comment: "toggle OSD level" },
  {
    key: "i",
    cmd: "script-binding stats/display-stats-toggle",
    comment: "toggle playback statistics",
  },
  {
    key: "I",
    cmd: "script-binding stats/display-stats-toggle",
    comment: "toggle playback statistics",
  },
  { key: "`", cmd: "script-binding console/enable", comment: "open interactive console" },
  { key: "q", cmd: "quit", comment: "exit player" },
  { key: "Q", cmd: "quit-watch-later", comment: "save position and exit" },
];

async function fetchPage4(): Promise<string> {
  const [inputBinds, bindingList] = await Promise.all([
    getMpvProp<BindingEntry[]>("input-bindings"),
    getMpvProp<BindingEntry[]>("binding-list"),
  ]);

  const rawList: BindingEntry[] = [];
  if (Array.isArray(inputBinds) && inputBinds.length > 0) {
    rawList.push(...inputBinds);
  } else if (Array.isArray(bindingList) && bindingList.length > 0) {
    rawList.push(...bindingList);
  }

  // Combine with official mpv defaults
  const keyMap = new Map<string, BindingEntry>();
  for (const b of OFFICIAL_MPV_KEYBINDS) {
    if (b.key) keyMap.set(b.key, b);
  }
  for (const b of rawList) {
    if (b.key && b.cmd) keyMap.set(b.key, b);
  }

  const list = Array.from(keyMap.values());
  if (list.length === 0) {
    return "Active Key Bindings: (hint: scroll with UP/DOWN and search with /)\n\nNo bindings found.";
  }

  // Group bindings by category (first word of command)
  const groups: Record<string, BindingEntry[]> = {};
  for (const b of list) {
    if (!b.cmd || !b.key) continue;
    const cat = b.cmd.trim().split(/\s+/)[0].toLowerCase() || "misc";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(b);
  }

  const sortedCats = Object.keys(groups).sort();
  const lines: string[] = ["Active Key Bindings: (hint: scroll with UP/DOWN and search with /)"];

  for (const cat of sortedCats) {
    lines.push(`\n${cat}`);
    for (const b of groups[cat]) {
      const comment = b.comment ? ` # ${b.comment}` : "";
      lines.push(`  ${b.key.padEnd(16)} ${b.cmd}${comment}`);
    }
  }

  return lines.join("\n");
}

// -------------------------------------------------------------
// PAGE 5: Selected Tracks Info
// -------------------------------------------------------------
async function fetchPage5(): Promise<string> {
  const [path, mediaTitle, duration, chapter, fileSize, fileFormat, trackList] = await Promise.all([
    getMpvProp<string>("path"),
    getMpvProp<string>("media-title"),
    getMpvProp<number>("duration"),
    getMpvProp<string>("chapter-metadata/title") ||
      getMpvProp<string>("chapter-list/by-current/title"),
    getMpvProp<number>("file-size"),
    getMpvProp<string>("file-format"),
    getMpvProp<TrackEntry[]>("track-list"),
  ]);

  const filename = path ? path.replace(/^.*[\\/]/, "") : "Unknown";
  const title = mediaTitle || filename;
  const dur = formatDuration(duration);
  const size = formatBytes(fileSize);
  const fmt = parseString(fileFormat, "stream");

  const lines: string[] = [
    "Tracks Info: (hint: scroll with UP/DOWN)",
    `File: ${filename}`,
    `Title: ${title}`,
    `Duration: ${dur}`,
  ];
  if (chapter) lines.push(`Chapter: ${chapter}`);
  lines.push(`Size: ${size}  Format/Protocol: ${fmt}`);

  const tracks = trackList || [];
  const videos = tracks.filter((t) => t.type === "video");
  const audios = tracks.filter((t) => t.type === "audio");
  const subs = tracks.filter((t) => t.type === "sub");

  if (videos.length > 0) {
    lines.push("\nVideo:");
    for (const t of videos) {
      lines.push(
        `  ID: ${t.id}  Demuxer ID: ${t["src-id"] ?? t.id}  FFmpeg Index: ${t["ff-index"] ?? 0}`,
      );
      const flags = [
        t.default ? "default" : "",
        t.external ? "external" : "original",
        t.selected ? "selected" : "",
      ]
        .filter(Boolean)
        .join(", ");
      if (flags) lines.push(`  Flags: ${flags}`);
      lines.push(`  Codec: ${t["decoder-desc"] || t.codec || "—"}`);
      const doviP = t["dolby-vision-profile"] ?? t["dovi-profile"];
      const doviL = t["dolby-vision-level"] ?? t["dovi-level"];
      if (doviP != null) {
        lines.push(`  Dolby Vision: Profile ${doviP}${doviL != null ? `  Level: ${doviL}` : ""}`);
      }
      if (t["demux-bitrate"])
        lines.push(`  Bitrate: ${(t["demux-bitrate"] / 1000).toFixed(2)} kbps`);
      if (t["demux-w"] && t["demux-h"])
        lines.push(`  Resolution: ${t["demux-w"]} x ${t["demux-h"]}`);
      if (t["demux-fps"]) lines.push(`  Frame Rate: ${t["demux-fps"].toFixed(3)} fps`);
    }
  }

  if (audios.length > 0) {
    lines.push("\nAudio:");
    for (const t of audios) {
      const heading = [t.lang, t.title].filter(Boolean).join(" - ");
      lines.push(
        `  ${heading ? `${heading} ` : ""}ID: ${t.id}  Demuxer ID: ${t["src-id"] ?? t.id}  FFmpeg Index: ${t["ff-index"] ?? 1}`,
      );
      const flags = [
        t.default ? "default" : "",
        t.external ? "external" : "original",
        t.selected ? "selected" : "",
      ]
        .filter(Boolean)
        .join(", ");
      if (flags) lines.push(`  Flags: ${flags}`);
      lines.push(`  Codec: ${t["decoder-desc"] || t.codec || "—"}`);
      if (t.lang) lines.push(`  Language: ${t.lang}`);
      const ch = t["demux-channel-count"] || t["demux-channels"];
      if (ch) lines.push(`  Channels: ${ch}`);
      if (t["demux-samplerate"]) lines.push(`  Sample Rate: ${t["demux-samplerate"]} Hz`);
      if (t["demux-bitrate"])
        lines.push(`  Bitrate: ${(t["demux-bitrate"] / 1000).toFixed(2)} kbps`);
    }
  }

  if (subs.length > 0) {
    lines.push("\nSub:");
    for (const t of subs) {
      const heading = [t.lang, t.title].filter(Boolean).join(" - ");
      lines.push(
        `  ${heading ? `${heading} ` : ""}ID: ${t.id}  FFmpeg Index: ${t["ff-index"] ?? 0}`,
      );
      if (t["external-filename"]) lines.push(`  File: ${t["external-filename"]}`);
      const flags = [
        t.default ? "default" : "",
        t.external ? "external" : "original",
        t.selected ? "selected" : "",
      ]
        .filter(Boolean)
        .join(", ");
      if (flags) lines.push(`  Flags: ${flags}`);
      lines.push(`  Codec: ${t["decoder-desc"] || t.codec || "—"}`);
      if (t.lang) lines.push(`  Language: ${t.lang}`);
    }
  }

  return lines.join("\n");
}

// -------------------------------------------------------------
// PAGE 0: Internal Performance Info & Loaded Scripts
// -------------------------------------------------------------
type PerfEntry = {
  name?: string;
  text?: string;
  value?: number;
};

async function fetchPage0(): Promise<string> {
  const [perfList, scriptsOpt] = await Promise.all([
    getMpvProp<PerfEntry[]>("perf-info"),
    getMpvProp<string[] | string>("options/scripts"),
  ]);

  const lines: string[] = [];
  lines.push("Internal Performance Info: (hint: scroll with UP/DOWN)\n");

  let hasEntries = false;
  if (Array.isArray(perfList) && perfList.length > 0) {
    hasEntries = true;
    for (let i = 0; i < perfList.length; i++) {
      const item = perfList[i];
      const name = item.name || `entry_${i + 1}`;
      const val = item.text ?? (item.value != null ? `${item.value} µs` : "");
      lines.push(`  [${i + 1}] ${name}: ${val}`);
    }
  }

  // Loaded Scripts section
  const loadedScripts: string[] = [];
  if (Array.isArray(scriptsOpt)) {
    loadedScripts.push(...scriptsOpt.filter(Boolean));
  } else if (typeof scriptsOpt === "string" && scriptsOpt.trim()) {
    loadedScripts.push(
      ...scriptsOpt
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  if (loadedScripts.length > 0) {
    lines.push("\nLoaded Scripts:");
    loadedScripts.forEach((s, idx) => {
      lines.push(`  [${idx + 1}] ${s}`);
    });
  }

  if (!hasEntries && loadedScripts.length === 0) {
    lines.push("  No internal performance counters registered yet.");
    lines.push("  (perf-info is populated during active playback and script execution)");
  }

  return lines.join("\n");
}

export type LineToken = {
  type: "key" | "val";
  text: string;
};

export function tokenizeStatsLine(line: string): LineToken[] {
  // Matches keys at line start (with optional indentation), after 2+ spaces, or after prefix keys
  const regex = /(?:^(\s*)|(\s{2,})|(?<=(?:HDR10|PQ\(Y\)):\s+))([A-Za-z0-9_#/@()[\]\-+ /]+:)/g;
  let lastIndex = 0;
  const tokens: LineToken[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    const fullMatch = match[0];
    const key = match[3];
    const matchStart = match.index;
    const keyStart = matchStart + (fullMatch.length - key.length);

    if (keyStart > lastIndex) {
      tokens.push({ type: "val", text: line.slice(lastIndex, keyStart) });
    }
    tokens.push({ type: "key", text: key });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < line.length) {
    tokens.push({ type: "val", text: line.slice(lastIndex) });
  }

  return tokens.length > 0 ? tokens : [{ type: "val", text: line }];
}

function renderFormattedValue(prevKey: string | null, text: string) {
  // 1. Dropped Frames: Highlight any positive drop counts in pure red text (no box)
  if (prevKey === "Dropped Frames:") {
    const parts: Array<{ abnormal: boolean; text: string }> = [];
    const regex = /(\b[1-9]\d*\s*\((?:decoder|output|mistimed|delayed)\))/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > lastIdx) parts.push({ abnormal: false, text: text.slice(lastIdx, m.index) });
      parts.push({ abnormal: true, text: m[1] });
      lastIdx = regex.lastIndex;
    }
    if (lastIdx < text.length) parts.push({ abnormal: false, text: text.slice(lastIdx) });
    return (
      <>
        {parts.map((p, idx) =>
          p.abnormal ? (
            <span key={idx} className="font-bold text-red-400">
              {p.text}
            </span>
          ) : (
            <span key={idx} className="text-ink">
              {p.text}
            </span>
          ),
        )}
      </>
    );
  }

  // 2. A-V Sync Drift: Pure red text if above zero or in bad condition (>= 50ms)
  if (prevKey === "A-V:") {
    const n = parseInt(text.replace(/[^0-9+-]/g, ""), 10);
    const isBadAv = !isNaN(n) && (n > 0 || Math.abs(n) >= 50);
    if (isBadAv) {
      return <span className="font-bold text-red-400">{text}</span>;
    }
    return <span className="text-ink">{text}</span>;
  }

  // 3. Cache State: Buffering / stall in red text
  if (prevKey === "State:" && text.includes("buffering")) {
    return <span className="font-bold text-red-400">{text}</span>;
  }

  // 4. HW Acceleration: Software fallback in amber warning
  if (prevKey === "HW:" && text.trim() === "no") {
    return <span className="font-semibold text-amber-400/90">{text}</span>;
  }

  return <span className="text-ink">{text}</span>;
}

function FormattedStatsLine({ line, pageIndex }: { line: string; pageIndex: number }) {
  // Empty line gives clean vertical rhythm between sections
  if (!line || !line.trim()) {
    return <div className="h-2" />;
  }

  const trimmed = line.trim();

  // Error lines
  if (trimmed.startsWith("Error")) {
    return <div className="font-bold text-red-400">{line}</div>;
  }

  // Page 4: Active Key Bindings specialized styling
  if (pageIndex === 4) {
    if (trimmed.startsWith("Active Key Bindings:")) {
      return (
        <div className="mb-2 border-b border-edge-soft/60 pb-1 font-bold text-accent text-[12px] tracking-wide">
          {line}
        </div>
      );
    }
    // Category title (e.g. "audio", "video", "misc")
    if (/^[a-z0-9_-]+$/i.test(trimmed)) {
      return (
        <div className="mt-3 mb-1 border-b border-edge-soft/40 pb-0.5 font-bold uppercase tracking-wider text-accent text-[11px]">
          {trimmed}
        </div>
      );
    }
    // Binding row: "  SPACE            cycle pause # comment"
    const bindMatch = line.match(/^(\s*)([^\s]+)(\s{2,})([^#]+)(#.*)?$/);
    if (bindMatch) {
      const [, indent, key, space, cmd, comment] = bindMatch;
      return (
        <div className="leading-relaxed whitespace-pre-wrap">
          <span>{indent}</span>
          <span className="rounded border border-accent/30 bg-accent/15 px-1.5 py-0.5 font-bold text-accent text-[11px]">
            {key}
          </span>
          <span>{space.length > 2 ? space.slice(2) : " "}</span>
          <span className="font-medium text-ink">{cmd.trim()}</span>
          {comment && <span className="ml-2 italic text-ink-subtle">{comment}</span>}
        </div>
      );
    }
  }

  // Major section headings across all pages
  if (
    trimmed === "Video:" ||
    trimmed === "Audio:" ||
    trimmed === "Sub:" ||
    trimmed === "Fresh:" ||
    trimmed === "Redraw:" ||
    trimmed === "Cache Info:" ||
    trimmed === "Ranges:" ||
    trimmed.startsWith("Tracks Info:") ||
    trimmed.startsWith("Active Shaders") ||
    trimmed.startsWith("Frame Timings:") ||
    trimmed.startsWith("Internal Performance Info:") ||
    trimmed.startsWith("Loaded Scripts:")
  ) {
    if (
      trimmed.startsWith("Frame Timings:") ||
      trimmed.startsWith("Active Shaders") ||
      trimmed.startsWith("Internal Performance Info:")
    ) {
      const colonIdx = trimmed.indexOf(":");
      const title = colonIdx !== -1 ? trimmed.slice(0, colonIdx + 1) : trimmed;
      const hint = colonIdx !== -1 ? trimmed.slice(colonIdx + 1) : "";
      return (
        <div className="mt-2.5 mb-1 border-b border-edge-soft/40 pb-0.5 font-bold text-accent text-[11.5px]">
          <span className="uppercase tracking-wider">{title}</span>
          {hint && (
            <span className="ml-1.5 text-[11px] font-normal normal-case text-ink-subtle">
              {hint}
            </span>
          )}
        </div>
      );
    }
    return (
      <div className="mt-2.5 mb-1 border-b border-edge-soft/40 pb-0.5 font-bold uppercase tracking-wider text-accent text-[11.5px]">
        {trimmed}
      </div>
    );
  }

  // Timing lines ending with Fresh, Redraw, or Total
  const timingMatch = line.match(
    /^(\s*)(\d+)(\s*\/\s*)(\d+)(\s*\/\s*)(\d+)(\s+)(Fresh|Redraw|Total)$/,
  );
  if (timingMatch) {
    const [, indent, last, s1, avg, s2, peak, space, suffix] = timingMatch;
    const nLast = Number(last);
    const nAvg = Number(avg);
    const nPeak = Number(peak);
    // Overrun threshold for whole frame timing summary: >= 25,000 µs (25ms) or peak >= 50,000 µs
    const isOverrun = (val: number) => val >= 25000;
    const isPeakOverrun = (val: number) => val >= 50000;
    return (
      <div className="leading-relaxed whitespace-pre-wrap">
        <span>{indent}</span>
        <span className={isOverrun(nLast) ? "font-bold text-red-400" : "text-ink"}>{last}</span>
        <span>{s1}</span>
        <span className={isOverrun(nAvg) ? "font-bold text-red-400" : "text-ink"}>{avg}</span>
        <span>{s2}</span>
        <span className={isPeakOverrun(nPeak) ? "font-bold text-red-400" : "text-ink"}>{peak}</span>
        <span>{space}</span>
        <span className="font-bold text-accent">{suffix}</span>
      </div>
    );
  }

  // Page 2: Individual pass timing row: "     570 /     483 /    1311     5%  map frame (hwdec)"
  const passMatch = line.match(/^(\s*)(\d+)(\s*\/\s*)(\d+)(\s*\/\s*)(\d+)(\s+)(\d+%)(\s+)(.*)$/);
  if (passMatch) {
    const [, indent, last, s1, avg, s2, peak, sp1, pct, sp2, desc] = passMatch;
    const nLast = Number(last);
    const nAvg = Number(avg);
    const nPeak = Number(peak);
    const nPct = parseInt(pct, 10);
    // An individual shader pass is abnormal only if it single-handedly consumes >= 16,666 µs (16.6ms) or >= 80% of frame time
    const isPassLag = (val: number) => val >= 16666;
    const isPassPeakLag = (val: number) => val >= 33333;
    return (
      <div className="leading-relaxed whitespace-pre-wrap">
        <span>{indent}</span>
        <span className={isPassLag(nLast) ? "font-bold text-red-400" : "text-ink"}>{last}</span>
        <span>{s1}</span>
        <span className={isPassLag(nAvg) ? "font-bold text-red-400" : "text-ink"}>{avg}</span>
        <span>{s2}</span>
        <span className={isPassPeakLag(nPeak) ? "font-bold text-red-400" : "text-ink"}>{peak}</span>
        <span>{sp1}</span>
        <span className={nPct >= 80 ? "font-bold text-red-400" : "text-ink"}>{pct}</span>
        <span>{sp2}</span>
        <span className="text-ink">{desc}</span>
      </div>
    );
  }

  // Tokenize parameter keys & values
  const tokens = tokenizeStatsLine(line);
  let currentKey: string | null = null;
  return (
    <div className="leading-relaxed whitespace-pre-wrap">
      {tokens.map((t, i) => {
        if (t.type === "key") {
          currentKey = t.text;
          return (
            <span key={i} className="font-bold text-accent tracking-wide">
              {t.text}
            </span>
          );
        }
        return <span key={i}>{renderFormattedValue(currentKey, t.text)}</span>;
      })}
    </div>
  );
}

export const KeybindStatsOverlay = memo(function KeybindStatsOverlay({
  snap: _snap,
  engine: _engine,
  page,
  onPageChange,
  onClose,
  showStats,
}: {
  snap?: PlayerSnapshot;
  engine?: string;
  page?: 0 | 1 | 2 | 3 | 4 | 5;
  onPageChange?: (page: 0 | 1 | 2 | 3 | 4 | 5) => void;
  onClose?: () => void;
  showStats?: boolean;
}) {
  const { settings } = useSettings();
  const [activePage, setActivePage] = useState<number | null>(showStats ? (page ?? 1) : null);
  const [pageContent, setPageContent] = useState<string>("");
  const pollTimerRef = useRef<number | null>(null);

  // Sync with player showStats / page props
  useEffect(() => {
    if (showStats !== undefined) {
      setActivePage(showStats ? (page ?? 1) : null);
    }
  }, [showStats, page]);

  const handleClose = useCallback(() => {
    setActivePage(null);
    onClose?.();
  }, [onClose]);

  const handleTabClick = useCallback(
    (id: 0 | 1 | 2 | 3 | 4 | 5) => {
      setActivePage(id);
      onPageChange?.(id);
    },
    [onPageChange],
  );

  const fetchCurrentPage = useCallback(async (page: number) => {
    let text = "";
    try {
      if (page === 0) text = await fetchPage0();
      else if (page === 1) text = await fetchPage1();
      else if (page === 2) text = await fetchPage2();
      else if (page === 3) text = await fetchPage3();
      else if (page === 4) text = await fetchPage4();
      else if (page === 5) text = await fetchPage5();
      else text = await fetchPage1();
    } catch (e) {
      text = `Error loading Page ${page}: ${String(e)}`;
    }
    setPageContent(text);
  }, []);

  // Listen for keybind events dispatched by use-keyboard-shortcuts
  useEffect(() => {
    const handleToggle = (e: Event) => {
      if (!settings.mpvDetailedStats) return;
      const ce = e as CustomEvent<{ page?: number }>;
      const targetPage = ce.detail?.page ?? 1;
      setActivePage((prev) => (prev === targetPage ? null : targetPage));
      if (targetPage >= 0 && targetPage <= 5) {
        onPageChange?.(targetPage as 0 | 1 | 2 | 3 | 4 | 5);
      }
    };

    const handleHide = () => {
      setActivePage(null);
      onClose?.();
    };

    window.addEventListener("harbor:toggle-stats-page", handleToggle);
    window.addEventListener("harbor:stats-hide", handleHide);

    return () => {
      window.removeEventListener("harbor:toggle-stats-page", handleToggle);
      window.removeEventListener("harbor:stats-hide", handleHide);
    };
  }, [settings.mpvDetailedStats, onClose, onPageChange]);

  // Polling loop while visible
  useEffect(() => {
    if (activePage == null || !settings.mpvDetailedStats) {
      setPageContent("");
      if (pollTimerRef.current != null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    void fetchCurrentPage(activePage);

    pollTimerRef.current = window.setInterval(() => {
      void fetchCurrentPage(activePage);
    }, 750);

    return () => {
      if (pollTimerRef.current != null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [activePage, settings.mpvDetailedStats, fetchCurrentPage]);

  // Handle keyboard page switching (0-5) and Escape when open
  useEffect(() => {
    if (activePage == null || !settings.mpvDetailedStats) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
        return;
      }
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 0 && num <= 5 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        handleTabClick(num as 0 | 1 | 2 | 3 | 4 | 5);
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [activePage, settings.mpvDetailedStats, handleClose, handleTabClick]);

  if (!settings.mpvDetailedStats || activePage == null) return null;

  return (
    <div
      role="region"
      aria-label={`MPV Stats - Page ${activePage}`}
      className="pointer-events-auto fixed start-6 top-14 z-[99999] flex w-[700px] max-w-[calc(100vw-48px)] select-none flex-col rounded-2xl border border-edge-soft bg-canvas/92 p-4 font-mono text-[11.5px] leading-relaxed text-ink shadow-[0_24px_70px_-15px_rgba(0,0,0,0.85)] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:slide-in-from-top-2 motion-safe:duration-200 motion-safe:ease-out"
    >
      {/* Top Tab Bar - Clickable Tabs for Easy Page Switching */}
      <div className="mb-2.5 flex items-center justify-between border-b border-edge-soft/60 pb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATS_TABS.map((tab) => {
            const active = activePage === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabClick(tab.id)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold transition-all duration-150 ease-out ${
                  active
                    ? "bg-accent/20 text-accent ring-1 ring-accent/40 shadow-[0_0_12px_rgba(249,115,22,0.15)]"
                    : "text-ink-muted hover:bg-surface/80 hover:text-ink"
                }`}
              >
                <span className={active ? "text-accent font-bold" : "opacity-50"}>{tab.id}:</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-surface hover:text-ink"
          aria-label="Close stats"
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>

      {/* Inner Box with its own subtle background, sheen & smooth tab cross-fade */}
      <div
        key={activePage}
        className="max-h-[75vh] overflow-y-auto rounded-xl border border-edge-soft/50 bg-surface/50 p-3.5 shadow-inner font-mono text-[11.5px] leading-relaxed text-ink select-text animate-in fade-in-50 duration-150 ease-out"
      >
        {pageContent ? (
          pageContent
            .split("\n")
            .map((line, idx) => <FormattedStatsLine key={idx} line={line} pageIndex={activePage} />)
        ) : (
          <div className="text-ink-subtle">Loading statistics...</div>
        )}
      </div>

      {/* Bottom Shortcuts Helper */}
      <div className="mt-2.5 flex items-center justify-between text-[10px] text-ink-subtle">
        <span>MPV Native Stats (Unbound)</span>
        <span>Click tabs or press 0-5 to switch • Esc or i to close</span>
      </div>
    </div>
  );
});
