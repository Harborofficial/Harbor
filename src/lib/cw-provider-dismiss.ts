import { activeProfileId } from "@/lib/active-profile-id";
import type { LibraryItem } from "@/lib/stremio";
import { deleteSimklPlayback, fetchSimklPlaybackItems } from "@/lib/simkl/playback";
import {
  getSession as getSimklSession,
  subscribeSession as subscribeSimklSession,
} from "@/lib/simkl/session";
import { deleteTraktPlayback, fetchTraktPlaybackItems } from "@/lib/trakt/playback";
import {
  getSession as getTraktSession,
  subscribeSession as subscribeTraktSession,
} from "@/lib/trakt/session";
import { fetchPublicMetaDbPlaybackItems } from "@/lib/publicmetadb/playback";
import { pmdbDeleteResume } from "@/lib/publicmetadb/scrobble";
import {
  isAuthenticated as isPmdbAuthenticated,
  subscribeSession as subscribePmdbSession,
} from "@/lib/publicmetadb/session";

export const CW_PROVIDER_SOURCES = ["trakt", "simkl", "publicmetadb"] as const;
export type CwProviderSource = (typeof CW_PROVIDER_SOURCES)[number];

export type ProviderDismissResult = { failed: CwProviderSource[] };

type ProviderCheckpoint = {
  lastWatched?: number;
  timeOffset?: number;
};

type PendingProviderClear = {
  provider: CwProviderSource;
  id: string;
  attempts: number;
  nextAt: number;
  addedAt: number;
  lastWatched?: number;
  timeOffset?: number;
};

const QUEUE_KEY = "harbor.cw.provider-clear.v1";
const MAX_QUEUE = 100;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 30 * 60_000;
const PROVIDER_TIMEOUT_MS = 20_000;
let queueTimer: number | null = null;
let flushInFlight: Promise<void> | null = null;

function queueStorageKey(): string {
  return `${QUEUE_KEY}.${activeProfileId()}`;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Provider request timed out")),
      PROVIDER_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function readQueue(): PendingProviderClear[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(queueStorageKey()) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PendingProviderClear =>
        entry != null &&
        CW_PROVIDER_SOURCES.includes(entry.provider) &&
        typeof entry.id === "string" &&
        entry.id.length > 0 &&
        typeof entry.attempts === "number" &&
        Number.isFinite(entry.attempts) &&
        typeof entry.nextAt === "number" &&
        Number.isFinite(entry.nextAt) &&
        typeof entry.addedAt === "number" &&
        Number.isFinite(entry.addedAt) &&
        (entry.lastWatched == null ||
          (typeof entry.lastWatched === "number" && Number.isFinite(entry.lastWatched))) &&
        (entry.timeOffset == null ||
          (typeof entry.timeOffset === "number" && Number.isFinite(entry.timeOffset))),
    );
  } catch {
    return [];
  }
}

function writeQueue(entries: PendingProviderClear[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(queueStorageKey());
    else localStorage.setItem(queueStorageKey(), JSON.stringify(entries));
  } catch {
    // The dismissal already succeeded locally; a queue write failure must not throw.
  }
}

function scheduleQueueFlush(entries = readQueue()): void {
  if (typeof window === "undefined") return;
  if (queueTimer != null) {
    window.clearTimeout(queueTimer);
    queueTimer = null;
  }
  if (entries.length === 0) return;
  const nextAt = Math.min(...entries.map((entry) => entry.nextAt));
  queueTimer = window.setTimeout(
    () => {
      queueTimer = null;
      void flushProviderDismissQueue(false);
    },
    Math.max(1_000, nextAt - Date.now()),
  );
}

export function queueProviderPlaybackClear(
  provider: CwProviderSource,
  id: string,
  checkpoint?: ProviderCheckpoint,
): void {
  if (!id) return;
  const now = Date.now();
  const entries = readQueue();
  const existing = entries.find((entry) => entry.provider === provider && entry.id === id);
  if (existing) {
    existing.nextAt = now + RETRY_BASE_MS;
    existing.addedAt = now;
    existing.attempts = 0;
    if (checkpoint?.lastWatched != null) existing.lastWatched = checkpoint.lastWatched;
    if (checkpoint?.timeOffset != null) existing.timeOffset = checkpoint.timeOffset;
  } else {
    entries.push({
      provider,
      id,
      attempts: 0,
      nextAt: now + RETRY_BASE_MS,
      addedAt: now,
      ...(checkpoint?.lastWatched != null ? { lastWatched: checkpoint.lastWatched } : {}),
      ...(checkpoint?.timeOffset != null ? { timeOffset: checkpoint.timeOffset } : {}),
    });
  }
  while (entries.length > MAX_QUEUE) entries.shift();
  writeQueue(entries);
  scheduleQueueFlush(entries);
}

export function flushProviderDismissQueue(force = true): Promise<void> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    const entries = readQueue();
    if (entries.length === 0) return;
    const now = Date.now();
    const due = force ? entries : entries.filter((entry) => entry.nextAt <= now);
    if (due.length === 0) {
      scheduleQueueFlush(entries);
      return;
    }
    const keyOf = (entry: PendingProviderClear) => `${entry.provider}|${entry.id}`;
    const original = new Set(due.map(keyOf));
    const cleared = new Set<string>();
    const failed = new Map<string, PendingProviderClear>();
    const defer = (key: string, entry: PendingProviderClear) => {
      const attempts = entry.attempts + 1;
      failed.set(key, {
        ...entry,
        attempts,
        nextAt: Date.now() + Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_MAX_MS),
      });
    };
    for (const entry of due) {
      const key = keyOf(entry);
      if (!hasProviderSession(entry.provider)) {
        defer(key, entry);
        continue;
      }
      let items: LibraryItem[] | null = null;
      try {
        items = await withTimeout(fetchProviderItems(entry.provider, true));
      } catch {
        items = null;
      }
      if (!items) {
        defer(key, entry);
        continue;
      }
      // A missing id means the old session was cleared or replaced. A current
      // session with newer progress means the user resumed; leave it alone.
      const current = items.find((item) => item.providerPlaybackIds?.[entry.provider] === entry.id);
      if (!current) {
        cleared.add(key);
        continue;
      }
      const remoteAt = Date.parse(current.state?.lastWatched ?? "") || 0;
      const baseline = entry.lastWatched ?? entry.addedAt;
      const remoteOffset = current.state?.timeOffset;
      const resumed =
        remoteAt > baseline + 1_000 ||
        (entry.timeOffset != null &&
          remoteOffset != null &&
          remoteOffset > entry.timeOffset + 1_000);
      if (resumed) {
        cleared.add(key);
        continue;
      }
      let ok = false;
      try {
        ok = await withTimeout(deleteProviderPlayback(entry.provider, entry.id));
      } catch {
        ok = false;
      }
      if (ok) cleared.add(key);
      else defer(key, entry);
    }
    // A dismissal can enqueue another clear while these requests are in flight.
    // Keep those newer entries instead of overwriting them with the snapshot.
    const next = readQueue().flatMap((entry) => {
      const key = keyOf(entry);
      if (!original.has(key)) return [entry];
      if (cleared.has(key)) return [];
      return [failed.get(key) ?? entry];
    });
    writeQueue(next);
    scheduleQueueFlush(next);
  })().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  // Finish provider clears that failed during an earlier session. The timer
  // also covers a launch while the provider account is still restoring.
  window.setTimeout(() => void flushProviderDismissQueue(), 3_000);
  window.addEventListener("online", () => void flushProviderDismissQueue());
  window.addEventListener("harbor:active-profile-changed", () => void flushProviderDismissQueue());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flushProviderDismissQueue();
  });
  subscribeTraktSession(() => void flushProviderDismissQueue());
  subscribeSimklSession(() => void flushProviderDismissQueue());
  subscribePmdbSession(() => void flushProviderDismissQueue());
}

function sameContent(a: LibraryItem, b: LibraryItem): boolean {
  const ids = new Set([a._id, ...(a.altIds ?? [])]);
  const contentMatches = ids.has(b._id) || (b.altIds ?? []).some((id) => ids.has(id));
  if (!contentMatches) return false;
  return sameCheckpoint(a, b);
}

function sameCheckpoint(a: LibraryItem, b: LibraryItem): boolean {
  const aSeason = a.state?.season;
  const bSeason = b.state?.season;
  if (aSeason == null || bSeason == null) return true;
  return aSeason === bSeason && a.state?.episode === b.state?.episode;
}

function hasProviderSession(provider: CwProviderSource): boolean {
  if (provider === "trakt") return !!getTraktSession();
  if (provider === "simkl") return !!getSimklSession();
  return isPmdbAuthenticated();
}

async function fetchProviderItems(
  provider: CwProviderSource,
  fresh = false,
): Promise<LibraryItem[]> {
  if (provider === "trakt") return fetchTraktPlaybackItems(fresh);
  if (provider === "simkl") return fetchSimklPlaybackItems(fresh);
  return fetchPublicMetaDbPlaybackItems(fresh);
}

function checkpointFromItem(item: LibraryItem): ProviderCheckpoint {
  const lastWatched = Date.parse(item.state?.lastWatched ?? "");
  return {
    ...(Number.isFinite(lastWatched) && lastWatched > 0 ? { lastWatched } : {}),
    ...(typeof item.state?.timeOffset === "number" ? { timeOffset: item.state.timeOffset } : {}),
  };
}

function deleteProviderPlayback(provider: CwProviderSource, id: string): Promise<boolean> {
  if (provider === "trakt") return deleteTraktPlayback(id);
  if (provider === "simkl") return deleteSimklPlayback(id);
  return pmdbDeleteResume(id);
}

/**
 * Delete only saved playback/resume positions. Never touch watch history or
 * watchlist status; SIMKL's Watching entry can remain after its playback is gone.
 */
export async function clearProviderPlayback(
  item: LibraryItem,
  providers: readonly CwProviderSource[],
): Promise<ProviderDismissResult> {
  const ids: Partial<Record<CwProviderSource, string>> = {};
  const checkpoints: Partial<Record<CwProviderSource, ProviderCheckpoint>> = {};
  for (const member of [item, ...(item.cwMembers ?? [])]) {
    // A deduped show can carry another episode's member; only use ids for the
    // checkpoint this card actually represents. Members can have different ids
    // for the same title, so this compares the episode checkpoint, not the id.
    if (!sameCheckpoint(item, member)) continue;
    const memberCheckpoint = checkpointFromItem(member);
    for (const provider of providers) {
      const id = member.providerPlaybackIds?.[provider];
      if (!id) continue;
      ids[provider] = id;
      const held = checkpoints[provider] ?? {};
      if (held.lastWatched == null && memberCheckpoint.lastWatched != null) {
        held.lastWatched = memberCheckpoint.lastWatched;
      }
      if (held.timeOffset == null && memberCheckpoint.timeOffset != null) {
        held.timeOffset = memberCheckpoint.timeOffset;
      }
      checkpoints[provider] = held;
    }
  }

  const failed = await Promise.all(
    providers.map(async (provider): Promise<CwProviderSource | null> => {
      const clear = async (id: string, checkpoint?: ProviderCheckpoint): Promise<boolean> => {
        let cleared = false;
        try {
          cleared = await withTimeout(deleteProviderPlayback(provider, id));
        } catch {
          cleared = false;
        }
        if (!cleared) queueProviderPlaybackClear(provider, id, checkpoint);
        return cleared;
      };
      try {
        const direct = ids[provider];
        if (direct) return (await clear(direct, checkpoints[provider])) ? null : provider;
        const items = await withTimeout(fetchProviderItems(provider));
        const match = items.find(
          (entry) =>
            sameContent(item, entry) ||
            item.cwMembers?.some((member) => sameContent(member, entry)),
        );
        const found = match?.providerPlaybackIds?.[provider];
        if (!found) return null;
        return (await clear(found, match ? checkpointFromItem(match) : undefined))
          ? null
          : provider;
      } catch {
        return provider;
      }
    }),
  );

  return {
    failed: [...new Set(failed.filter((value): value is CwProviderSource => value !== null))],
  };
}
