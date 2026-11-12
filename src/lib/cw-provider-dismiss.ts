import { activeProfileId } from "@/lib/active-profile-id";
import { episodeFromVideoId, type LibraryItem } from "@/lib/stremio";
import { deleteSimklPlayback, fetchSimklPlaybackSnapshot } from "@/lib/simkl/playback";
import { isSimklBlocked } from "@/lib/simkl/client";
import {
  getSession as getSimklSession,
  subscribeSession as subscribeSimklSession,
} from "@/lib/simkl/session";
import { deleteTraktPlayback, fetchTraktPlaybackSnapshot } from "@/lib/trakt/playback";
import {
  getSession as getTraktSession,
  subscribeSession as subscribeTraktSession,
} from "@/lib/trakt/session";
import { fetchPublicMetaDbPlaybackSnapshot } from "@/lib/publicmetadb/playback";
import { pmdbDeleteResumeOutcome } from "@/lib/publicmetadb/scrobble";
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

type QueueMediaType = "series" | "movie";

/**
 * The identity a queued clear was verified against. `ids` are the overlapping
 * content ids plus the matched record's primary id; no transitive aliases.
 */
type QueueMatch = {
  type: QueueMediaType;
  ids: string[];
  season?: number;
  episode?: number;
};

type PendingProviderClear = {
  provider: CwProviderSource;
  /** Required: a destructive retry never runs under an unknown account. */
  account: string;
  attempts: number;
  nextAt: number;
  addedAt: number;
  /** Unique per enqueue: tells a newer request apart from the flushed snapshot. */
  op?: string;
  /** Last known provider playback id, used to prefer the same record. */
  id?: string;
  match: QueueMatch;
  lastWatched?: number;
  timeOffset?: number;
};

export type ProviderQueueOrigin = {
  /** Queue storage key the dismissal started in. */
  key: string;
  account: string | null;
};

type ProviderSnapshot = { items: LibraryItem[]; complete: boolean };
type ProviderDeleteOutcome = { ok: boolean; retryAfterMs?: number; rateLimited?: boolean };

const QUEUE_KEY = "harbor.cw.provider-clear.v1";
const MAX_QUEUE = 100;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 30 * 60_000;
const PROVIDER_TIMEOUT_MS = 20_000;
const RETRY_AFTER_FALLBACK_MS = 5 * 60_000;
/** An unverifiable absence (incomplete or filtered list) is not retried forever. */
const QUEUE_TTL_MS = 7 * 24 * 60 * 60_000;

let queueTimer: number | null = null;
let flushInFlight: Promise<void> | null = null;
let opSeq = 0;
const providerCooldowns = new Map<CwProviderSource, number>();

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

function itemIds(item: LibraryItem): string[] {
  return [item._id, ...(item.altIds ?? [])].filter(Boolean);
}

function canonicalIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))].sort();
}

function mediaTypeOf(item: LibraryItem): QueueMediaType {
  return item.type === "movie" ? "movie" : "series";
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

function overlapIds(a: LibraryItem, b: LibraryItem): string[] {
  const ids = new Set(itemIds(b));
  return itemIds(a).filter((id) => ids.has(id));
}

/** The exact evidence a delete is authorized by: a content overlap with the
 * matched record, its primary id, and that record's episode. */
function verifiedMatch(source: LibraryItem, record: LibraryItem): QueueMatch | null {
  const overlap = overlapIds(source, record);
  if (overlap.length === 0) return null;
  const type = mediaTypeOf(record);
  const ids = canonicalIds([...overlap, record._id]);
  if (type === "movie") return { type, ids };
  const coords = itemEpisode(record);
  if (!coords) return null;
  return { type, ids, season: coords.season, episode: coords.episode };
}

function matchFromCard(card: LibraryItem, record: LibraryItem): QueueMatch | null {
  for (const source of [card, ...(card.cwMembers ?? [])]) {
    const match = verifiedMatch(source, record);
    if (match) return match;
  }
  return null;
}

/** Identity gathered from the card alone, for a lookup that could not run. */
function cardMatch(card: LibraryItem): QueueMatch | null {
  const type = mediaTypeOf(card);
  const ids = canonicalIds(itemIds(card));
  if (ids.length === 0) return null;
  if (type === "movie") return { type, ids };
  const coords = itemEpisode(card);
  if (!coords) return null;
  return { type, ids, season: coords.season, episode: coords.episode };
}

function matchCheckpoint(match: QueueMatch, record: LibraryItem): boolean {
  if (mediaTypeOf(record) !== match.type) return false;
  const ids = new Set(itemIds(record));
  if (!match.ids.some((id) => ids.has(id))) return false;
  if (match.type === "movie") return true;
  const coords = itemEpisode(record);
  return coords != null && coords.season === match.season && coords.episode === match.episode;
}

function cardMatches(card: LibraryItem, record: LibraryItem): boolean {
  if (mediaTypeOf(card) !== mediaTypeOf(record)) return false;
  const content =
    overlapIds(card, record).length > 0 ||
    (card.cwMembers ?? []).some((member) => overlapIds(member, record).length > 0);
  if (!content) return false;
  if (mediaTypeOf(card) === "movie") return true;
  const cardCoords = itemEpisode(card);
  const recordCoords = itemEpisode(record);
  return (
    cardCoords != null &&
    recordCoords != null &&
    cardCoords.season === recordCoords.season &&
    cardCoords.episode === recordCoords.episode
  );
}

function queueKeyOf(provider: CwProviderSource, account: string, match: QueueMatch): string {
  return `${provider}|${account}|${match.type}|${match.ids.join(",")}|${match.season ?? "?"}:${match.episode ?? "?"}`;
}

function isQueueMatch(value: unknown): value is QueueMatch {
  if (!value || typeof value !== "object") return false;
  const match = value as Partial<QueueMatch>;
  if (match.type !== "movie" && match.type !== "series") return false;
  if (!Array.isArray(match.ids) || match.ids.length === 0) return false;
  if (!match.ids.every((id) => typeof id === "string" && id.length > 0)) return false;
  if (match.season != null && (typeof match.season !== "number" || !Number.isFinite(match.season)))
    return false;
  if (
    match.episode != null &&
    (typeof match.episode !== "number" || !Number.isFinite(match.episode))
  )
    return false;
  return true;
}

function readQueue(key = queueStorageKey()): PendingProviderClear[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PendingProviderClear =>
        entry != null &&
        CW_PROVIDER_SOURCES.includes(entry.provider) &&
        typeof entry.account === "string" &&
        entry.account.length > 0 &&
        isQueueMatch(entry.match) &&
        (entry.id == null || (typeof entry.id === "string" && entry.id.length > 0)) &&
        typeof entry.attempts === "number" &&
        Number.isFinite(entry.attempts) &&
        typeof entry.nextAt === "number" &&
        Number.isFinite(entry.nextAt) &&
        typeof entry.addedAt === "number" &&
        Number.isFinite(entry.addedAt) &&
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

/** Drop entries that cannot be verified (legacy id-only, unknown account) without deleting. */
function pruneQueue(key: string): void {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(raw)) return;
    const valid = readQueue(key);
    if (valid.length !== raw.length) writeQueue(valid, key);
  } catch {}
}

function cooldownUntil(provider: CwProviderSource): number {
  const until = providerCooldowns.get(provider) ?? 0;
  if (until <= Date.now()) providerCooldowns.delete(provider);
  return until;
}

function noteProviderFailure(
  provider: CwProviderSource,
  retryAfterMs?: number,
  rateLimited?: boolean,
): void {
  // A rate limit without a usable Retry-After still needs the fallback cooldown.
  const delay = retryAfterMs ?? (rateLimited ? RETRY_AFTER_FALLBACK_MS : undefined);
  if (delay == null) return;
  const until = Math.max(Date.now() + delay, providerCooldowns.get(provider) ?? 0);
  providerCooldowns.set(provider, until);
}

function isRateLimitedError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 429 || status === 412;
}

function retryAfterFromError(error: unknown): number | undefined {
  const retryAt = (error as { retryAt?: unknown } | null)?.retryAt;
  return typeof retryAt === "number" && Number.isFinite(retryAt)
    ? Math.max(0, retryAt - Date.now())
    : undefined;
}

function isSessionChanged(error: unknown): boolean {
  return error instanceof Error && error.message === "SIMKL session changed";
}

function scheduleQueueFlush(entries = readQueue()): void {
  if (typeof window === "undefined") return;
  if (queueTimer != null) {
    window.clearTimeout(queueTimer);
    queueTimer = null;
  }
  if (entries.length === 0) return;
  const nextAt = Math.min(
    ...entries.map((entry) => Math.max(entry.nextAt, cooldownUntil(entry.provider))),
  );
  queueTimer = window.setTimeout(
    () => {
      queueTimer = null;
      void flushProviderDismissQueue(false);
    },
    Math.max(1_000, nextAt - Date.now()),
  );
}

/** Re-arm the active profile's queue after a flush that outlived its owner. */
function scheduleActiveQueue(queueKey: string, entries: PendingProviderClear[]): void {
  if (queueKey === queueStorageKey()) scheduleQueueFlush(entries);
  else scheduleQueueFlush();
}

function hold(entry: PendingProviderClear, until: number): PendingProviderClear {
  return { ...entry, nextAt: Math.max(entry.nextAt, until) };
}

function deferEntry(entry: PendingProviderClear, retryAfterMs?: number): PendingProviderClear {
  const attempts = entry.attempts + 1;
  const backoff = Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_MAX_MS);
  return {
    ...entry,
    attempts,
    nextAt: Date.now() + Math.max(backoff, retryAfterMs ?? 0),
  };
}

function enqueueClear(
  provider: CwProviderSource,
  fields: {
    id?: string;
    match: QueueMatch;
    checkpoint?: ProviderCheckpoint;
    origin: ProviderQueueOrigin;
    retryAfterMs?: number;
  },
): void {
  const { origin } = fields;
  // Fail closed: a destructive retry without a verified account is never queued.
  if (!origin.account) return;
  const now = Date.now();
  const entries = readQueue(origin.key);
  const key = queueKeyOf(provider, origin.account, fields.match);
  const existing = entries.find(
    (entry) => queueKeyOf(entry.provider, entry.account, entry.match) === key,
  );
  const nextAt = now + Math.max(RETRY_BASE_MS, fields.retryAfterMs ?? 0);
  if (existing) {
    existing.nextAt = nextAt;
    existing.addedAt = now;
    existing.attempts = 0;
    existing.op = nextOpId();
    if (fields.id) existing.id = fields.id;
    if (fields.checkpoint?.lastWatched != null)
      existing.lastWatched = fields.checkpoint.lastWatched;
    if (fields.checkpoint?.timeOffset != null) existing.timeOffset = fields.checkpoint.timeOffset;
  } else {
    entries.push({
      provider,
      account: origin.account,
      attempts: 0,
      nextAt,
      addedAt: now,
      op: nextOpId(),
      ...(fields.id ? { id: fields.id } : {}),
      match: fields.match,
      ...(fields.checkpoint?.lastWatched != null
        ? { lastWatched: fields.checkpoint.lastWatched }
        : {}),
      ...(fields.checkpoint?.timeOffset != null
        ? { timeOffset: fields.checkpoint.timeOffset }
        : {}),
    });
  }
  while (entries.length > MAX_QUEUE) entries.shift();
  writeQueue(entries, origin.key);
  if (origin.key === queueStorageKey()) scheduleQueueFlush(entries);
}

/** Queue a retry for a record whose provider playback id is known. */
export function queueProviderPlaybackClear(
  provider: CwProviderSource,
  id: string,
  match: QueueMatch,
  checkpoint: ProviderCheckpoint | undefined,
  origin: ProviderQueueOrigin,
  retryAfterMs?: number,
): void {
  enqueueClear(provider, { id, match, checkpoint, origin, retryAfterMs });
}

/** Queue a retry for a dismissal whose provider record could not be inspected. */
export function queueProviderDiscovery(
  provider: CwProviderSource,
  match: QueueMatch,
  checkpoint: ProviderCheckpoint | undefined,
  origin: ProviderQueueOrigin,
  retryAfterMs?: number,
): void {
  enqueueClear(provider, { match, checkpoint, origin, retryAfterMs });
}

function providerSession(provider: CwProviderSource): unknown {
  if (provider === "trakt") return getTraktSession() ?? null;
  if (provider === "simkl") return getSimklSession() ?? null;
  return getPmdbSession() ?? null;
}

/** Stable account name that must own a queued playback id. */
function providerAccount(provider: CwProviderSource): string | null {
  if (provider === "trakt") return getTraktSession()?.username || null;
  if (provider === "simkl") return getSimklSession()?.username || null;
  return getPmdbSession()?.username || null;
}

function providerSnapshot(provider: CwProviderSource): Promise<ProviderSnapshot> {
  if (provider === "trakt") return fetchTraktPlaybackSnapshot();
  if (provider === "simkl") return fetchSimklPlaybackSnapshot();
  return fetchPublicMetaDbPlaybackSnapshot();
}

function providerDelete(provider: CwProviderSource, id: string): Promise<ProviderDeleteOutcome> {
  if (provider === "trakt") return deleteTraktPlayback(id);
  if (provider === "simkl") return deleteSimklPlayback(id);
  return pmdbDeleteResumeOutcome(id);
}

function checkpointFromItem(item: LibraryItem): ProviderCheckpoint {
  const lastWatched = Date.parse(item.state?.lastWatched ?? "");
  return {
    ...(Number.isFinite(lastWatched) && lastWatched > 0 ? { lastWatched } : {}),
    ...(typeof item.state?.timeOffset === "number" ? { timeOffset: item.state.timeOffset } : {}),
  };
}

export function flushProviderDismissQueue(force = true): Promise<void> {
  if (flushInFlight) return flushInFlight;
  // Everything below belongs to the profile that started the flush; a profile
  // switch mid-flight must not redirect reads or writes to another queue.
  const queueKey = queueStorageKey();
  flushInFlight = (async () => {
    pruneQueue(queueKey);
    const entries = readQueue(queueKey);
    if (entries.length === 0) return;
    const now = Date.now();
    const due = force ? entries : entries.filter((entry) => entry.nextAt <= now);
    if (due.length === 0) {
      scheduleActiveQueue(queueKey, entries);
      return;
    }

    const snapshotState = new Map<
      string,
      {
        snapshot?: ProviderSnapshot;
        error?: unknown;
        account: string;
        session: unknown;
      }
    >();
    const deleteState = new Map<
      string,
      {
        session: unknown;
        promise?: Promise<ProviderDeleteOutcome>;
        outcome?: ProviderDeleteOutcome;
      }
    >();
    const snapshotMap = new Map(
      due.map((entry) => [queueKeyOf(entry.provider, entry.account, entry.match), entry]),
    );
    const cleared = new Set<string>();
    const failed = new Map<string, PendingProviderClear>();

    const loadSnapshot = async (
      provider: CwProviderSource,
      account: string,
      session: unknown,
    ): Promise<{ snapshot?: ProviderSnapshot; error?: unknown }> => {
      const cacheKey = `${provider}|${account}`;
      const held = snapshotState.get(cacheKey);
      // Never reuse a snapshot fetched under another account, or under a
      // session that has since been replaced.
      if (held && held.session === session) return held;
      let result: { snapshot?: ProviderSnapshot; error?: unknown };
      try {
        result = { snapshot: await withTimeout(providerSnapshot(provider)) };
      } catch (error) {
        result = { error };
      }
      snapshotState.set(cacheKey, { ...result, account, session });
      if (result.error && !isSessionChanged(result.error)) {
        noteProviderFailure(
          provider,
          retryAfterFromError(result.error),
          isRateLimitedError(result.error),
        );
      }
      return result;
    };

    for (const entry of due) {
      const key = queueKeyOf(entry.provider, entry.account, entry.match);
      if (queueStorageKey() !== queueKey) {
        failed.set(key, hold(entry, Date.now() + RETRY_MAX_MS));
        continue;
      }
      if (providerAccount(entry.provider) !== entry.account) {
        failed.set(key, hold(entry, Date.now() + RETRY_MAX_MS));
        continue;
      }
      const session = providerSession(entry.provider);
      if (session == null) {
        failed.set(key, hold(entry, Date.now() + RETRY_MAX_MS));
        continue;
      }
      const cooling = Math.max(
        cooldownUntil(entry.provider),
        entry.provider === "simkl" && isSimklBlocked() ? Date.now() + RETRY_AFTER_FALLBACK_MS : 0,
      );
      if (cooling > Date.now()) {
        failed.set(key, hold(entry, cooling));
        continue;
      }

      const loaded = await loadSnapshot(entry.provider, entry.account, session);
      if (providerSession(entry.provider) !== session) {
        failed.set(key, hold(entry, Date.now() + RETRY_MAX_MS));
        continue;
      }
      if (!loaded.snapshot) {
        failed.set(
          key,
          isSessionChanged(loaded.error)
            ? hold(entry, Date.now() + RETRY_MAX_MS)
            : deferEntry(entry, retryAfterFromError(loaded.error)),
        );
        continue;
      }
      const snapshot = loaded.snapshot;

      const candidates = snapshot.items.filter((record) => matchCheckpoint(entry.match, record));
      if (candidates.length === 0) {
        // A truncated or filtered list cannot prove the record is gone, so the
        // retry waits; it expires instead of retrying forever.
        if (snapshot.complete || Date.now() - entry.addedAt > QUEUE_TTL_MS) cleared.add(key);
        else failed.set(key, deferEntry(entry));
        continue;
      }
      const preferred = candidates.find(
        (record) => record.providerPlaybackIds?.[entry.provider] === entry.id,
      );
      const ordered = preferred
        ? [preferred, ...candidates.filter((record) => record !== preferred)]
        : candidates;
      let failure: ProviderDeleteOutcome | null = null;
      let aborted = false;
      for (const candidate of ordered) {
        const playbackId = candidate.providerPlaybackIds?.[entry.provider];
        if (!playbackId) continue;
        const remoteAt = Date.parse(candidate.state?.lastWatched ?? "") || 0;
        const baseline = entry.lastWatched ?? entry.addedAt;
        const remoteOffset = candidate.state?.timeOffset;
        const resumed =
          remoteAt > baseline + 1_000 ||
          (entry.timeOffset != null &&
            remoteOffset != null &&
            remoteOffset > entry.timeOffset + 1_000);
        if (resumed) continue; // newer progress on this record: leave it alone
        // Revalidate once more immediately before the delete: profile, account,
        // session and the candidate's identity can all change during a fetch.
        if (
          queueStorageKey() !== queueKey ||
          providerAccount(entry.provider) !== entry.account ||
          providerSession(entry.provider) !== session ||
          !matchCheckpoint(entry.match, candidate)
        ) {
          aborted = true;
          break;
        }
        const deleteKey = `${entry.account}|${entry.provider}|${playbackId}`;
        let state = deleteState.get(deleteKey);
        // A replacement session of the same account must issue its own DELETE.
        if (!state || state.session !== session) {
          state = { session };
          state.promise = withTimeout(providerDelete(entry.provider, playbackId)).catch(
            (): ProviderDeleteOutcome => ({ ok: false }),
          );
          deleteState.set(deleteKey, state);
        }
        const outcome = state.outcome ?? (state.outcome = await state.promise!);
        if (!outcome.ok) {
          failure = outcome;
          break;
        }
      }
      if (aborted) {
        failed.set(key, hold(entry, Date.now() + RETRY_MAX_MS));
      } else if (failure) {
        noteProviderFailure(entry.provider, failure.retryAfterMs, failure.rateLimited);
        failed.set(key, deferEntry(entry, failure.retryAfterMs));
      } else {
        // Every matching record was deleted, or had newer progress.
        cleared.add(key);
      }
    }

    // A dismissal can enqueue another clear while these requests are in flight.
    // Keep those newer entries instead of overwriting them with the snapshot.
    const next = readQueue(queueKey).flatMap((entry) => {
      const key = queueKeyOf(entry.provider, entry.account, entry.match);
      const processed = snapshotMap.get(key);
      if (!processed) return [entry];
      if (entry.op !== processed.op) return [entry];
      if (cleared.has(key)) return [];
      return [failed.get(key) ?? entry];
    });
    writeQueue(next, queueKey);
    scheduleActiveQueue(queueKey, next);
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
    if (document.visibilityState === "visible") void flushProviderDismissQueue(false);
  });
  subscribeTraktSession(() => void flushProviderDismissQueue());
  subscribeSimklSession(() => void flushProviderDismissQueue());
  subscribePmdbSession(() => void flushProviderDismissQueue());
}

/**
 * Delete only saved playback/resume positions. Never touch watch history or
 * watchlist status. Every delete is authorized by a record from the provider's
 * own fresh list whose content ids and episode match the displayed card; a
 * stored playback id is never used on its own.
 */
export async function clearProviderPlayback(
  item: LibraryItem,
  providers: readonly CwProviderSource[],
): Promise<ProviderDismissResult> {
  const profileId = activeProfileId();
  const queueKey = queueStorageKey();
  const fallbackMatch = cardMatch(item);
  const failed = await Promise.all(
    providers.map(async (provider): Promise<CwProviderSource | null> => {
      const session = providerSession(provider);
      if (session == null) return null;
      const account = providerAccount(provider);
      const origin: ProviderQueueOrigin = { key: queueKey, account };
      let snapshot: ProviderSnapshot;
      try {
        snapshot = await withTimeout(providerSnapshot(provider));
      } catch (error) {
        if (isSessionChanged(error)) return provider;
        const retryDelay =
          retryAfterFromError(error) ??
          (isRateLimitedError(error) ? RETRY_AFTER_FALLBACK_MS : undefined);
        if (retryDelay != null) noteProviderFailure(provider, retryDelay);
        if (origin.account && fallbackMatch) {
          queueProviderDiscovery(provider, fallbackMatch, undefined, origin, retryDelay);
        }
        return provider;
      }
      const candidates = snapshot.items.filter((record) => cardMatches(item, record));
      if (candidates.length === 0) {
        // A truncated or filtered list cannot prove the record is gone.
        if (!snapshot.complete && origin.account && fallbackMatch) {
          queueProviderDiscovery(provider, fallbackMatch, undefined, origin);
        }
        return null;
      }
      const preferred = candidates.find(
        (record) => record.providerPlaybackIds?.[provider] === item.providerPlaybackIds?.[provider],
      );
      const ordered = preferred
        ? [preferred, ...candidates.filter((record) => record !== preferred)]
        : candidates;
      for (const candidate of ordered) {
        const playbackId = candidate.providerPlaybackIds?.[provider];
        if (!playbackId) continue;
        // The lookup ran against a session/profile that may no longer be current.
        if (
          activeProfileId() !== profileId ||
          providerAccount(provider) !== account ||
          providerSession(provider) !== session ||
          !cardMatches(item, candidate)
        ) {
          return provider;
        }
        const outcome = await withTimeout(providerDelete(provider, playbackId)).catch(
          (): ProviderDeleteOutcome => ({ ok: false }),
        );
        if (outcome.ok) continue;
        const retryDelay =
          outcome.retryAfterMs ?? (outcome.rateLimited ? RETRY_AFTER_FALLBACK_MS : undefined);
        if (retryDelay != null) noteProviderFailure(provider, retryDelay);
        const match = matchFromCard(item, candidate);
        if (origin.account && match) {
          queueProviderPlaybackClear(
            provider,
            playbackId,
            match,
            checkpointFromItem(candidate),
            origin,
            retryDelay,
          );
        }
        return provider;
      }
      return null;
    }),
  );

  return {
    failed: [...new Set(failed.filter((value): value is CwProviderSource => value !== null))],
  };
}
