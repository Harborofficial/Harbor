import { cwProfileScope, privateCwProfileId } from "./cw-profile";
import { isNuvioProviderActive, getNuvioActiveSlot } from "./active-profile-id";
import { collectAllNuvioItemIds } from "./nuvio/nuvio-client";

const KEY_PREFIX = "harbor.localcw.v1.";
const PRIVATE_PREFIX = "harbor.localcw.private.v1.";
const LEGACY_KEY = "harbor.localcw.v1";
const PROFILES_KEY = "harbor.profiles.v1";
const MAX = 60;
const FINISHED_RATIO = 0.92;

export type LocalCwEntry = {
  id: string;
  type: "movie" | "series";
  name: string;
  poster?: string;
  background?: string;
  isAnime?: boolean;
  source?: "library" | "local";
  external?: "nuvio" | "stremio" | string;
  season?: number;
  episode?: number;
  videoId?: string;
  positionMs: number;
  durationMs: number;
  t: number;
};

const subs = new Set<() => void>();
let version = 0;
const cache = new Map<string, Record<string, LocalCwEntry>>();

function nuvioAccountId(): string {
  try {
    const raw =
      localStorage.getItem("harbor.nuvio.state.v1") ?? localStorage.getItem("harbor.nuvio.state");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.session?.user?.id) return String(parsed.session.user.id);
    }
  } catch {}
  return "anon";
}

function isNuvioMode(): boolean {
  return isNuvioProviderActive();
}

function effectiveOwner(ownerId?: string): string | undefined {
  if (ownerId && ownerId.startsWith("nuvio-")) return ownerId;
  if (isNuvioProviderActive()) {
    return `nuvio-${getNuvioActiveSlot()}`;
  }
  return ownerId;
}

function primaryProfileId(): string {
  try {
    if (isNuvioMode()) {
      return cwProfileScope().sharedId;
    }
    const raw = localStorage.getItem(PROFILES_KEY);
    const s = raw
      ? (JSON.parse(raw) as { profiles?: Array<{ id?: string; isPrimary?: boolean }> })
      : null;
    const primary = s?.profiles?.find((p) => p?.isPrimary);
    return (primary && typeof primary.id === "string" && primary.id) || cwProfileScope().sharedId;
  } catch {
    return cwProfileScope().sharedId;
  }
}

function storeKey(privateOnly = false, ownerId?: string): string {
  const eff = effectiveOwner(ownerId);
  if (isNuvioProviderActive() || (eff && eff.startsWith("nuvio-"))) {
    const acc = nuvioAccountId();
    const pid = eff || `nuvio-${getNuvioActiveSlot()}`;
    return `${KEY_PREFIX}${acc}.${pid}`;
  }
  const scope = cwProfileScope(ownerId);
  if (scope.profileId.startsWith("nuvio-")) {
    const acc = nuvioAccountId();
    return `${KEY_PREFIX}${acc}.${scope.profileId}`;
  }
  if (privateOnly) return PRIVATE_PREFIX + scope.profileId;
  const id = scope.sharedId;
  return id ? KEY_PREFIX + id : LEGACY_KEY;
}

function migrateLegacy(): void {
  if (isNuvioMode()) return;
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    const pid = primaryProfileId();
    if (!pid) return;
    const perKey = KEY_PREFIX + pid;
    if (!localStorage.getItem(perKey)) localStorage.setItem(perKey, legacy);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* noop */
  }
}

function readAll(key: string): Record<string, LocalCwEntry> {
  const cached = cache.get(key);
  if (cached) return cached;
  migrateLegacy();
  let next: Record<string, LocalCwEntry>;
  try {
    const raw = localStorage.getItem(key);
    next = raw ? (JSON.parse(raw) as Record<string, LocalCwEntry>) : {};
  } catch {
    next = {};
  }
  cache.set(key, next);
  return next;
}

function writeAll(key: string, all: Record<string, LocalCwEntry>, acknowledged = false): void {
  try {
    localStorage.setItem(key, JSON.stringify(all));
  } catch (error) {
    // The in-memory cache must never claim a write the store refused: drop it so
    // the next read falls back to what is actually persisted.
    cache.delete(key);
    if (acknowledged)
      throw new Error("Could not save the change. Check available storage and try again.", {
        cause: error,
      });
    return;
  }
  cache.set(key, all);
}

function emit(): void {
  version += 1;
  for (const fn of subs) fn();
}

function applyEntry(all: Record<string, LocalCwEntry>, entry: LocalCwEntry): boolean {
  const finished = entry.durationMs > 0 && entry.positionMs / entry.durationMs >= FINISHED_RATIO;
  if (finished && entry.type === "movie") {
    if (!(entry.id in all)) return false;
    delete all[entry.id];
    return true;
  }
  all[entry.id] = entry;
  return true;
}

function capEntries(all: Record<string, LocalCwEntry>): void {
  const ids = Object.keys(all);
  if (ids.length <= MAX) return;
  ids.sort((a, b) => all[a].t - all[b].t);
  for (const id of ids.slice(0, ids.length - MAX)) delete all[id];
}

function saveEntry(key: string, entry: LocalCwEntry): void {
  const all = { ...readAll(key) };
  if (!applyEntry(all, entry)) return;
  capEntries(all);
  writeAll(key, all);
}

// Only an actual playback session may assign ownership. Cloud absorption keeps
// writing the shared store; its history cannot establish who watched a title.
export function saveLocalCw(entry: LocalCwEntry, ownerId?: string, shared = true): void {
  if (!entry.id || (entry.type !== "movie" && entry.type !== "series")) return;
  const isNuvio =
    isNuvioProviderActive() ||
    (ownerId != null && ownerId.startsWith("nuvio-")) ||
    (entry as any).external === "nuvio";
  if (isNuvio) {
    const eff = effectiveOwner(ownerId) || `nuvio-${getNuvioActiveSlot()}`;
    const nuvioEntry = { ...entry, external: "nuvio" as const };
    saveEntry(storeKey(false, eff), nuvioEntry);
    emit();
    return;
  }
  // Stremio mode: strictly reject any Nuvio items
  if ((entry as any).external === "nuvio") return;
  if (ownerId) saveEntry(storeKey(true, ownerId), entry);
  if (shared) saveEntry(storeKey(false, ownerId), entry);
  emit();
}

/** One storage write and one notification for a cloud commit or progress pull. */
export function saveLocalCwBatch(entries: LocalCwEntry[], ownerId?: string, shared = true): void {
  const valid = entries.filter(
    (entry) => entry.id && (entry.type === "movie" || entry.type === "series"),
  );
  if (valid.length === 0) return;
  const targetKeys: string[] = [];
  if (isNuvioMode()) {
    targetKeys.push(storeKey(false, ownerId));
  } else {
    if (ownerId) targetKeys.push(storeKey(true, ownerId));
    if (shared) targetKeys.push(storeKey(false, ownerId));
  }
  let changed = false;
  for (const key of new Set(targetKeys)) {
    const all = { ...readAll(key) };
    let touched = false;
    for (const entry of valid) touched = applyEntry(all, entry) || touched;
    if (!touched) continue;
    capEntries(all);
    writeAll(key, all);
    changed = true;
  }
  if (changed) emit();
}

export function listLocalCw(
  privateOnly = !!privateCwProfileId(),
  ownerId?: string,
): LocalCwEntry[] {
  const isNuvio = isNuvioMode() || (ownerId != null && ownerId.startsWith("nuvio-"));
  const entries = Object.values(readAll(storeKey(privateOnly, ownerId)));
  if (!isNuvio) {
    return entries
      .filter((e) => !(e.id && (e as any).external === "nuvio"))
      .sort((a, b) => b.t - a.t);
  }
  return entries.sort((a, b) => b.t - a.t);
}

export function localCwEntry(
  id: string,
  privateOnly = !!privateCwProfileId(),
  ownerId?: string,
): LocalCwEntry | null {
  return readAll(storeKey(privateOnly, ownerId))[id] ?? null;
}

export function clearLocalCw(
  id: string,
  ownerOrOptions?: string | { acknowledged?: boolean },
  options: { acknowledged?: boolean } = {},
): void {
  const ownerId = typeof ownerOrOptions === "string" ? ownerOrOptions : undefined;
  const acknowledged =
    typeof ownerOrOptions === "object" ? ownerOrOptions.acknowledged : options.acknowledged;
  const isNuvio = isNuvioProviderActive() || (ownerId != null && ownerId.startsWith("nuvio-"));
  const targetKeys = new Set<string>();
  if (isNuvio) {
    const eff = effectiveOwner(ownerId) || `nuvio-${getNuvioActiveSlot()}`;
    targetKeys.add(storeKey(false, eff));
    targetKeys.add(storeKey(true, eff));
  } else {
    if (ownerId) {
      targetKeys.add(storeKey(true, ownerId));
      targetKeys.add(storeKey(false, ownerId));
    } else {
      targetKeys.add(storeKey(!!privateCwProfileId()));
    }
    targetKeys.add(LEGACY_KEY);
  }
  const cleanId = id.replace(/^(series|movie|tmdb):/, "").trim();
  const idVariants = new Set([id, cleanId, `tmdb:${cleanId}`, `series:${cleanId}`]);
  let changed = false;
  for (const key of targetKeys) {
    const all = readAll(key);
    let keyChanged = false;
    const next = { ...all };
    for (const vid of idVariants) {
      if (vid in next) {
        delete next[vid];
        keyChanged = true;
      }
    }
    if (keyChanged) {
      writeAll(key, next, acknowledged);
      changed = true;
    }
  }
  if (changed) emit();
}

/** Clear many continue-watching rows with one write per store and one notification. */
export function clearLocalCwBatch(ids: string[], ownerId?: string): void {
  const valid = new Set(ids.filter((id) => !!id));
  if (valid.size === 0) return;
  const targetKeys = new Set<string>();
  if (ownerId) {
    targetKeys.add(storeKey(true, ownerId));
    targetKeys.add(storeKey(false, ownerId));
  } else {
    targetKeys.add(storeKey(!!privateCwProfileId()));
  }
  targetKeys.add(LEGACY_KEY);
  let changed = false;
  for (const key of targetKeys) {
    const all = readAll(key);
    const next = { ...all };
    let touched = false;
    for (const id of valid) {
      if (!(id in next)) continue;
      delete next[id];
      touched = true;
    }
    if (!touched) continue;
    writeAll(key, next);
    changed = true;
  }
  if (changed) emit();
}

export function sanitizeStremioLocalCw(extraPurgeIds?: string[]): void {
  try {
    const purgeSet = new Set(extraPurgeIds ?? []);
    try {
      for (const id of collectAllNuvioItemIds()) {
        purgeSet.add(id);
      }
    } catch {}
    let changed = false;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        key.startsWith(KEY_PREFIX) &&
        !key.includes(".nuvio-") &&
        !key.startsWith("harbor.localcw.v1.nuvio-")
      ) {
        const all = readAll(key);
        let keyChanged = false;
        const next: Record<string, LocalCwEntry> = {};
        for (const [id, entry] of Object.entries(all)) {
          if ((entry as any).external === "nuvio" || purgeSet.has(id)) {
            keyChanged = true;
            continue;
          }
          next[id] = entry;
        }
        if (keyChanged) {
          writeAll(key, next);
          changed = true;
        }
      }
    }
    if (changed) emit();
  } catch {}
}

export function clearAllNuvioLocalCw(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith("harbor.localcw.v1.nuvio-") ||
          key.includes(".nuvio-") ||
          key.startsWith("harbor.localcw.private.v1.nuvio-"))
      ) {
        toRemove.push(key);
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
    cache.clear();
    emit();
  } catch {}
}

export function clearAllLocalCw(ownerId?: string): void {
  const keys = ownerId
    ? [storeKey(true, ownerId), storeKey(false, ownerId)]
    : [storeKey(!!privateCwProfileId())];
  let changed = false;
  for (const key of keys) {
    const all = readAll(key);
    if (Object.keys(all).length > 0) {
      writeAll(key, {});
      changed = true;
    }
  }
  if (changed) emit();
}

export function subscribeLocalCw(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function localCwVersion(): number {
  return version;
}

if (typeof window !== "undefined") {
  const identity = () => {
    const s = cwProfileScope();
    const acc = isNuvioMode() || s.profileId.startsWith("nuvio-") ? nuvioAccountId() : "";
    return `${acc}|${s.profileId}|${s.sharedId}`;
  };
  let lastProfile = identity();
  const onProfileChange = () => {
    const p = identity();
    if (p === lastProfile) return;
    lastProfile = p;
    cache.clear();
    emit();
  };
  window.addEventListener("harbor:active-profile-changed", onProfileChange);
  window.addEventListener("harbor:profiles-updated", onProfileChange);
  window.addEventListener("harbor:nuvio-profile-changed", onProfileChange);
  window.addEventListener("harbor:nuvio-state-changed", onProfileChange);
  window.addEventListener("harbor:account-provider-changed", () => {
    onProfileChange();
    if (!isNuvioProviderActive()) sanitizeStremioLocalCw();
  });
  if (!isNuvioProviderActive()) {
    sanitizeStremioLocalCw();
  }
}
