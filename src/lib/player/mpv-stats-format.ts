/**
 * Pure MPV stats formatting and conversion utilities.
 * Independent of React and UI rendering so they can be unit-tested directly.
 */

export type LineToken = {
  type: "key" | "val";
  text: string;
};

export function parseString(val: unknown, fallback = ""): string {
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

export function parseNumber(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function pqEotf(x: number | null | undefined): number {
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

export function getAspectName(aspect: number): string | null {
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

export function formatCanvasResolution(
  r: Record<string, unknown> | null,
  od?: Record<string, unknown> | null,
  directAspectName?: string | null,
): string | null {
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

  const isNoop = cropX === 0 && cropY === 0 && cropW === w && cropH === h;
  if (!isNoop && cropW != null && cropH != null) {
    res += `  [x: ${cropX ?? 0}, y: ${cropY ?? 0}, w: ${cropW}, h: ${cropH}]`;
  }

  return res;
}

export function formatVideoResolution(
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

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || isNaN(bytes) || bytes <= 0) return "0.00 MiB";
  const mib = bytes / (1024 * 1024);
  if (mib >= 1024) return `${(mib / 1024).toFixed(3)} GiB`;
  return `${mib.toFixed(2)} MiB`;
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || isNaN(sec) || sec < 0) return "00:00:00";
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function tokenizeStatsLine(line: string): LineToken[] {
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
