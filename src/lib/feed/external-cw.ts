import { useEffect, useSyncExternalStore } from "react";
import { noteNotify } from "@/lib/render-cause";
import { detectAnimeForCw } from "@/lib/anime-detect";
import { fetchSimklPlaybackItems, readCachedSimklPlaybackItems } from "@/lib/simkl/playback";
import { fetchTraktPlaybackItems, readCachedTraktPlaybackItems } from "@/lib/trakt/playback";
import {
  fetchNuvioPlaybackItems,
  readCachedNuvioPlaybackItems,
  writeCachedNuvioPlaybackItems,
} from "@/lib/nuvio/nuvio-playback";
import { isNuvioSignedIn } from "@/lib/nuvio/nuvio-client";
import { isNuvioProviderActive, resolveNuvioProfileIndex } from "@/lib/nuvio/nuvio-sync";
import {
  getSession as getSimklSession,
  subscribeSession as subscribeSimklSession,
} from "@/lib/simkl/session";
import {
  getSession as getTraktSession,
  subscribeSession as subscribeTraktSession,
} from "@/lib/trakt/session";
import { fetchPublicMetaDbPlaybackItems } from "@/lib/publicmetadb/playback";
import {
  getSession as getPmdbSession,
  subscribeSession as subscribePmdbSession,
} from "@/lib/publicmetadb/session";
import { type LibraryItem } from "@/lib/stremio";

const STALE_MS = 300_000;
const FOCUS_STALE_MS = 30_000;
const RETRY_DELAYS_MS = [1000, 4000, 10000];
const EMPTY: LibraryItem[] = [];

// Per-slot in-memory cache for snappy instant profile switches
const slotCwMemoryCache = new Map<number, LibraryItem[]>();

export function clearNuvioCwMemoryCache(): void {
  slotCwMemoryCache.clear();
}

export function getCachedNuvioItemsForSlot(slot: number): LibraryItem[] {
  const mem = slotCwMemoryCache.get(slot);
  if (mem && mem.length > 0) return mem;
  const disk = readCachedNuvioPlaybackItems(slot);
  if (disk && disk.length > 0) {
    slotCwMemoryCache.set(slot, disk);
    return disk;
  }
  return [];
}

let sourceMask = { trakt: true, simkl: true, publicmetadb: false, nuvio: isNuvioProviderActive() };

function activityOf(i: LibraryItem): number {
  const lw = Date.parse(i.state?.lastWatched ?? "");
  if (Number.isFinite(lw)) return lw;
  const m = Date.parse(i._mtime ?? "");
  return Number.isFinite(m) ? m : 0;
}

function mergeItem(existing: LibraryItem, incoming: LibraryItem): LibraryItem {
  const isExistingNuvio = existing.external === "nuvio";
  const isIncomingNuvio = incoming.external === "nuvio";

  if (isExistingNuvio && !isIncomingNuvio) {
    if (activityOf(incoming) > activityOf(existing)) {
      return {
        ...existing,
        state: {
          ...existing.state,
          ...incoming.state,
          video_id: incoming.state?.video_id ?? existing.state?.video_id,
          season: incoming.state?.season ?? existing.state?.season,
          episode: incoming.state?.episode ?? existing.state?.episode,
          timeOffset: incoming.state?.timeOffset ?? existing.state?.timeOffset ?? 0,
          duration: incoming.state?.duration ?? existing.state?.duration ?? 0,
          lastWatched: incoming.state?.lastWatched ?? existing.state?.lastWatched,
        },
        _mtime: incoming._mtime ?? existing._mtime,
      };
    }
    return existing;
  }

  if (!isExistingNuvio && isIncomingNuvio) {
    if (activityOf(existing) > activityOf(incoming)) {
      return {
        ...incoming,
        state: {
          ...incoming.state,
          ...existing.state,
          video_id: existing.state?.video_id ?? incoming.state?.video_id,
          season: existing.state?.season ?? incoming.state?.season,
          episode: existing.state?.episode ?? incoming.state?.episode,
          timeOffset: existing.state?.timeOffset ?? incoming.state?.timeOffset ?? 0,
          duration: existing.state?.duration ?? incoming.state?.duration ?? 0,
          lastWatched: existing.state?.lastWatched ?? incoming.state?.lastWatched,
        },
        _mtime: existing._mtime ?? incoming._mtime,
      };
    }
    return incoming;
  }

  return activityOf(incoming) > activityOf(existing) ? incoming : existing;
}

function isEligibleTrackerPlayback(i: LibraryItem): boolean {
  if (i.external !== "simkl" && i.external !== "trakt" && i.external !== "publicmetadb") {
    return true;
  }
  if (i.upNext || i.waitingForAir) return true;
  const offset = i.state?.timeOffset ?? 0;
  const dur = i.state?.duration ?? 0;
  if (offset <= 0 || (i.state?.flaggedWatched ?? 0) > 0) return false;
  if (dur > 0 && offset / dur >= 0.9) return false;
  return true;
}

function merge(lists: LibraryItem[][]): LibraryItem[] {
  const byId = new Map<string, LibraryItem>();
  for (const list of lists) {
    for (const i of list) {
      if (!isEligibleTrackerPlayback(i)) continue;
      const held = byId.get(i._id);
      if (!held) byId.set(i._id, i);
      else byId.set(i._id, mergeItem(held, i));
    }
  }
  return [...byId.values()].sort((a, b) => activityOf(b) - activityOf(a));
}

// Pre-populate items synchronously on module load from disk cache
let items: LibraryItem[] = (() => {
  if (typeof window === "undefined") return EMPTY;
  const initialLists: LibraryItem[][] = [];
  if (isNuvioSignedIn() && isNuvioProviderActive()) {
    try {
      const slot = resolveNuvioProfileIndex();
      const initial = getCachedNuvioItemsForSlot(slot);
      if (initial.length > 0) initialLists.push(initial);
    } catch {}
  }
  if (typeof readCachedTraktPlaybackItems === "function" && getTraktSession() && sourceMask.trakt) {
    try {
      const initialTrakt = readCachedTraktPlaybackItems();
      if (initialTrakt && initialTrakt.length > 0) initialLists.push(initialTrakt);
    } catch {}
  }
  if (typeof readCachedSimklPlaybackItems === "function" && getSimklSession() && sourceMask.simkl) {
    try {
      const initialSimkl = readCachedSimklPlaybackItems();
      if (initialSimkl && initialSimkl.length > 0) initialLists.push(initialSimkl);
    } catch {}
  }
  return initialLists.length > 0 ? merge(initialLists) : EMPTY;
})();

let fetchedAt = 0;
let inflight: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let refreshGen = 0;
let lastAppliedGen = 0;
const subs = new Set<() => void>();

function emit(): void {
  noteNotify("store:external-cw");
  for (const fn of subs) fn();
}

function setItems(next: LibraryItem[]): void {
  if (next.length === 0 && items.length === 0) return;
  items = next;
  emit();
  void detectAnimeForCw(next.filter((item) => !item.isAnime));
}

export function externalCwConnected(): boolean {
  const nuvioActive = isNuvioProviderActive() && isNuvioSignedIn() && sourceMask.nuvio !== false;
  return (
    (sourceMask.simkl && !!getSimklSession()) ||
    (sourceMask.trakt && !!getTraktSession()) ||
    (sourceMask.publicmetadb && !!getPmdbSession()) ||
    nuvioActive
  );
}

export function setExternalCwSources(mask: {
  trakt: boolean;
  simkl: boolean;
  publicmetadb?: boolean;
  nuvio?: boolean;
}): void {
  const pm = mask.publicmetadb ?? sourceMask.publicmetadb;
  const nuvio = mask.nuvio !== undefined ? mask.nuvio : isNuvioProviderActive();
  if (
    mask.trakt === sourceMask.trakt &&
    mask.simkl === sourceMask.simkl &&
    pm === sourceMask.publicmetadb &&
    nuvio === sourceMask.nuvio
  )
    return;

  sourceMask = { trakt: mask.trakt, simkl: mask.simkl, publicmetadb: pm, nuvio };
  fetchedAt = 0;

  // Drop items from newly-disabled sources synchronously so their cards vanish
  // immediately instead of lingering until the next successful refresh.
  let nextItems = items;
  if (items.length > 0) {
    const kept = items.filter(
      (i) =>
        (sourceMask.trakt || i.external !== "trakt") &&
        (sourceMask.simkl || i.external !== "simkl") &&
        (sourceMask.publicmetadb || i.external !== "publicmetadb") &&
        (sourceMask.nuvio || i.external !== "nuvio"),
    );
    if (kept.length !== items.length) {
      nextItems = kept;
    }
  }

  // Pre-load cached items synchronously from enabled sources if currently missing
  const hasTraktInItems = nextItems.some((i) => i.external === "trakt");
  const hasSimklInItems = nextItems.some((i) => i.external === "simkl");
  const hasNuvioInItems = nextItems.some((i) => i.external === "nuvio");

  const toAdd: LibraryItem[][] = [];
  if (
    sourceMask.trakt &&
    !hasTraktInItems &&
    typeof readCachedTraktPlaybackItems === "function" &&
    getTraktSession()
  ) {
    try {
      const c = readCachedTraktPlaybackItems();
      if (c && c.length > 0) toAdd.push(c);
    } catch {}
  }
  if (
    sourceMask.simkl &&
    !hasSimklInItems &&
    typeof readCachedSimklPlaybackItems === "function" &&
    getSimklSession()
  ) {
    try {
      const c = readCachedSimklPlaybackItems();
      if (c && c.length > 0) toAdd.push(c);
    } catch {}
  }
  if (sourceMask.nuvio && !hasNuvioInItems && isNuvioSignedIn() && isNuvioProviderActive()) {
    try {
      const slot = resolveNuvioProfileIndex();
      const c = getCachedNuvioItemsForSlot(slot);
      if (c && c.length > 0) toAdd.push(c);
    } catch {}
  }
  if (toAdd.length > 0) {
    nextItems = merge([nextItems, ...toAdd]);
  }

  if (nextItems !== items) {
    setItems(nextItems);
  }

  if (!externalCwConnected()) setItems(EMPTY);
  void refreshExternalCw(true);
}

async function runRefresh(gen: number): Promise<boolean> {
  const enabled: Array<{
    source: "simkl" | "trakt" | "publicmetadb" | "nuvio";
    fetch: () => Promise<LibraryItem[]>;
  }> = [];
  if (getSimklSession() && sourceMask.simkl)
    enabled.push({ source: "simkl", fetch: fetchSimklPlaybackItems });
  if (getTraktSession() && sourceMask.trakt)
    enabled.push({ source: "trakt", fetch: fetchTraktPlaybackItems });
  if (getPmdbSession() && sourceMask.publicmetadb)
    enabled.push({ source: "publicmetadb", fetch: fetchPublicMetaDbPlaybackItems });
  if (isNuvioSignedIn() && sourceMask.nuvio && isNuvioProviderActive()) {
    enabled.push({
      source: "nuvio",
      fetch: async () => {
        const slot = resolveNuvioProfileIndex();
        return await fetchNuvioPlaybackItems(slot);
      },
    });
  }

  const results = await Promise.all(
    enabled.map(async ({ fetch }) => {
      try {
        return await fetch();
      } catch {
        return null;
      }
    }),
  );

  // If a newer generation has already finished and applied, ignore this superseded run
  if (gen < lastAppliedGen) return true;
  lastAppliedGen = gen;

  const complete = results.every((r) => r !== null);
  fetchedAt = complete ? Date.now() : 0;
  const succeeded = results.filter((r): r is LibraryItem[] => r !== null);
  if (succeeded.length === 0) return false;
  const failedSources = new Set(
    enabled.filter((_, index) => results[index] === null).map(({ source }) => source),
  );
  const retained = items.filter((i) => i.external && failedSources.has(i.external));
  const activeItems = [...succeeded, retained].flat().filter((i) => {
    if (i.external === "trakt") return sourceMask.trakt && !!getTraktSession();
    if (i.external === "simkl") return sourceMask.simkl && !!getSimklSession();
    if (i.external === "publicmetadb") return sourceMask.publicmetadb && !!getPmdbSession();
    if (i.external === "nuvio")
      return sourceMask.nuvio && isNuvioSignedIn() && isNuvioProviderActive();
    return true;
  });
  setItems(merge([activeItems]));
  if (complete) retryAttempt = 0;
  return complete;
}

function cancelRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryAttempt = 0;
}

function scheduleRetry(): void {
  if (retryTimer !== null) return;
  if (retryAttempt >= RETRY_DELAYS_MS.length) return;
  const gen = refreshGen;
  const delay = RETRY_DELAYS_MS[retryAttempt];
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (gen === refreshGen) void startRefresh(gen);
  }, delay);
}

function startRefresh(gen: number): Promise<void> {
  inflight = runRefresh(gen)
    .then((ok) => {
      if (gen === refreshGen && !ok) scheduleRetry();
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function refreshExternalCw(force = false): Promise<void> {
  if (!externalCwConnected()) {
    refreshGen += 1;
    cancelRetry();
    fetchedAt = 0;
    setItems(EMPTY);
    return Promise.resolve();
  }
  if (inflight) {
    if (!force) return inflight;
    // Don't kill the active in-flight request: let it deliver, then run another if needed
    return inflight.then(() => refreshExternalCw(false));
  }
  if (!force && fetchedAt > 0 && Date.now() - fetchedAt < STALE_MS) return Promise.resolve();
  cancelRetry();
  return startRefresh(++refreshGen);
}

function matchesContentId(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = a.replace(/^(series|movie|tmdb):/, "").trim();
  const cb = b.replace(/^(series|movie|tmdb):/, "").trim();
  return !!ca && ca === cb;
}

export function removeExternalCwItem(item: LibraryItem): void {
  items = items.filter((i) => !matchesContentId(i._id, item._id));
  emit();

  if (item.external === "nuvio" || (isNuvioSignedIn() && isNuvioProviderActive())) {
    try {
      const slot = resolveNuvioProfileIndex();
      const cur = slotCwMemoryCache.get(slot) || [];
      slotCwMemoryCache.set(
        slot,
        cur.filter((i) => !matchesContentId(i._id, item._id)),
      );
      const disk = readCachedNuvioPlaybackItems(slot);
      const filteredDisk = disk.filter((i) => !matchesContentId(i._id, item._id));
      writeCachedNuvioPlaybackItems(slot, filteredDisk);
    } catch {}
  }
}

export function subscribeExternalCw(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function listExternalCw(): LibraryItem[] {
  return items;
}

let lastSimkl = getSimklSession();
let lastTrakt = getTraktSession();
let lastPmdb = getPmdbSession();
let lastNuvio = isNuvioSignedIn() && isNuvioProviderActive();

function onSessionChange(): void {
  slotCwMemoryCache.clear();
  sourceMask.nuvio = isNuvioProviderActive();
  const simkl = getSimklSession();
  const trakt = getTraktSession();
  const pmdb = getPmdbSession();
  const nuvio = isNuvioSignedIn() && isNuvioProviderActive();
  if (simkl === lastSimkl && trakt === lastTrakt && pmdb === lastPmdb && nuvio === lastNuvio)
    return;
  setItems(
    items.filter(
      (i) =>
        (i.external !== "simkl" || simkl === lastSimkl) &&
        (i.external !== "trakt" || trakt === lastTrakt) &&
        (i.external !== "publicmetadb" || pmdb === lastPmdb) &&
        (i.external !== "nuvio" || nuvio === lastNuvio),
    ),
  );
  lastSimkl = simkl;
  lastTrakt = trakt;
  lastPmdb = pmdb;
  lastNuvio = nuvio;
  fetchedAt = 0;
  if (!externalCwConnected()) {
    cancelRetry();
    setItems(EMPTY);
    return;
  }
  void refreshExternalCw(true);
}

function onProfileChange(): void {
  sourceMask.nuvio = isNuvioProviderActive();
  lastSimkl = getSimklSession();
  lastTrakt = getTraktSession();
  lastPmdb = getPmdbSession();
  lastNuvio = isNuvioSignedIn() && isNuvioProviderActive();
  fetchedAt = 0;

  if (isNuvioSignedIn() && sourceMask.nuvio && isNuvioProviderActive()) {
    const currentSlot = resolveNuvioProfileIndex();
    const cached = getCachedNuvioItemsForSlot(currentSlot);
    if (cached.length > 0) {
      setItems(cached);
    } else {
      const built = readCachedNuvioPlaybackItems(currentSlot);
      if (built.length > 0) {
        slotCwMemoryCache.set(currentSlot, built);
        setItems(built);
      } else {
        setItems(EMPTY);
      }
    }
  } else {
    setItems(items.filter((i) => i.external !== "nuvio"));
  }

  void refreshExternalCw(true);
}

if (typeof window !== "undefined") {
  subscribeSimklSession(onSessionChange);
  subscribeTraktSession(onSessionChange);
  subscribePmdbSession(onSessionChange);
  window.addEventListener("harbor:active-profile-changed", onProfileChange);
  window.addEventListener("harbor:profiles-updated", onProfileChange);
  window.addEventListener("harbor:nuvio-state-changed", () => {
    clearNuvioCwMemoryCache();
    onSessionChange();
    void refreshExternalCw(true);
  });
  window.addEventListener("harbor:account-provider-changed", () => {
    clearNuvioCwMemoryCache();
    onSessionChange();
    void refreshExternalCw(true);
  });
  window.addEventListener("harbor:nuvio-profile-changed", onProfileChange);
  window.addEventListener("harbor:nuvio-profiles-updated", () => {
    void refreshExternalCw(false);
  });
  window.addEventListener("harbor:account-provider-changed", onProfileChange);
  window.addEventListener("harbor:playback-session-ended", () => {
    if (!isNuvioProviderActive()) return;
    void refreshExternalCw(true);
  });
  window.addEventListener("harbor:nuvio-progress-pushed", (e) => {
    if (isNuvioSignedIn() && sourceMask.nuvio && isNuvioProviderActive()) {
      const detail = (e as CustomEvent)?.detail;
      const slot =
        typeof detail?.profileIndex === "number" ? detail.profileIndex : resolveNuvioProfileIndex();
      const current = resolveNuvioProfileIndex();
      if (slot === current) {
        const fresh = readCachedNuvioPlaybackItems(slot);
        if (fresh.length > 0) {
          slotCwMemoryCache.set(slot, fresh);
          const nonNuvio = items.filter((i) => i.external !== "nuvio");
          setItems(merge([fresh, nonNuvio]));
        }
      }
    }
    void refreshExternalCw(false);
  });
  window.addEventListener("harbor:nuvio-progress-deleted", (e) => {
    if (isNuvioSignedIn() && sourceMask.nuvio && isNuvioProviderActive()) {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.episodeOnly) return;
      const slot =
        typeof detail?.profileIndex === "number" ? detail.profileIndex : resolveNuvioProfileIndex();
      const current = resolveNuvioProfileIndex();
      if (slot === current) {
        const contentId = detail?.contentId;
        if (contentId) {
          items = items.filter((i) => !matchesContentId(i._id, contentId));
          const curMem = slotCwMemoryCache.get(slot) || [];
          slotCwMemoryCache.set(
            slot,
            curMem.filter((i) => !matchesContentId(i._id, contentId)),
          );
          emit();
        }
        const fresh = readCachedNuvioPlaybackItems(slot).filter(
          (i) => !contentId || !matchesContentId(i._id, contentId),
        );
        slotCwMemoryCache.set(slot, fresh);
        const nonNuvio = items.filter(
          (i) => i.external !== "nuvio" && (!contentId || !matchesContentId(i._id, contentId)),
        );
        setItems(merge([fresh, nonNuvio]));
      }
    }
  });
  window.addEventListener("harbor:nuvio-progress-reconciled", (e) => {
    if (isNuvioSignedIn() && sourceMask.nuvio && isNuvioProviderActive()) {
      const detail = (e as CustomEvent)?.detail;
      const slot =
        typeof detail?.profileIndex === "number" ? detail.profileIndex : resolveNuvioProfileIndex();
      const current = resolveNuvioProfileIndex();
      if (slot === current) {
        const fresh = readCachedNuvioPlaybackItems(slot);
        slotCwMemoryCache.set(slot, fresh);
        const nonNuvio = items.filter((i) => i.external !== "nuvio");
        setItems(merge([fresh, nonNuvio]));
      }
    }
  });
  window.addEventListener("harbor:continue-watching-updated", () => {
    if (isNuvioSignedIn() && sourceMask.nuvio && isNuvioProviderActive()) {
      const slot = resolveNuvioProfileIndex();
      const fresh = readCachedNuvioPlaybackItems(slot);
      slotCwMemoryCache.set(slot, fresh);
      const nonNuvio = items.filter((i) => i.external !== "nuvio");
      setItems(merge([fresh, nonNuvio]));
    }
  });
}

export function useExternalCw(enabled = true): LibraryItem[] {
  const snapshot = useSyncExternalStore(subscribeExternalCw, listExternalCw, listExternalCw);
  useEffect(() => {
    if (!enabled) return;
    if (items.length === 0 && isNuvioSignedIn() && sourceMask.nuvio && isNuvioProviderActive()) {
      try {
        const slot = resolveNuvioProfileIndex();
        const cached = getCachedNuvioItemsForSlot(slot);
        if (cached.length > 0) {
          const nonNuvio = items.filter((i) => i.external !== "nuvio");
          setItems(merge([cached, nonNuvio]));
        }
      } catch {}
    }
    onSessionChange();
    if (isNuvioSignedIn() && isNuvioProviderActive()) {
      void refreshExternalCw(true);
    } else {
      void refreshExternalCw();
    }
    const onFocus = (): void => {
      const isNuvio = isNuvioSignedIn() && isNuvioProviderActive();
      if (isNuvio) {
        void refreshExternalCw(true);
      } else {
        if (Date.now() - fetchedAt > FOCUS_STALE_MS) void refreshExternalCw(true);
        else void refreshExternalCw();
      }
    };
    const onVisible = (): void => {
      if (document.visibilityState !== "visible") return;
      const isNuvio = isNuvioSignedIn() && isNuvioProviderActive();
      if (isNuvio) {
        void refreshExternalCw(true);
      } else {
        if (Date.now() - fetchedAt > FOCUS_STALE_MS) void refreshExternalCw(true);
        else void refreshExternalCw();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const pollMs = isNuvioSignedIn() && isNuvioProviderActive() ? 30_000 : STALE_MS;
    const timer = window.setInterval(onVisible, pollMs);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [enabled]);
  return enabled ? snapshot : EMPTY;
}
