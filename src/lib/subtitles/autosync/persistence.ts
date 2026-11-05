import type { SubCue } from "../parser";
import type { SyncTransform } from "./fp-gate";

// Only timing transformations and compact fingerprints are stored. Never store
// subtitles, signed media URLs, headers, or generated temporary file paths.
const STORAGE_KEY = "harbor.subtitle.autosync.v1";
const MAX_ENTRIES = 200;
const EMBEDDED_TIMING_VERSION = 2;
export type AutoSyncCorrectionScope = "episode" | "scene";
export type SavedAutoSyncCorrection = {
  id: string;
  mediaHash: string;
  audioHash: string;
  subtitleHash: string;
  transform: SyncTransform;
  scope: AutoSyncCorrectionScope;
  focusSec: number | null;
  verified: boolean;
  embeddedReference?: boolean;
  embeddedTimingVersion?: number;
  updatedAt: number;
};
type Store = SavedAutoSyncCorrection[];

function hash(value: string): string {
  // Two independently seeded FNV-1a hashes lower accidental collisions
  // without leaving raw media or subtitle text in localStorage.
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < value.length; i += 1) {
    const char = value.charCodeAt(i);
    a = Math.imul(a ^ char, 0x01000193);
    b = Math.imul(b ^ char, 0x01000193);
  }
  return `${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}

export function subtitleCueFingerprint(cues: SubCue[]): string {
  // Include every cue's original timestamps and text so a different subtitle
  // release (even for the same episode and language) cannot inherit a shift.
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  const append = (v: string) => {
    for (let i = 0; i < v.length; i += 1) {
      const n = v.charCodeAt(i);
      a = Math.imul(a ^ n, 0x01000193);
      b = Math.imul(b ^ n, 0x01000193);
    }
    a = Math.imul(a ^ 255, 0x01000193);
    b = Math.imul(b ^ 255, 0x01000193);
  };
  for (const cue of cues) {
    append(Math.round(cue.start * 1000).toString());
    append(Math.round(cue.end * 1000).toString());
    append(cue.text);
  }
  return `${cues.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}

function validTransform(t: unknown): t is SyncTransform {
  if (!t || typeof t !== "object") return false;
  const v = t as Partial<SyncTransform>;
  const validNumber = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  if (v.kind === "affine") {
    return (
      validNumber(v.offsetSec) &&
      Math.abs(v.offsetSec!) <= 600 &&
      validNumber(v.ratio) &&
      v.ratio! >= 0.5 &&
      v.ratio! <= 1.5
    );
  }
  if (
    v.kind === "piecewise" &&
    Array.isArray(v.segments) &&
    v.segments.length > 0 &&
    v.segments.length <= 100
  ) {
    return v.segments.every(
      (s) =>
        validNumber(s.fromSec) &&
        (validNumber(s.toSec) || s.toSec === Infinity) &&
        s.toSec > s.fromSec &&
        validNumber(s.offsetSec) &&
        Math.abs(s.offsetSec) <= 600 &&
        validNumber(s.ratio) &&
        s.ratio >= 0.5 &&
        s.ratio <= 1.5,
    );
  }
  return false;
}

function readStore(): Store {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]",
      (key, value: unknown) => (key === "toSec" && value === "+Infinity" ? Infinity : value),
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is SavedAutoSyncCorrection => {
      if (!v || typeof v !== "object") return false;
      const e = v as Partial<SavedAutoSyncCorrection>;
      return (
        typeof e.id === "string" &&
        typeof e.mediaHash === "string" &&
        typeof e.audioHash === "string" &&
        typeof e.subtitleHash === "string" &&
        validTransform(e.transform) &&
        (e.scope === "episode" || e.scope === "scene") &&
        (e.scope === "episode" ||
          (typeof e.focusSec === "number" && Number.isFinite(e.focusSec) && e.focusSec >= 0)) &&
        typeof e.verified === "boolean" &&
        typeof e.updatedAt === "number" &&
        // Older embedded estimates used FFmpeg's independently rebased excerpts.
        (e.embeddedReference !== true || e.embeddedTimingVersion === EMBEDDED_TIMING_VERSION)
      );
    });
  } catch {
    return [];
  }
}

function writeStore(entries: Store): boolean {
  try {
    const sorted = entries.sort((a, b) => b.updatedAt - a.updatedAt);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(sorted.slice(0, MAX_ENTRIES), (key, value: unknown) =>
        key === "toSec" && value === Infinity ? "+Infinity" : value,
      ),
    );
    return true;
  } catch {
    // Storage may be disabled or full. Playback must still succeed.
    return false;
  }
}

export function hasSavedAutoSyncCorrection(mediaKey: string, audioKey: string): boolean {
  const m = hash(mediaKey);
  const a = hash(audioKey);
  return readStore().some((v) => v.mediaHash === m && v.audioHash === a);
}

export function readSavedAutoSyncCorrection(
  mediaKey: string,
  audioKey: string,
  cues: SubCue[],
): SavedAutoSyncCorrection | null {
  if (cues.length < 4) return null;
  const m = hash(mediaKey);
  const a = hash(audioKey);
  const s = subtitleCueFingerprint(cues);
  return (
    readStore().find((v) => v.mediaHash === m && v.audioHash === a && v.subtitleHash === s) ?? null
  );
}

export function shouldRestoreAutoSyncCorrection(
  correction: SavedAutoSyncCorrection,
  positionSec: number,
): boolean {
  return (
    correction.scope === "episode" ||
    (Number.isFinite(positionSec) &&
      correction.focusSec !== null &&
      Math.abs(positionSec - correction.focusSec) <= 90)
  );
}

export function saveAutoSyncCorrection(input: {
  mediaKey: string;
  audioKey: string;
  cues: SubCue[];
  transform: SyncTransform;
  scope: AutoSyncCorrectionScope;
  focusSec?: number | null;
  verified: boolean;
  embeddedReference?: boolean;
}): string | null {
  if (input.cues.length < 4 || !validTransform(input.transform)) return null;
  const focusSec = input.scope === "scene" ? (input.focusSec ?? null) : null;
  if (
    input.scope === "scene" &&
    (focusSec === null || !Number.isFinite(focusSec) || focusSec < 0)
  ) {
    return null;
  }
  const mediaHash = hash(input.mediaKey);
  const audioHash = hash(input.audioKey);
  const subtitleHash = subtitleCueFingerprint(input.cues);
  const id = `${mediaHash}:${audioHash}:${subtitleHash}`;
  const existing = readStore().filter((v) => v.id !== id);
  return writeStore([
    ...existing,
    {
      id,
      mediaHash,
      audioHash,
      subtitleHash,
      transform: input.transform,
      scope: input.scope,
      focusSec,
      verified: input.verified,
      embeddedReference: input.embeddedReference,
      embeddedTimingVersion: input.embeddedReference ? EMBEDDED_TIMING_VERSION : undefined,
      updatedAt: Date.now(),
    },
  ])
    ? id
    : null;
}

export function clearSavedAutoSyncCorrection(id: string | null): void {
  if (!id) return;
  const entries = readStore();
  if (!entries.some((entry) => entry.id === id)) return;
  writeStore(entries.filter((entry) => entry.id !== id));
}
