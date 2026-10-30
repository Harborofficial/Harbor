import type { ExternalCwSource } from "@/lib/stremio";
import { privateCwProfileId } from "./cw-profile";
import { isNuvioProviderActive as isNuvioMode, getNuvioActiveSlot } from "./active-profile-id";

const KEY = "harbor.resume";
const PRIVATE_PREFIX = "harbor.resume.private.v1.";

let cachedNuvioAccountRaw: string | null = null;
let cachedNuvioAccountId = "anon";

function nuvioAccountId(): string {
  try {
    const raw =
      localStorage.getItem("harbor.nuvio.state.v1") ?? localStorage.getItem("harbor.nuvio.state");
    if (raw === cachedNuvioAccountRaw) return cachedNuvioAccountId;
    cachedNuvioAccountRaw = raw;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.session?.user?.id) {
        cachedNuvioAccountId = String(parsed.session.user.id);
        return cachedNuvioAccountId;
      }
    }
  } catch {}
  cachedNuvioAccountId = "anon";
  return "anon";
}

function effectiveOwner(ownerId?: string): string | undefined {
  if (ownerId && ownerId.startsWith("nuvio-")) return ownerId;
  if (isNuvioMode()) {
    return `nuvio-${getNuvioActiveSlot()}`;
  }
  return ownerId;
}

function resumeTargetKeys(rawOwner?: string): string[] {
  const eff = effectiveOwner(rawOwner);
  if (eff && eff.startsWith("nuvio-")) {
    const acc = nuvioAccountId();
    return [`${PRIVATE_PREFIX}${acc}.${eff}`];
  }
  if (eff) return [KEY, PRIVATE_PREFIX + eff];
  return [readKey()];
}

function readKey(ownerId?: string): string {
  const eff = effectiveOwner(ownerId);
  if (eff && eff.startsWith("nuvio-")) {
    const acc = nuvioAccountId();
    return `${PRIVATE_PREFIX}${acc}.${eff}`;
  }
  const profileId = privateCwProfileId();
  if (!profileId) return KEY;
  if (profileId.startsWith("nuvio-")) {
    const acc = nuvioAccountId();
    return `${PRIVATE_PREFIX}${acc}.${profileId}`;
  }
  return PRIVATE_PREFIX + profileId;
}

type Entry = { ms: number; t: number; s?: number; pct?: number; source?: ExternalCwSource };

function entryKey(id: string, season?: number, episode?: number): string {
  if (typeof season === "number" && typeof episode === "number") {
    return `${id}|s${season}e${episode}`;
  }
  return id;
}

const parsedResume = new Map<string, { raw: string | null; entries: Record<string, Entry> }>();

function readAll(key = readKey()): Record<string, Entry> {
  try {
    const raw = localStorage.getItem(key);
    const cached = parsedResume.get(key);
    if (cached && cached.raw === raw) return cached.entries;
    const entries = raw ? (JSON.parse(raw) as Record<string, Entry>) : {};
    parsedResume.set(key, { raw, entries });
    return entries;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Entry>, key: string, acknowledged = false): void {
  try {
    const raw = JSON.stringify(all);
    localStorage.setItem(key, raw);
    parsedResume.set(key, { raw, entries: all });
  } catch (error) {
    parsedResume.delete(key);
    if (acknowledged) throw error;
  }
}

export function saveResumeMs(
  id: string,
  ms: number,
  season?: number,
  episode?: number,
  displaySeason?: number,
  pct?: number,
  source?: ExternalCwSource,
  ownerId?: string,
  atTimestamp?: number,
): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  if (typeof season === "number" && typeof episode === "number") {
    if (season < 0 || episode < 1) return;
  }
  const s = typeof displaySeason === "number" && displaySeason >= 1 ? displaySeason : undefined;
  const p = pct !== undefined && Number.isFinite(pct) && pct >= 0 && pct <= 1 ? pct : undefined;
  const entry: Entry = {
    ms,
    t: atTimestamp && atTimestamp > 0 ? atTimestamp : Date.now(),
    ...(s !== undefined ? { s } : {}),
    ...(p !== undefined ? { pct: p } : {}),
    ...(source !== undefined ? { source } : {}),
  };
  // Imported/cloud progress never establishes a profile's playback ownership.
  const eff = effectiveOwner(ownerId);
  const targetKeys: string[] = [];
  if (eff && eff.startsWith("nuvio-")) {
    const acc = nuvioAccountId();
    targetKeys.push(`${PRIVATE_PREFIX}${acc}.${eff}`);
  } else if (eff) {
    targetKeys.push(KEY, PRIVATE_PREFIX + eff);
  } else {
    targetKeys.push(KEY);
  }
  for (const key of targetKeys) {
    const all = readAll(key);
    all[entryKey(id, season, episode)] = entry;
    writeAll(all, key);
  }
}

export function saveResumeBatch(
  entries: {
    id: string;
    ms: number;
    season?: number;
    episode?: number;
    t?: number;
    pct?: number;
    source?: ExternalCwSource;
  }[],
  ownerId?: string,
): void {
  if (entries.length === 0) return;
  const eff = effectiveOwner(ownerId);
  const key = eff && eff.startsWith("nuvio-") ? `${PRIVATE_PREFIX}${nuvioAccountId()}.${eff}` : KEY;
  const all = readAll(key);
  const now = Date.now();
  for (const e of entries) {
    if (!Number.isFinite(e.ms) || e.ms < 0) continue;
    if (typeof e.season === "number" && typeof e.episode === "number") {
      if (e.season < 0 || e.episode < 1) continue;
    }
    const p =
      e.pct !== undefined && Number.isFinite(e.pct) && e.pct >= 0 && e.pct <= 1 ? e.pct : undefined;
    all[entryKey(e.id, e.season, e.episode)] = {
      ms: e.ms,
      t: e.t ?? now,
      ...(p !== undefined ? { pct: p } : {}),
      ...(e.source !== undefined ? { source: e.source } : {}),
    };
  }
  writeAll(all, key);
}

export function readResumeMs(
  id: string,
  season?: number,
  episode?: number,
  ownerId?: string,
): number {
  const all = readAll(readKey(ownerId));
  return all[entryKey(id, season, episode)]?.ms ?? 0;
}

export function readResumeEntry(
  id: string,
  season?: number,
  episode?: number,
  ownerId?: string,
): { ms: number; t: number; s?: number; pct?: number; source?: ExternalCwSource } | null {
  const all = readAll(readKey(ownerId));
  const e = all[entryKey(id, season, episode)];
  return e
    ? {
        ms: e.ms,
        t: e.t,
        ...(e.s !== undefined ? { s: e.s } : {}),
        ...(e.pct !== undefined ? { pct: e.pct } : {}),
        ...(e.source !== undefined ? { source: e.source } : {}),
      }
    : null;
}

/** One synchronous episode scan reads its profile and storage snapshot once. */
export function createResumeReader(ownerId?: string) {
  const entries = { ...readAll(readKey(ownerId)) };
  return (id: string, season?: number, episode?: number): ReturnType<typeof readResumeEntry> => {
    const entry = entries[entryKey(id, season, episode)];
    return entry ? { ...entry } : null;
  };
}

export function readResumeSource(
  id: string,
  season?: number,
  episode?: number,
  ownerId?: string,
): ExternalCwSource | undefined {
  return readAll(readKey(ownerId))[entryKey(id, season, episode)]?.source;
}

export function clearAllNuvioResume(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("harbor.resume.private.v1.nuvio-") || key.includes(".nuvio-"))) {
        toRemove.push(key);
      }
    }
    for (const k of toRemove) {
      localStorage.removeItem(k);
      parsedResume.delete(k);
    }
  } catch {}
}

export function clearAllResumeForProfile(profileId?: string): void {
  try {
    if (profileId) {
      const k = `${PRIVATE_PREFIX}${profileId}`;
      localStorage.removeItem(k);
      parsedResume.delete(k);
    }
    localStorage.removeItem(KEY);
    parsedResume.delete(KEY);
  } catch {}
}

export function clearResume(
  id: string,
  season?: number,
  episode?: number,
  ownerOrOptions?: string | { acknowledged?: boolean; ownerId?: string },
): void {
  const rawOwner = typeof ownerOrOptions === "string" ? ownerOrOptions : ownerOrOptions?.ownerId;
  const acknowledged = typeof ownerOrOptions === "object" && ownerOrOptions?.acknowledged === true;
  for (const key of resumeTargetKeys(rawOwner)) {
    const all = readAll(key);
    if (typeof season === "number" && typeof episode === "number") {
      delete all[entryKey(id, season, episode)];
    } else {
      delete all[id];
      const prefix = `${id}|`;
      for (const k of Object.keys(all)) {
        if (k.startsWith(prefix)) delete all[k];
      }
    }
    writeAll(all, key, acknowledged);
  }
}

/** Clear many cloud-resume rows with one write per storage key. */
export function clearResumeBatch(
  entries: Array<{ id: string; season?: number | null; episode?: number | null }>,
  ownerId?: string,
): void {
  if (entries.length === 0) return;
  for (const key of resumeTargetKeys(ownerId)) {
    const all = readAll(key);
    let touched = false;
    for (const { id, season, episode } of entries) {
      if (!id) continue;
      if (typeof season === "number" && typeof episode === "number") {
        const coordinate = entryKey(id, season, episode);
        if (!(coordinate in all)) continue;
        delete all[coordinate];
        touched = true;
        continue;
      }
      if (id in all) {
        delete all[id];
        touched = true;
      }
      const prefix = `${id}|`;
      for (const k of Object.keys(all)) {
        if (!k.startsWith(prefix)) continue;
        delete all[k];
        touched = true;
      }
    }
    if (touched) writeAll(all, key);
  }
}

export function lastPlayedEpisode(seriesId: string): {
  season: number;
  episode: number;
  ms: number;
  t: number;
  displaySeason?: number;
  pct?: number;
  source?: ExternalCwSource;
} | null {
  const all = readAll();
  const prefix = `${seriesId}|s`;
  let best: {
    season: number;
    episode: number;
    ms: number;
    t: number;
    displaySeason?: number;
    pct?: number;
    source?: ExternalCwSource;
  } | null = null;
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(prefix)) continue;
    const m = key.match(/\|s(\d+)e(\d+)$/);
    if (!m) continue;
    const season = parseInt(m[1], 10);
    const episode = parseInt(m[2], 10);
    if (season < 1 || episode < 1) continue;
    if (!best || value.t > best.t) {
      best = {
        season,
        episode,
        ms: value.ms,
        t: value.t,
        displaySeason: value.s,
        pct: value.pct,
        source: value.source,
      };
    }
  }
  return best;
}
