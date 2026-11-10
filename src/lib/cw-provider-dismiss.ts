import { activeProfileId } from "@/lib/active-profile-id";
import { episodeFromVideoId, type LibraryItem } from "@/lib/stremio";
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
  getSession as getPmdbSession,
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
  /** Provider account that owned this playback id when the clear was queued. */
  account?: string;
  /** Unique per enqueue: tells a newer request apart from the flushed snapshot. */
  op?: string;
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
let opSeq = 0;

/** Millisecond timestamps collide, so the revision is a separate identity. */
function nextOpId(): string {
  opSeq = (opSeq + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${opSeq.toString(36)}`;
}

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

function readQueue(key = queueStorageKey()): PendingProviderClear[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
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
        (entry.account == null || typeof entry.account === "string") &&
        (entry.op == null || typeof entry.op === "string") &&
        (entry.lastWatched == null ||
          (typeof entry.lastWatched === "number" && Number.isFinite(entry.lastWatched))) &&
        (entry.timeOffset == null ||
          (typeof entry.timeOffset === "number" && Number.isFinite(entry.timeOffset))),
    );
  } catch {
    return [];
  }
}

function writeQueue(entries: PendingProviderClear[], key = queueStorageKey()): void {
  try {
    if (entries.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(entries));
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

type ProviderQueueOrigin = { key: string; account: string | null };

export function queueProviderPlaybackClear(
  provider: CwProviderSource,
  id: string,
  checkpoint?: ProviderCheckpoint,
  origin?: ProviderQueueOrigin,
): void {
  if (!id) return;
  const now = Date.now();
  // A failed request must retry into the queue and account it started in, not
  // whichever profile happens to be active when the failure surfaces.
  const queueKey = origin?.key ?? queueStorageKey();
  const account = (origin ? origin.account : providerAccount(provider)) ?? undefined;
  const entries = readQueue(queueKey);
  const existing = entries.find((entry) => entry.provider === provider && entry.id === id);
  if (existing) {
    existing.nextAt = now + RETRY_BASE_MS;
    existing.addedAt = now;
    existing.attempts = 0;
    existing.op = nextOpId();
    if (account != null) existing.account = account;
    if (checkpoint?.lastWatched != null) existing.lastWatched = checkpoint.lastWatched;
    if (checkpoint?.timeOffset != null) existing.timeOffset = checkpoint.timeOffset;
  } else {
    entries.push({
      provider,
      id,
      attempts: 0,
      nextAt: now + RETRY_BASE_MS,
      addedAt: now,
      op: nextOpId(),
      ...(account != null ? { account } : {}),
      ...(checkpoint?.lastWatched != null ? { lastWatched: checkpoint.lastWatched } : {}),
      ...(checkpoint?.timeOffset != null ? { timeOffset: checkpoint.timeOffset } : {}),
    });
  }
  while (entries.length > MAX_QUEUE) entries.shift();
  writeQueue(entries, queueKey);
  if (queueKey === queueStorageKey()) scheduleQueueFlush(entries);
}

export function flushProviderDismissQueue(force = true): Promise<void> {
  if (flushInFlight) return flushInFlight;
  // Everything below belongs to the profile that started the flush; a profile
  // switch mid-flight must not redirect reads or writes to another queue.
  const queueKey = queueStorageKey();
  flushInFlight = (async () => {
    const entries = readQueue(queueKey);
    if (entries.length === 0) return;
    const now = Date.now();
    const due = force ? entries : entries.filter((entry) => entry.nextAt <= now);
    if (due.length === 0) {
      if (queueKey === queueStorageKey()) scheduleQueueFlush(entries);
      else scheduleQueueFlush();
      return;
    }
    const keyOf = (entry: PendingProviderClear) => `${entry.provider}|${entry.id}`;
    const snapshot = new Map(due.map((entry) => [keyOf(entry), entry]));
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
    // Deleting against a session that changed during the flush would target a
    // different account with ids that belong to the old one.
    const sessions = new Map<CwProviderSource, unknown>();
    for (const entry of due) {
      if (!sessions.has(entry.provider))
        sessions.set(entry.provider, providerSession(entry.provider));
    }
    for (const entry of due) {
      const key = keyOf(entry);
      const session = sessions.get(entry.provider);
      if (session == null || providerSession(entry.provider) !== session) {
        defer(key, entry);
        continue;
      }
      // A clear queued under another account must not touch this account's ids.
      // When the current account cannot be identified, hold the entry instead.
      const account = providerAccount(entry.provider);
      if (entry.account != null) {
        if (account == null) {
          defer(key, entry);
          continue;
        }
        if (entry.account !== account) {
          cleared.add(key);
          continue;
        }
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
      if (providerSession(entry.provider) !== session) {
        defer(key, entry);
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
    const next = readQueue(queueKey).flatMap((entry) => {
      const key = keyOf(entry);
      const processed = snapshot.get(key);
      if (!processed) return [entry];
      // Re-queued during the flush: the newer request (its own checkpoint and
      // backoff) owns the key now. A revision, not a timestamp, tells them apart.
      if (entry.op !== processed.op) return [entry];
      if (cleared.has(key)) return [];
      return [failed.get(key) ?? entry];
    });
    writeQueue(next, queueKey);
    if (queueKey === queueStorageKey()) {
      scheduleQueueFlush(next);
    } else {
      // The user switched profiles while this flush ran. Arm the queue that is
      // active now, or its retries wait for the next foreground event.
      scheduleQueueFlush();
    }
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

function sharesContent(a: LibraryItem, b: LibraryItem): boolean {
  const ids = new Set([a._id, ...(a.altIds ?? [])]);
  return ids.has(b._id) || (b.altIds ?? []).some((id) => ids.has(id));
}

function itemEpisode(item: LibraryItem): { season: number; episode: number } | null {
  const season = item.state?.season;
  const episode = item.state?.episode;
  if (season != null && episode != null) return { season, episode };
  const videoId = item.state?.video_id ?? "";
  // Native anime stream ids are `scheme:entry:episode`; the middle segment is
  // the entry, not a season, so `episodeFromVideoId` must not parse them.
  const native = /^(?:kitsu|mal|anilist|anidb):\d+:(\d+)$/.exec(videoId);
  if (native) {
    const number = Number(native[1]);
    return number > 0 ? { season: 1, episode: number } : null;
  }
  return episodeFromVideoId(videoId);
}

function sameCheckpoint(a: LibraryItem, b: LibraryItem): boolean {
  const aEp = itemEpisode(a);
  const bEp = itemEpisode(b);
  // Deleting a provider resume point is irreversible. An episodic card must name
  // the episode it represents; a missing coordinate (including on the card
  // compared with itself) means the id must go through the verified lookup.
  if (!aEp || !bEp) return a.type === "movie" && b.type === "movie" && !aEp && !bEp;
  return aEp.season === bEp.season && aEp.episode === bEp.episode;
}

/** Session identity captured when a flush starts, so a switch cannot redirect deletes. */
function providerSession(provider: CwProviderSource): unknown {
  if (provider === "trakt") return getTraktSession() ?? null;
  if (provider === "simkl") return getSimklSession() ?? null;
  return getPmdbSession() ?? null;
}

/**
 * Account name that owns a playback id. Used to prove a queued clear still
 * belongs to the connected account; null when the provider never reported one.
 */
function providerAccount(provider: CwProviderSource): string | null {
  if (provider === "trakt") return getTraktSession()?.username || null;
  if (provider === "simkl") return getSimklSession()?.username || null;
  return getPmdbSession()?.username || null;
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
 *
 * The caller's stored playback id is deliberately not used: up-next advancement
 * rewrites a card's episode while keeping the id it was imported with, so a
 * stored id can belong to an older episode. The provider's own fresh list is the
 * only proof of which episode an id names.
 */
export async function clearProviderPlayback(
  item: LibraryItem,
  providers: readonly CwProviderSource[],
): Promise<ProviderDismissResult> {
  const profileId = activeProfileId();
  const queueKey = queueStorageKey();
  const failed = await Promise.all(
    providers.map(async (provider): Promise<CwProviderSource | null> => {
      // Nothing to clear for a provider that is not connected; not a failure.
      const session = providerSession(provider);
      if (session == null) return null;
      const origin: ProviderQueueOrigin = { key: queueKey, account: providerAccount(provider) };
      const clear = async (id: string, checkpoint?: ProviderCheckpoint): Promise<boolean> => {
        let cleared = false;
        try {
          cleared = await withTimeout(deleteProviderPlayback(provider, id));
        } catch {
          cleared = false;
        }
        if (!cleared) queueProviderPlaybackClear(provider, id, checkpoint, origin);
        return cleared;
      };
      try {
        const items = await withTimeout(fetchProviderItems(provider, true));
        // Content ids prove the title; the candidate's episode must still match
        // the displayed card. A grouped member may supply an alias, but never
        // its own older episode.
        const match = items.find(
          (entry) =>
            sameCheckpoint(item, entry) &&
            (sharesContent(item, entry) ||
              item.cwMembers?.some((member) => sharesContent(member, entry))),
        );
        const found = match?.providerPlaybackIds?.[provider];
        if (!match || !found) return null;
        // The lookup ran against a session/profile that may no longer be current.
        // Do not delete into an account this result was not looked up in.
        if (activeProfileId() !== profileId || providerSession(provider) !== session) {
          return provider;
        }
        return (await clear(found, checkpointFromItem(match))) ? null : provider;
      } catch {
        return provider;
      }
    }),
  );

  return {
    failed: [...new Set(failed.filter((value): value is CwProviderSource => value !== null))],
  };
}
