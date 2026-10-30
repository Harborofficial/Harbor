import {
  isNuvioProviderActive,
  getNuvioActiveSlot,
  nuvioWatchedScope,
  canPersistWatched,
  stremioProfileId as activeProfileId,
  primaryProfileId,
} from "./active-profile-id";
import type { LibraryItem } from "@/lib/stremio";
import { noteNotify } from "@/lib/render-cause";
import { persistCritical } from "@/lib/storage-recovery";

const PREFIXES = {
  watched: "harbor.manualwatched.v1.",
  unwatched: "harbor.manualunwatched.v1.",
  meta: "harbor.manualwatched.meta.v1.",
  dismissed: "harbor.manualwatched.dismissed.v1.",
  unwatchedAt: "harbor.manualunwatched.at.v1.",
  remote: "harbor.manualwatched.fromremote.v1.",
} as const;

const LEGACY_KEYS: Record<keyof typeof PREFIXES, string> = {
  watched: "harbor.manualwatched.v1",
  unwatched: "harbor.manualunwatched.v1",
  meta: "harbor.manualwatched.meta.v1",
  dismissed: "harbor.manualwatched.dismissed.v1",
  unwatchedAt: "harbor.manualunwatched.at.v1",
  remote: "harbor.manualwatched.fromremote.v1",
};

export type ManualWatchedMeta = {
  type: "series";
  name: string;
  poster?: string;
  background?: string;
  markedAt?: string;
};

const subs = new Set<() => void>();
let version = 0;
let watchedCache: Set<string> | null = null;
let unwatchedCache: Set<string> | null = null;
let metaCache: Record<string, ManualWatchedMeta> | null = null;
let dismissedCache: Set<string> | null = null;
let unwatchedAtCache: Record<string, number> | null = null;
let remoteCache: Set<string> | null = null;

function storeKey(kind: keyof typeof PREFIXES): string {
  if (isNuvioProviderActive()) {
    const scope = nuvioWatchedScope();
    const scopedKey = `${PREFIXES[kind]}${scope}`;
    if (!localStorage.getItem(scopedKey)) {
      const legacyKey = `${PREFIXES[kind]}nuvio.${getNuvioActiveSlot()}`;
      if (localStorage.getItem(legacyKey)) return legacyKey;
    }
    return scopedKey;
  }
  const id = activeProfileId();
  return id ? PREFIXES[kind] + id : LEGACY_KEYS[kind];
}

function migrateLegacy(): void {
  if (isNuvioProviderActive()) return;
  try {
    const pid = primaryProfileId();
    if (!pid) return;
    for (const kind of Object.keys(PREFIXES) as Array<keyof typeof PREFIXES>) {
      const legacy = localStorage.getItem(LEGACY_KEYS[kind]);
      if (!legacy) continue;
      const perKey = PREFIXES[kind] + pid;
      if (!localStorage.getItem(perKey)) localStorage.setItem(perKey, legacy);
      localStorage.removeItem(LEGACY_KEYS[kind]);
    }
  } catch {
    /* noop */
  }
}

let currentScope = "";

function ensureScope(): void {
  const sk = storeKey("watched");
  if (currentScope === sk) return;
  currentScope = sk;
  watchedCache = null;
  unwatchedCache = null;
  metaCache = null;
  dismissedCache = null;
  unwatchedAtCache = null;
  remoteCache = null;
}

function unwatchedAtMap(): Record<string, number> {
  ensureScope();
  if (!unwatchedAtCache) {
    migrateLegacy();
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey("unwatchedAt")) ?? "{}");
      unwatchedAtCache = raw && typeof raw === "object" ? (raw as Record<string, number>) : {};
    } catch {
      unwatchedAtCache = {};
    }
  }
  return unwatchedAtCache;
}

function remoteSet(): Set<string> {
  ensureScope();
  if (!remoteCache) {
    migrateLegacy();
    remoteCache = loadSet(storeKey("remote"));
  }
  return remoteCache;
}

function persistUnwatchedAt(): void {
  ensureScope();
  persistCritical(storeKey("unwatchedAt"), JSON.stringify(unwatchedAtCache ?? {}));
}

function persistRemote(): void {
  ensureScope();
  persistCritical(storeKey("remote"), JSON.stringify([...(remoteCache ?? [])]));
}

function loadMeta(): Record<string, ManualWatchedMeta> {
  ensureScope();
  if (metaCache) return metaCache;
  migrateLegacy();
  try {
    const raw = localStorage.getItem(storeKey("meta"));
    const parsed = raw ? JSON.parse(raw) : {};
    metaCache =
      parsed && typeof parsed === "object" ? (parsed as Record<string, ManualWatchedMeta>) : {};
  } catch {
    metaCache = {};
  }
  return metaCache;
}

function dismissedSet(): Set<string> {
  ensureScope();
  if (!dismissedCache) {
    migrateLegacy();
    dismissedCache = loadSet(storeKey("dismissed"));
  }
  return dismissedCache;
}

function undismiss(metaId: string): void {
  ensureScope();
  const set = dismissedSet();
  if (!set.has(metaId)) return;
  const next = new Set(set);
  next.delete(metaId);
  dismissedCache = next;
  try {
    localStorage.setItem(storeKey("dismissed"), JSON.stringify([...next]));
  } catch {
    return;
  }
  version += 1;
  notifySubs();
}

export function isManualWatchedDismissed(metaId: string): boolean {
  return dismissedSet().has(metaId);
}

export function dismissManualWatched(
  metaId: string,
  options: { acknowledged?: boolean } = {},
): void {
  if (!canPersistWatched()) return;
  ensureScope();
  const set = dismissedSet();
  if (set.has(metaId)) return;
  const next = new Set(set);
  next.add(metaId);
  try {
    localStorage.setItem(storeKey("dismissed"), JSON.stringify([...next]));
  } catch (error) {
    if (options.acknowledged)
      throw new Error("Could not save the change. Check available storage and try again.", {
        cause: error,
      });
    return;
  }
  dismissedCache = next;
  version += 1;
  notifySubs();
}

function loadSet(storageKey: string): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function watchedSet(): Set<string> {
  ensureScope();
  if (!watchedCache) {
    migrateLegacy();
    watchedCache = loadSet(storeKey("watched"));
  }
  return watchedCache;
}

function unwatchedSet(): Set<string> {
  ensureScope();
  if (!unwatchedCache) {
    migrateLegacy();
    unwatchedCache = loadSet(storeKey("unwatched"));
  }
  return unwatchedCache;
}

function persist(on: Set<string>, off: Set<string>): void {
  ensureScope();
  watchedCache = on;
  unwatchedCache = off;
  persistCritical(storeKey("watched"), JSON.stringify([...on]));
  persistCritical(storeKey("unwatched"), JSON.stringify([...off]));
  version += 1;
  notifySubs();
}

function key(metaId: string, season: number, episode: number): string {
  return `${metaId}|${season}|${episode}`;
}

export function isManuallyWatched(metaId: string, season: number, episode: number): boolean {
  return watchedSet().has(key(metaId, season, episode));
}

export function manualWatchedState(
  metaId: string,
  season: number,
  episode: number,
  altIds?: Array<string | null | undefined>,
): boolean | undefined {
  return stateInSets(watchedSet(), unwatchedSet(), metaId, season, episode, altIds);
}

/** Capture only for a synchronous scan; create a new reader after state changes. */
export function createManualWatchedReader(): typeof manualWatchedState {
  const watched = new Set(watchedSet());
  const unwatched = new Set(unwatchedSet());
  return (metaId, season, episode, altIds) =>
    stateInSets(watched, unwatched, metaId, season, episode, altIds);
}

function stateInSets(
  watched: Set<string>,
  unwatched: Set<string>,
  metaId: string,
  season: number,
  episode: number,
  altIds?: Array<string | null | undefined>,
): boolean | undefined {
  const cleanId = metaId.replace(/^(series|movie|tmdb):/, "");
  const allCandidateIds = new Set<string>([
    metaId,
    cleanId,
    `tmdb:${cleanId}`,
    `series:${cleanId}`,
  ]);
  if (altIds && altIds.length > 0) {
    for (const alt of altIds) {
      if (!alt) continue;
      const cleanAlt = alt.replace(/^(series|movie|tmdb):/, "");
      allCandidateIds.add(alt);
      allCandidateIds.add(cleanAlt);
      allCandidateIds.add(`tmdb:${cleanAlt}`);
      allCandidateIds.add(`series:${cleanAlt}`);
    }
  }

  for (const id of allCandidateIds) {
    const k = key(id, season, episode);
    if (watched.has(k)) return true;
    if (unwatched.has(k)) return false;
  }
  return undefined;
}

export function manualEpisodeKeys(
  metaId: string,
  altIds?: Array<string | null | undefined>,
): {
  watched: Set<string>;
  unwatched: Set<string>;
} {
  const ids = [metaId, ...(altIds ?? [])].filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0,
  );
  const allIds = new Set<string>(ids);
  for (const id of ids) {
    const clean = id.replace(/^(series|movie|tmdb):/, "");
    allIds.add(clean);
    allIds.add(`tmdb:${clean}`);
    allIds.add(`series:${clean}`);
  }
  const prefixes = Array.from(allIds).map((id) => `${id}|`);
  const collect = (src: Set<string>): Set<string> => {
    const out = new Set<string>();
    for (const k of src) {
      if (!prefixes.some((p) => k.startsWith(p))) continue;
      const parts = k.split("|");
      if (parts.length === 3) out.add(`${parts[1]}:${parts[2]}`);
    }
    return out;
  };
  return { watched: collect(watchedSet()), unwatched: collect(unwatchedSet()) };
}

export function reconcileNuvioWatchedEpisodes(
  slot: number,
  serverEpisodeKeys: Set<string>,
  targetSeriesIdsOrAccountId?: Set<string> | string,
  maybeAccountId?: string,
): { changed: boolean; newlyWatchedShows: Set<string> } {
  const targetSeriesIds =
    targetSeriesIdsOrAccountId instanceof Set ? targetSeriesIdsOrAccountId : undefined;
  const accountId =
    typeof targetSeriesIdsOrAccountId === "string" ? targetSeriesIdsOrAccountId : maybeAccountId;

  let scope = nuvioWatchedScope(slot, accountId);
  let sk = `${PREFIXES.watched}${scope}`;
  let unsk = `${PREFIXES.unwatched}${scope}`;
  if (
    !localStorage.getItem(sk) &&
    localStorage.getItem(`${PREFIXES.watched}nuvio.${slot}`)
  ) {
    sk = `${PREFIXES.watched}nuvio.${slot}`;
    unsk = `${PREFIXES.unwatched}nuvio.${slot}`;
  }

  const currentLocalWatched = loadSet(sk);
  const currentLocalUnwatched = loadSet(unsk);

  let changed = false;
  const newlyWatchedShows = new Set<string>();

  for (const sKey of Array.from(serverEpisodeKeys)) {
    const parts = sKey.split("|");
    if (parts.length === 3) {
      const showId = parts[0];
      const s = parts[1];
      const e = parts[2];
      const clean = showId.replace(/^(series|movie|tmdb):/, "");
      serverEpisodeKeys.add(`${clean}|${s}|${e}`);
      serverEpisodeKeys.add(`tmdb:${clean}|${s}|${e}`);
      serverEpisodeKeys.add(`series:${clean}|${s}|${e}`);
    }
  }

  for (const sKey of serverEpisodeKeys) {
    if (!currentLocalWatched.has(sKey)) {
      currentLocalWatched.add(sKey);
      currentLocalUnwatched.delete(sKey);
      changed = true;
      const sid = sKey.split("|")[0];
      if (sid) {
        newlyWatchedShows.add(sid);
        const clean = sid.replace(/^(series|movie|tmdb):/, "");
        newlyWatchedShows.add(clean);
        newlyWatchedShows.add(`tmdb:${clean}`);
        newlyWatchedShows.add(`series:${clean}`);
      }
    }
  }

  // Prune local episodes:
  // Case A: Targeted reconciliation (e.g. from detail.tsx for a specific series like Tulsa King)
  if (targetSeriesIds && targetSeriesIds.size > 0) {
    for (const lKey of Array.from(currentLocalWatched)) {
      const parts = lKey.split("|");
      const showId = parts[0];
      const cleanShowId = showId?.replace(/^(series|movie|tmdb):/, "");
      const isTargetShow =
        showId &&
        (targetSeriesIds.has(showId) || (cleanShowId && targetSeriesIds.has(cleanShowId)));
      if (isTargetShow && !serverEpisodeKeys.has(lKey)) {
        currentLocalWatched.delete(lKey);
        currentLocalUnwatched.add(lKey);
        changed = true;
      }
    }
  } else if (serverEpisodeKeys.size > 0) {
    // Case B: General sync - only prune for shows the server returned records for
    const serverShowsWithEpisodes = new Set<string>();
    for (const sKey of serverEpisodeKeys) {
      const parts = sKey.split("|");
      if (parts[0]) {
        const sid = parts[0];
        const clean = sid.replace(/^(series|movie|tmdb):/, "");
        serverShowsWithEpisodes.add(sid);
        serverShowsWithEpisodes.add(clean);
        serverShowsWithEpisodes.add(`tmdb:${clean}`);
        serverShowsWithEpisodes.add(`series:${clean}`);
      }
    }

    for (const lKey of Array.from(currentLocalWatched)) {
      const parts = lKey.split("|");
      const showId = parts[0];
      const cleanShowId = showId?.replace(/^(series|movie|tmdb):/, "");
      if (
        (serverShowsWithEpisodes.has(showId) || (cleanShowId && serverShowsWithEpisodes.has(cleanShowId))) &&
        !serverEpisodeKeys.has(lKey)
      ) {
        currentLocalWatched.delete(lKey);
        currentLocalUnwatched.add(lKey);
        changed = true;
      }
    }
  }

  if (changed) {
    persistCritical(sk, JSON.stringify([...currentLocalWatched]));
    persistCritical(unsk, JSON.stringify([...currentLocalUnwatched]));
    if (currentScope === sk) {
      watchedCache = currentLocalWatched;
      unwatchedCache = currentLocalUnwatched;
    } else {
      watchedCache = null;
      unwatchedCache = null;
      currentScope = "";
    }
    version += 1;
    notifySubs();
  }
  return { changed, newlyWatchedShows };
}

export function manualWatchedRawKeys(): string[] {
  return [...watchedSet()];
}

export function setManualWatched(
  metaId: string,
  season: number,
  episode: number,
  watched: boolean,
): void {
  if (!canPersistWatched()) return;
  const on = new Set(watchedSet());
  const off = new Set(unwatchedSet());
  const at = unwatchedAtMap();
  const rem = remoteSet();
  const clean = metaId.replace(/^(series|movie|tmdb):/, "").trim();
  const variants = Array.from(new Set([metaId, clean, `tmdb:${clean}`, `series:${clean}`]));
  let remChanged = false;
  for (const v of variants) {
    const k = key(v, season, episode);
    if (watched) {
      on.add(k);
      off.delete(k);
      delete at[k];
    } else {
      on.delete(k);
      off.add(k);
      at[k] = Date.now();
    }
    if (rem.delete(k)) remChanged = true;
  }
  if (remChanged) persistRemote();
  persistUnwatchedAt();
  persist(on, off);
}

export function setManualWatchedUpTo(
  metaId: string,
  season: number,
  episode: number,
  watched: boolean,
): void {
  if (!canPersistWatched()) return;
  const on = new Set(watchedSet());
  const off = new Set(unwatchedSet());
  const at = unwatchedAtMap();
  const rem = remoteSet();
  const now = Date.now();
  const clean = metaId.replace(/^(series|movie|tmdb):/, "").trim();
  const variants = Array.from(new Set([metaId, clean, `tmdb:${clean}`, `series:${clean}`]));
  let remChanged = false;
  for (let e = 1; e <= episode; e++) {
    for (const v of variants) {
      const k = key(v, season, e);
      if (watched) {
        on.add(k);
        off.delete(k);
        delete at[k];
      } else {
        on.delete(k);
        off.add(k);
        at[k] = now;
      }
      if (rem.delete(k)) remChanged = true;
    }
  }
  if (remChanged) persistRemote();
  persistUnwatchedAt();
  persist(on, off);
}

export function setManualWatchedMany(
  metaId: string,
  episodes: Array<{ season: number; episode: number }>,
  watched: boolean,
): void {
  if (!canPersistWatched()) return;
  const on = new Set(watchedSet());
  const off = new Set(unwatchedSet());
  const at = unwatchedAtMap();
  const rem = remoteSet();
  const now = Date.now();
  const clean = metaId.replace(/^(series|movie|tmdb):/, "").trim();
  const variants = Array.from(new Set([metaId, clean, `tmdb:${clean}`, `series:${clean}`]));
  let remChanged = false;
  for (const { season, episode } of episodes) {
    for (const v of variants) {
      const k = key(v, season, episode);
      if (watched) {
        on.add(k);
        off.delete(k);
        delete at[k];
      } else {
        on.delete(k);
        off.add(k);
        at[k] = now;
      }
      if (rem.delete(k)) remChanged = true;
    }
  }
  if (remChanged) persistRemote();
  persistUnwatchedAt();
  persist(on, off);
}

export function unwatchedAt(metaId: string, season: number, episode: number): number | undefined {
  return unwatchedAtMap()[key(metaId, season, episode)];
}

/** Each accepted storage write survives a later failure; reload the actual partial state. */
export function setManualWatchedManyAcknowledged(
  metaId: string,
  episodes: Array<{ season: number; episode: number }>,
  watched: boolean,
): void {
  if (!canPersistWatched()) return;
  const on = new Set(watchedSet());
  const off = new Set(unwatchedSet());
  const at = { ...unwatchedAtMap() };
  const remote = new Set(remoteSet());
  const clean = metaId.replace(/^(series|movie|tmdb):/, "").trim();
  const variants = Array.from(new Set([metaId, clean, `tmdb:${clean}`, `series:${clean}`]));
  for (const { season, episode } of episodes) {
    for (const v of variants) {
      const k = key(v, season, episode);
      if (watched) {
        on.add(k);
        off.delete(k);
        delete at[k];
      } else {
        on.delete(k);
        off.add(k);
        at[k] = Date.now();
      }
      remote.delete(k);
    }
  }
  try {
    localStorage.setItem(storeKey("unwatchedAt"), JSON.stringify(at));
    localStorage.setItem(storeKey("remote"), JSON.stringify([...remote]));
    // Clear the opposing override before setting the requested state.
    const pairs = watched
      ? ([
          ["unwatched", off],
          ["watched", on],
        ] as const)
      : ([
          ["watched", on],
          ["unwatched", off],
        ] as const);
    for (const [name, values] of pairs)
      localStorage.setItem(storeKey(name), JSON.stringify([...values]));
  } finally {
    watchedCache = null;
    unwatchedCache = null;
    unwatchedAtCache = null;
    remoteCache = null;
    version += 1;
    notifySubs();
  }
}

export function remoteWatchedKeys(metaId: string): Set<string> {
  const prefix = `${metaId}|`;
  const out = new Set<string>();
  for (const k of remoteSet()) {
    if (!k.startsWith(prefix)) continue;
    const parts = k.split("|");
    if (parts.length === 3) out.add(`${parts[1]}:${parts[2]}`);
  }
  return out;
}

export function applyRemoteWatched(
  metaId: string,
  add: Array<{ season: number; episode: number }>,
  unset: Array<{ season: number; episode: number }>,
): void {
  if (!canPersistWatched()) return;
  if (add.length === 0 && unset.length === 0) return;
  const on = new Set(watchedSet());
  const off = new Set(unwatchedSet());
  const at = unwatchedAtMap();
  const rem = remoteSet();
  const clean = metaId.replace(/^(series|movie|tmdb):/, "").trim();
  const variants = Array.from(new Set([metaId, clean, `tmdb:${clean}`, `series:${clean}`]));
  for (const { season, episode } of add) {
    for (const v of variants) {
      const k = key(v, season, episode);
      on.add(k);
      off.delete(k);
      delete at[k];
      rem.add(k);
    }
  }
  for (const { season, episode } of unset) {
    for (const v of variants) {
      const k = key(v, season, episode);
      on.delete(k);
      off.delete(k);
      delete at[k];
      rem.delete(k);
    }
  }
  persistUnwatchedAt();
  persistRemote();
  persist(on, off);
}

export function recordManualWatchedMeta(metaId: string, meta: ManualWatchedMeta): void {
  if (!canPersistWatched()) return;
  const all = loadMeta();
  const prev = all[metaId];
  undismiss(metaId);
  const entry: ManualWatchedMeta = { ...meta, markedAt: new Date().toISOString() };
  const next = { ...all, [metaId]: entry };
  metaCache = next;
  try {
    localStorage.setItem(storeKey("meta"), JSON.stringify(next));
  } catch {
    return;
  }
  if (
    prev &&
    prev.name === meta.name &&
    prev.poster === meta.poster &&
    prev.background === meta.background
  ) {
    return;
  }
  version += 1;
  notifySubs();
}

export function manualWatchedLibraryItems(): LibraryItem[] {
  const meta = loadMeta();
  const best = new Map<string, { season: number; episode: number }>();
  for (const k of watchedSet()) {
    const parts = k.split("|");
    if (parts.length !== 3) continue;
    const [metaId, s, e] = parts;
    const season = Number(s);
    const episode = Number(e);
    if (!metaId || !Number.isFinite(season) || !Number.isFinite(episode)) continue;
    const cur = best.get(metaId);
    if (!cur || season > cur.season || (season === cur.season && episode > cur.episode)) {
      best.set(metaId, { season, episode });
    }
  }
  const out: LibraryItem[] = [];
  const dismissed = dismissedSet();
  const now = new Date().toISOString();
  for (const [metaId, ep] of best) {
    const m = meta[metaId];
    if (!m || dismissed.has(metaId)) continue;
    const stamp = m.markedAt ?? now;
    out.push({
      _id: metaId,
      type: "series",
      name: m.name,
      poster: m.poster,
      background: m.background,
      state: {
        timeOffset: 0,
        duration: 0,
        season: ep.season,
        episode: ep.episode,
        video_id: `${metaId}:${ep.season}:${ep.episode}`,
        flaggedWatched: 1,
        lastWatched: stamp,
      },
      removed: false,
      temp: false,
      _ctime: stamp,
      _mtime: stamp,
      manualWatched: true,
    });
  }
  return out;
}

function notifySubs(): void {
  noteNotify("store:manual-watched");
  for (const fn of subs) fn();
}

export function subscribeManualWatched(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function manualWatchedVersion(): number {
  return version;
}

export function resetManualWatchedCache(): void {
  currentScope = "";
  watchedCache = null;
  unwatchedCache = null;
  metaCache = null;
  dismissedCache = null;
  unwatchedAtCache = null;
  remoteCache = null;
  version += 1;
  notifySubs();
}

export function clearManualWatched(profileOrSlot?: string | number): void {
  try {
    for (const kind of Object.keys(PREFIXES) as Array<keyof typeof PREFIXES>) {
      if (profileOrSlot != null) {
        const slotKey =
          typeof profileOrSlot === "number" || /^\d+$/.test(String(profileOrSlot))
            ? `nuvio.${profileOrSlot}`
            : String(profileOrSlot);
        localStorage.removeItem(`${PREFIXES[kind]}${slotKey}`);
      } else {
        localStorage.removeItem(LEGACY_KEYS[kind]);
        const id = activeProfileId();
        if (id) localStorage.removeItem(`${PREFIXES[kind]}${id}`);
      }
    }
  } catch {}
  resetManualWatchedCache();
}

export function clearAllNuvioManualWatched(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k &&
        (k.startsWith("harbor.manualwatched.v1.nuvio.") ||
          k.startsWith("harbor.manualunwatched.v1.nuvio.") ||
          k.startsWith("harbor.manualwatched.meta.v1.nuvio.") ||
          k.startsWith("harbor.manualwatched.dismissed.v1.nuvio.") ||
          k.startsWith("harbor.manualunwatched.at.v1.nuvio.") ||
          k.startsWith("harbor.manualwatched.fromremote.v1.nuvio.") ||
          k.includes(".nuvio."))
      ) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
  resetManualWatchedCache();
}

if (typeof window !== "undefined") {
  const onReset = () => {
    currentScope = "";
    watchedCache = null;
    unwatchedCache = null;
    metaCache = null;
    dismissedCache = null;
    unwatchedAtCache = null;
    remoteCache = null;
    version += 1;
    notifySubs();
  };
  window.addEventListener("harbor:active-profile-changed", onReset);
  window.addEventListener("harbor:profiles-updated", onReset);
  window.addEventListener("harbor:account-provider-changed", onReset);
  window.addEventListener("harbor:nuvio-profile-changed", onReset);
  window.addEventListener("harbor:nuvio-state-changed", onReset);
  window.addEventListener("harbor:watched-changed", onReset);
}
