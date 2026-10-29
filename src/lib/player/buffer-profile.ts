import { getTotalPhysBytes } from "@/lib/native-memory";

export type BufferSizeId = "auto" | "small" | "medium" | "large" | "max";

export const BUFFER_SIZES: readonly BufferSizeId[] = [
  "auto",
  "small",
  "medium",
  "large",
  "max",
] as const;

export type BufferProfile = {
  cacheSecs: number;
  readaheadSecs: number;
  maxBytes: number;
  maxBackBytes: number;
  pauseWaitSecs: number;
};

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** Automatic cache bounds: 1/16 of RAM, clamped to 256 MiB..1 GiB. */
export const AUTO_CACHE_MIN_BYTES = 256 * MIB;
export const AUTO_CACHE_MAX_BYTES = GIB;
/** Manual modes may use at most 1/8 of RAM, never more than 2 GiB. */
export const RAM_CACHE_HARD_MAX_BYTES = 2 * GIB;
/** Conservative ceiling used when physical memory cannot be read. */
export const RAM_CACHE_FALLBACK_BYTES = 2 * AUTO_CACHE_MIN_BYTES;

export const BUFFER_PROFILES: Record<Exclude<BufferSizeId, "auto">, BufferProfile> = {
  small: {
    cacheSecs: 60,
    readaheadSecs: 20,
    maxBytes: 150 * MIB,
    maxBackBytes: 32 * MIB,
    pauseWaitSecs: 0,
  },
  medium: {
    cacheSecs: 300,
    readaheadSecs: 120,
    maxBytes: 512 * MIB,
    maxBackBytes: 64 * MIB,
    pauseWaitSecs: 4,
  },
  large: {
    cacheSecs: 600,
    readaheadSecs: 600,
    maxBytes: GIB,
    maxBackBytes: 128 * MIB,
    pauseWaitSecs: 10,
  },
  max: {
    cacheSecs: 1800,
    readaheadSecs: 1800,
    maxBytes: 2 * GIB,
    maxBackBytes: 256 * MIB,
    pauseWaitSecs: 20,
  },
};

export function isBufferSizeId(value: unknown): value is BufferSizeId {
  return (
    value === "auto" ||
    value === "small" ||
    value === "medium" ||
    value === "large" ||
    value === "max"
  );
}

export function sanitizeBufferSize(value: unknown): BufferSizeId {
  return isBufferSizeId(value) ? value : "auto";
}

export function bufferProfileFor(id: BufferSizeId): BufferProfile | null {
  return id === "auto" ? null : BUFFER_PROFILES[id];
}

/** Automatic cache size: total physical RAM / 16, clamped to 256 MiB..1 GiB. */
export function autoCacheBytes(totalPhysBytes?: number): number {
  const total = totalPhysBytes ?? getTotalPhysBytes();
  if (total <= 0) return AUTO_CACHE_MIN_BYTES;
  return Math.min(AUTO_CACHE_MAX_BYTES, Math.max(AUTO_CACHE_MIN_BYTES, Math.floor(total / 16)));
}

/** The RAM-aware ceiling for manual buffer choices: total physical RAM / 8, max 2 GiB.
 * Unknown memory uses a conservative fallback ceiling. */
export function ramCacheCapBytes(totalPhysBytes?: number): number {
  const total = totalPhysBytes ?? getTotalPhysBytes();
  if (total <= 0) return RAM_CACHE_FALLBACK_BYTES;
  return Math.min(RAM_CACHE_HARD_MAX_BYTES, Math.max(AUTO_CACHE_MIN_BYTES, Math.floor(total / 8)));
}

export function bufferTotalBytes(profile: BufferProfile): number {
  return profile.maxBytes + profile.maxBackBytes;
}

/** Options that would request mpv's append-only disk cache; native playback rejects them. */
export function isBlockedDiskCacheOptionLine(line: string): boolean {
  return /^\s*(?:--)?(?:cache-on-disk|cache-dir|demuxer-cache-dir)\s*=/i.test(line);
}

/** The effective Automatic profile: 75% ahead, 25% behind. */
export function autoBufferProfile(totalPhysBytes?: number): BufferProfile {
  const total = autoCacheBytes(totalPhysBytes);
  const maxBytes = Math.floor((total * 3) / 4);
  return {
    cacheSecs: 300,
    readaheadSecs: 300,
    maxBytes,
    maxBackBytes: total - maxBytes,
    pauseWaitSecs: 1,
  };
}

/** The profile Harbor actually uses for a setting, after the RAM-aware cap. */
export function effectiveBufferProfile(
  id: BufferSizeId,
  totalPhysBytes?: number,
): BufferProfile | null {
  if (id === "auto") return autoBufferProfile(totalPhysBytes);
  const profile = BUFFER_PROFILES[id];
  if (!profile) return null;
  const cap = ramCacheCapBytes(totalPhysBytes);
  const total = bufferTotalBytes(profile);
  if (total <= cap) return profile;
  const maxBytes = Math.max(1, Math.floor((profile.maxBytes * cap) / total));
  return { ...profile, maxBytes, maxBackBytes: Math.max(0, cap - maxBytes) };
}

export function formatMpvBytes(bytes: number): string {
  return bytes % GIB === 0 ? `${bytes / GIB}GiB` : `${Math.round(bytes / MIB)}MiB`;
}

export function formatBufferMemory(bytes: number): string {
  if (bytes >= GIB) {
    const gb = bytes / GIB;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  return `${Math.round(bytes / MIB)} MB`;
}

export function bufferMpvLines(id: BufferSizeId, totalPhysBytes?: number): string[] {
  // Auto is applied as a phased default by the player, not as a custom override.
  if (id === "auto") return [];
  const profile = effectiveBufferProfile(id, totalPhysBytes);
  if (!profile) return [];
  return [
    "cache=yes",
    `cache-secs=${profile.cacheSecs}`,
    `demuxer-max-bytes=${formatMpvBytes(profile.maxBytes)}`,
    `demuxer-max-back-bytes=${formatMpvBytes(profile.maxBackBytes)}`,
    `demuxer-readahead-secs=${profile.readaheadSecs}`,
    `cache-pause-initial=${profile.pauseWaitSecs > 0 ? "yes" : "no"}`,
    `cache-pause-wait=${profile.pauseWaitSecs}`,
  ];
}

export type StoredBufferChoice = {
  mpvBufferSize?: BufferSizeId;
  mpvBufferBoost?: boolean;
};

export function bufferSizeFor(stored: StoredBufferChoice): BufferSizeId {
  if (isBufferSizeId(stored.mpvBufferSize)) return stored.mpvBufferSize;
  return stored.mpvBufferBoost ? "large" : "auto";
}
