/**
 * Nuvio Cloud Synchronization Service
 * Handles strictly profile-isolated Watch Progress, Watched Items, and Addons sync.
 */

import {
  getNuvioProfileIndexForHarborProfile,
  getNuvioAccountId,
  getOrCreateSyncClientId,
  isNuvioSignedIn,
  loadNuvioState,
  nuvioFetch,
  saveNuvioState,
} from "./nuvio-client";
import type { NuvioAddonItem, NuvioWatchProgress, NuvioWatchedItem } from "./nuvio-types";
import { reconcileNuvioWatchedFlags, setWatchedFlag } from "@/lib/watched-flag";
import { reconcileNuvioMovieWatched, setMovieWatchedLocal } from "@/lib/movie-watched";
import { reconcileNuvioWatchedEpisodes } from "@/lib/manual-watched";
import {
  clearLocalCw,
  clearLocalCwBatch,
  listLocalCw,
  localCwEntry,
  saveLocalCw,
} from "@/lib/local-cw";
import { clearResume, clearResumeBatch, createResumeReader } from "@/lib/resume";
import { persistCritical } from "@/lib/storage-recovery";
import {
  isNuvioProviderActive,
  getNuvioActiveSlot,
  nuvioWatchedScope,
} from "@/lib/active-profile-id";
import {
  readCachedNuvioPlaybackItems,
  writeCachedNuvioPlaybackItems,
  buildNuvioPlaybackItems,
} from "./nuvio-playback";
import { readCachedNuvioLibrary } from "./nuvio-library";
import { meta as fetchMeta } from "@/lib/cinemeta";
import type { Addon } from "@/lib/addons";
import { fetchManifestAt } from "@/lib/addon-store";
import { recordNuvioAddons } from "./nuvio-addon-registry";
import { expungeLeachedNuvioItemsFromStremio } from "@/lib/stremio";
import { undismissCw } from "@/lib/cw-dismiss";
import { loadStoredSettings } from "@/lib/settings/load";
import { tmdbDetails } from "@/lib/providers/tmdb/tmdb-details";
import { parseTmdbTvId, fetchSeasonEpisodes } from "@/lib/series-episodes";

export { isNuvioProviderActive };

/**
 * Resolves the effective Nuvio profile index (1..6) considering active provider setting.
 */
/**
 * Resolves the effective Nuvio profile index for addon operations.
 * If this profile has uses_primary_addons set to true (the default for secondary profiles),
 * it returns slot 1 (Primary). If uses_primary_addons is false, it maintains its own slot (e.g. 2..6).
 */
export function resolveEffectiveNuvioAddonSlot(harborProfileId?: string | number): number {
  const slot = resolveNuvioProfileIndex(harborProfileId);
  if (slot === 1) return 1;
  const state = loadNuvioState();
  const profile = state.profiles.find((p) => p.profile_index === slot);
  if (profile && profile.uses_primary_addons !== false) {
    return 1;
  }
  return slot;
}

export function resolveNuvioProfileIndex(harborProfileId?: string | number): number {
  if (typeof harborProfileId === "number") {
    if (Number.isInteger(harborProfileId) && harborProfileId >= 1 && harborProfileId <= 6)
      return harborProfileId;
    if (harborProfileId === 0) return 1;
  }
  if (typeof harborProfileId === "string") {
    const num = parseInt(harborProfileId, 10);
    if (!isNaN(num) && num >= 1 && num <= 6 && String(num) === harborProfileId) {
      return num;
    }
    if (harborProfileId === "0") {
      return 1;
    }
    if (harborProfileId.startsWith("nuvio-")) {
      const idx = parseInt(harborProfileId.replace("nuvio-", ""), 10);
      if (idx >= 1 && idx <= 6) return idx;
    }
  }
  if (isNuvioProviderActive()) {
    return getNuvioActiveSlot();
  }
  if (typeof harborProfileId === "string" && harborProfileId) {
    return getNuvioProfileIndexForHarborProfile(harborProfileId);
  }
  return getNuvioActiveSlot();
}

const WATCH_PROGRESS_CACHE_PREFIX = "harbor.nuvio.watch_progress.";
// Full-table snapshots are the only way to confirm remote deletions, but they
// are also the most expensive path. Routine pulls use the RPC batch; a full
// snapshot is forced by a pending mutation or by this interval.
const FULL_SYNC_INTERVAL_MS = 2 * 60_000;
const lastFullSyncAt = new Map<string, number>();

type NuvioCoordinate = { content_id: string; season?: number | null; episode?: number | null };
type PendingChange = {
  token: string;
  kind: "progress" | "watched";
  row: NuvioWatchProgress | NuvioWatchedItem;
  deleted: boolean;
  /** When a delete was queued. Older remote rows may be removed; newer ones win. */
  deletedAt?: number;
  except?: string[];
};
type PendingChanges = Record<string, PendingChange>;

function coordinate(row: NuvioCoordinate): string {
  return JSON.stringify([row.content_id, row.season ?? null, row.episode ?? null]);
}

function pendingKey(slot: number, accountId: string): string {
  return `harbor.nuvio.pending-sync.v1.${accountId}.slot.${slot}`;
}

function readPending(slot: number, accountId: string): PendingChanges {
  try {
    const value = JSON.parse(localStorage.getItem(pendingKey(slot, accountId)) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([key, raw]) => {
        const change = raw as PendingChange;
        if (
          !change ||
          typeof change.token !== "string" ||
          (change.kind !== "progress" && change.kind !== "watched") ||
          typeof change.deleted !== "boolean" ||
          (change.deletedAt != null &&
            (!Number.isFinite(change.deletedAt) || change.deletedAt < 0)) ||
          !validRow(change.row, slot, accountId) ||
          key !== `${change.kind}:${coordinate(change.row)}` ||
          (change.except != null &&
            (!Array.isArray(change.except) ||
              change.except.some((item) => typeof item !== "string")))
        )
          return false;
        if (!change.deleted && change.kind === "progress") {
          const row = change.row as NuvioWatchProgress;
          return (
            typeof row.progress_key === "string" &&
            Number.isFinite(row.progress_seconds) &&
            Number.isFinite(row.duration_seconds) &&
            row.progress_seconds >= 0 &&
            row.duration_seconds >= 0
          );
        }
        return true;
      }),
    ) as PendingChanges;
  } catch {
    return {};
  }
}

function recordPending(
  slot: number,
  accountId: string,
  kind: PendingChange["kind"],
  rows: Array<NuvioWatchProgress | NuvioWatchedItem>,
  deleted = false,
): PendingChanges {
  const changes = readPending(slot, accountId);
  const token = crypto.randomUUID();
  const deletedAt = deleted ? Date.now() : undefined;
  for (const row of rows) {
    // A title-wide deletion supersedes older per-episode actions for that title.
    if (deleted && row.season == null && row.episode == null) {
      for (const [key, held] of Object.entries(changes)) {
        if (held.kind === kind && held.row.content_id === row.content_id) delete changes[key];
      }
    }
    if (!deleted && row.season != null && row.episode != null) {
      for (const held of Object.values(changes)) {
        if (
          held.kind === kind &&
          held.deleted &&
          held.row.content_id === row.content_id &&
          held.row.season == null &&
          held.row.episode == null
        ) {
          held.except = [...new Set([...(held.except ?? []), coordinate(row)])];
          held.token = crypto.randomUUID();
        }
      }
    }
    changes[`${kind}:${coordinate(row)}`] = {
      token,
      kind,
      row,
      deleted,
      ...(deletedAt != null ? { deletedAt } : {}),
    };
  }
  persistCritical(pendingKey(slot, accountId), JSON.stringify(changes));
  window.dispatchEvent(new CustomEvent("harbor:nuvio-mutations-pending"));
  return Object.fromEntries(Object.entries(changes).filter(([, change]) => change.token === token));
}

function matchesChange(row: NuvioCoordinate, change: PendingChange): boolean {
  return (
    row.content_id === change.row.content_id &&
    !change.except?.includes(coordinate(row)) &&
    ((change.deleted && change.row.season == null && change.row.episode == null) ||
      coordinate(row) === coordinate(change.row))
  );
}

function applyPending<T extends NuvioCoordinate>(
  rows: T[],
  slot: number,
  accountId: string,
  kind: PendingChange["kind"],
  complete: boolean,
  atStart: PendingChanges,
): { items: T[]; deleted: PendingChange[] } {
  const current = readPending(slot, accountId);
  const deleted: PendingChange[] = [];
  const exact = new Map(rows.map((row) => [coordinate(row), row]));
  const byContent = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = byContent.get(row.content_id) ?? [];
    bucket.push(row);
    byContent.set(row.content_id, bucket);
  }
  const removed = new Set<string>();
  const added = new Map<string, T>();
  let changed = false;
  for (const [key, change] of Object.entries(current)) {
    if (!change?.row?.content_id || change.kind !== kind) continue;
    const exactHit = exact.get(coordinate(change.row));
    const candidates =
      change.deleted && change.row.season == null && change.row.episode == null
        ? (byContent.get(change.row.content_id) ?? [])
        : exactHit
          ? [exactHit]
          : [];
    let blocked = candidates.filter((row) => matchesChange(row, change));
    const rowTime = (row: NuvioCoordinate) => pendingRowTime(kind, row);
    if (change.deleted) {
      // A delete must not erase a row another device wrote after it was queued.
      // Keep those coordinates as exceptions so the eventual replay removes
      // only the rows that existed when the user asked to delete.
      const deletedAt = change.deletedAt ?? -1;
      const newer = blocked.filter((row) => rowTime(row) > deletedAt);
      if (newer.length) {
        const except = new Set(change.except ?? []);
        const previousSize = except.size;
        for (const row of newer) except.add(coordinate(row));
        if (except.size !== previousSize) {
          change.except = [...except];
          // Invalidate any request already holding the previous exception set.
          change.token = crypto.randomUUID();
          changed = true;
        }
        blocked = blocked.filter((row) => rowTime(row) <= deletedAt);
      }
    }
    const hit = blocked[0];
    const confirmed = change.deleted
      ? complete && !hit
      : hit &&
        (rowTime(hit) > rowTime(change.row) ||
          (rowTime(hit) === rowTime(change.row) &&
            (kind !== "progress" ||
              ((hit as unknown as NuvioWatchProgress).progress_seconds ===
                (change.row as NuvioWatchProgress).progress_seconds &&
                (hit as unknown as NuvioWatchProgress).duration_seconds ===
                  (change.row as NuvioWatchProgress).duration_seconds))));
    // Only a later read may acknowledge this exact mutation. An older request
    // cannot erase a replacement recorded while awaiting its response.
    if (atStart[key]?.token === change.token && confirmed) {
      delete current[key];
      changed = true;
      continue;
    }
    for (const row of blocked) removed.add(coordinate(row));
    if (change.deleted) deleted.push(change);
    else added.set(coordinate(change.row), change.row as T);
  }
  if (changed) persistCritical(pendingKey(slot, accountId), JSON.stringify(current));
  const items =
    removed.size || added.size
      ? [
          ...rows.filter((row) => !removed.has(coordinate(row)) && !added.has(coordinate(row))),
          ...added.values(),
        ]
      : rows;
  return { items, deleted };
}

const mutationLanes = new Map<string, Promise<boolean>>();

function mutationOwnerCurrent(slot: number, accountId: string): boolean {
  return (
    isNuvioSignedIn() &&
    isNuvioProviderActive() &&
    getNuvioAccountId() === accountId &&
    getNuvioActiveSlot() === slot
  );
}

function sendRecordedChanges(
  slot: number,
  accountId: string,
  recorded: PendingChanges,
): Promise<boolean> {
  const owner = `${accountId}:${slot}`;
  const previous = mutationLanes.get(owner) ?? Promise.resolve(true);
  const work = previous
    .catch(() => false)
    .then(async () => {
      let ok = true;
      for (const [key, change] of Object.entries(recorded)) {
        const current = () =>
          mutationOwnerCurrent(slot, accountId) &&
          readPending(slot, accountId)[key]?.token === change.token;
        if (!current()) {
          ok = false;
          continue;
        }
        try {
          ok = (await sendPendingChange(slot, accountId, change, current)) && ok;
        } catch {
          ok = false;
        }
      }
      return ok;
    });
  mutationLanes.set(owner, work);
  void work.finally(() => {
    if (mutationLanes.get(owner) === work) mutationLanes.delete(owner);
  });
  return work;
}

async function sendPendingChange(
  slot: number,
  accountId: string,
  change: PendingChange,
  current: () => boolean,
): Promise<boolean> {
  const row = change.row;
  const episode = row.season != null && row.episode != null;
  const table = change.kind === "progress" ? "watch_progress" : "watched_items";
  const clientId = getOrCreateSyncClientId();
  const request = async (url: string, options: RequestInit) => {
    if (!current()) return false;
    try {
      return (await nuvioFetch(url, options, current)).ok && current();
    } catch {
      return false;
    }
  };
  const rpc = (name: string, args: Record<string, unknown>) =>
    request(`/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_profile_id: slot, ...args, p_origin_client_id: clientId }),
    });
  if (!change.deleted) {
    const progress = row as NuvioWatchProgress;
    const watched = row as NuvioWatchedItem;
    const payload =
      change.kind === "progress"
        ? {
            content_id: row.content_id,
            content_type: episode ? "series" : "movie",
            video_id: episode ? `${row.content_id}:${row.season}:${row.episode}` : row.content_id,
            season: row.season ?? null,
            episode: row.episode ?? null,
            progress_key: progress.progress_key,
            position: progress.progress_seconds * 1000,
            duration: progress.duration_seconds * 1000,
            last_watched: progress.last_watched,
          }
        : {
            content_id: row.content_id,
            content_type: watched.content_type || (episode ? "series" : "movie"),
            title: watched.title || "",
            season: row.season ?? null,
            episode: row.episode ?? null,
            watched_at: watched.watched_at,
          };
    const success = await rpc(`sync_push_${table}`, {
      [change.kind === "progress" ? "p_entries" : "p_items"]: [payload],
    });
    if (success && change.kind === "progress") return true;
    const tableSuccess = await request(`/rest/v1/${table}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ profile_id: slot, ...payload }),
    });
    return success || tableSuccess;
  }
  const serverRows = await readContentRows<NuvioCoordinate>(
    table,
    slot,
    accountId,
    row.content_id,
    row.season,
    row.episode,
    current,
  );
  if (!serverRows || !current()) return false;
  const matching = serverRows.filter((value) => matchesChange(value, change));
  const deletedAt = change.deletedAt ?? -1;
  if (matching.some((value) => pendingRowTime(change.kind, value) > deletedAt)) {
    // A row written after this delete was queued must win. The next pull records
    // it as an exception instead of letting the replay erase it.
    return true;
  }
  if (!matching.length) return true;
  const targets = matching;
  const keys = new Set<string>();
  for (const target of targets) {
    if (target.season != null && target.episode != null) {
      keys.add(`${target.content_id}_s${target.season}e${target.episode}`);
      keys.add(`${target.content_id}:${target.season}:${target.episode}`);
    } else keys.add(target.content_id);
    if (change.kind === "progress") {
      const progressKey = (target as NuvioWatchProgress).progress_key;
      if (progressKey) keys.add(progressKey);
    }
  }
  const success = await rpc(`sync_delete_${table}`, {
    p_keys:
      change.kind === "progress"
        ? [...keys]
        : targets.map((target) => ({
            content_id: target.content_id,
            season: target.season ?? null,
            episode: target.episode ?? null,
          })),
  });
  let tableSuccess = true;
  for (const target of targets) {
    let url = `/rest/v1/${table}?profile_id=eq.${slot}&content_id=eq.${encodeURIComponent(target.content_id)}`;
    if (target.season != null) url += `&season=eq.${target.season}`;
    if (target.episode != null) url += `&episode=eq.${target.episode}`;
    tableSuccess = (await request(url, { method: "DELETE" })) && tableSuccess;
  }
  return success || tableSuccess;
}

const mutationFlushes = new Map<string, Promise<boolean>>();

export function flushPendingNuvioMutations(): Promise<boolean> {
  const slot = getNuvioActiveSlot();
  const accountId = getNuvioAccountId();
  if (!accountId || !mutationOwnerCurrent(slot, accountId)) return Promise.resolve(false);
  const owner = `${accountId}:${slot}`;
  const existing = mutationFlushes.get(owner);
  if (existing) return existing;
  const work = (async () => {
    if (!Object.keys(readPending(slot, accountId)).length) return true;
    const kinds = new Set(Object.values(readPending(slot, accountId)).map((change) => change.kind));
    const confirm = async () => {
      if (!mutationOwnerCurrent(slot, accountId)) return;
      if (kinds.has("watched")) await reconcileNuvioWatched(slot);
      if (!mutationOwnerCurrent(slot, accountId)) return;
      if (kinds.has("progress")) await pullWatchProgressFromNuvio(slot);
    };
    // A newer remote checkpoint can acknowledge/supersede an older queued write.
    await confirm();
    if (!mutationOwnerCurrent(slot, accountId)) return false;
    const pending = readPending(slot, accountId);
    if (!Object.keys(pending).length) return true;
    for (const change of Object.values(pending)) kinds.add(change.kind);
    const sent = await sendRecordedChanges(slot, accountId, pending);
    if (!mutationOwnerCurrent(slot, accountId)) return false;
    if (kinds.has("watched")) lastFullSyncAt.delete(`watched:${accountId}:${slot}`);
    await confirm();
    return sent && Object.keys(readPending(slot, accountId)).length === 0;
  })();
  mutationFlushes.set(owner, work);
  void work
    .finally(() => {
      if (mutationFlushes.get(owner) === work) mutationFlushes.delete(owner);
    })
    .catch(() => {});
  return work;
}

/** One lifecycle for delivery, independent of which view is mounted. */
export function startNuvioMutationRetry(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let delay = 1000;
  let owner = "";
  const schedule = () => {
    if (timer) clearTimeout(timer);
    if (stopped) return;
    const accountId = getNuvioAccountId();
    const slot = getNuvioActiveSlot();
    if (
      !accountId ||
      !mutationOwnerCurrent(slot, accountId) ||
      !Object.keys(readPending(slot, accountId)).length
    )
      return;
    timer = setTimeout(run, delay);
  };
  const run = async () => {
    timer = undefined;
    if (running || stopped) return;
    running = true;
    try {
      const complete = await flushPendingNuvioMutations();
      delay = complete ? 1000 : Math.min(delay * 2, 60_000);
    } catch {
      delay = Math.min(delay * 2, 60_000);
    } finally {
      running = false;
      schedule();
    }
  };
  const wake = () => {
    delay = 1000;
    schedule();
  };
  const onOwner = () => {
    const next = `${isNuvioProviderActive()}:${getNuvioAccountId()}:${getNuvioActiveSlot()}`;
    if (next === owner) return;
    owner = next;
    wake();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") wake();
  };
  const events = [
    "harbor:nuvio-state-changed",
    "harbor:nuvio-profile-changed",
    "harbor:account-provider-changed",
  ];
  for (const event of events) window.addEventListener(event, onOwner);
  window.addEventListener("online", wake);
  window.addEventListener("harbor:nuvio-mutations-pending", wake);
  document.addEventListener("visibilitychange", onVisible);
  onOwner();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const event of events) window.removeEventListener(event, onOwner);
    window.removeEventListener("online", wake);
    window.removeEventListener("harbor:nuvio-mutations-pending", wake);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

function watchedTime(row: NuvioWatchedItem): number {
  const value =
    typeof row.watched_at === "number" ? row.watched_at : Date.parse(row.watched_at ?? "");
  return Number.isFinite(value) ? value : 0;
}

function progressTime(row: NuvioWatchProgress): number {
  const raw = row.last_watched;
  const value = typeof raw === "number" ? raw : raw ? Date.parse(String(raw)) : 0;
  if (Number.isFinite(value) && value > 0 && value <= 8.64e15) return value;
  const updated = Date.parse(row.updated_at ?? "");
  return Number.isFinite(updated) && updated > 0 ? updated : 0;
}

function pendingRowTime(kind: PendingChange["kind"], row: NuvioCoordinate): number {
  return kind === "progress"
    ? progressTime(row as NuvioWatchProgress)
    : watchedTime(row as NuvioWatchedItem);
}

function validRow(value: unknown, slot: number, accountId: string): value is NuvioCoordinate {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.content_id === "string" &&
    row.content_id.trim().length > 0 &&
    (row.profile_id == null || row.profile_id === slot) &&
    (row.user_id == null || row.user_id === accountId) &&
    ((row.season == null && row.episode == null) ||
      (Number.isInteger(row.season) &&
        Number(row.season) >= 0 &&
        Number.isInteger(row.episode) &&
        Number(row.episode) > 0))
  );
}

// Offsets advance by the actual response size, so a server-side max-rows cap
// cannot skip records. Unknown totals require an empty terminal page.
async function readTableSnapshot<T extends NuvioCoordinate>(
  table: "watched_items" | "watch_progress",
  slot: number,
  accountId: string,
  stillCurrent: () => boolean,
  allowUncountedEmpty: boolean,
): Promise<T[] | null> {
  const items: T[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  for (let page = 0; page < 100; page++) {
    if (!stillCurrent()) return null;
    const offset = items.length;
    const res = await nuvioFetch(
      `/rest/v1/${table}?profile_id=eq.${slot}&select=*&order=content_id.asc,season.asc.nullsfirst,episode.asc.nullsfirst&limit=1000&offset=${offset}`,
      { headers: { Prefer: "count=exact" } },
    );
    if (!res.ok || !stillCurrent()) return null;
    const rows: unknown = await res.json();
    if (!stillCurrent() || !Array.isArray(rows) || rows.length > 1000) return null;
    const range = res.headers?.get("content-range");
    if (range) {
      const match = /^(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(range);
      if (!match) return null;
      if (
        rows.length > 0 &&
        (Number(match[1]) !== offset || Number(match[2]) + 1 !== offset + rows.length)
      )
        return null;
      if (match[3] !== "*") {
        const count = Number(match[3]);
        if ((total != null && count !== total) || count < offset + rows.length) return null;
        total = count;
      }
    }
    for (const row of rows) {
      if (!validRow(row, slot, accountId)) return null;
      const key = coordinate(row);
      if (seen.has(key)) return null;
      seen.add(key);
      items.push(row as T);
    }
    if (total != null && items.length === total) return items;
    if (rows.length === 0) {
      if (total != null || (offset === 0 && !allowUncountedEmpty)) return null;
      return items;
    }
  }
  return null;
}

async function readContentRows<T extends NuvioCoordinate>(
  table: "watched_items" | "watch_progress",
  slot: number,
  accountId: string,
  contentId: string,
  season: number | null | undefined,
  episode: number | null | undefined,
  stillCurrent: () => boolean,
): Promise<T[] | null> {
  const items: T[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  for (let page = 0; page < 20; page++) {
    if (!stillCurrent()) return null;
    const offset = items.length;
    let url = `/rest/v1/${table}?profile_id=eq.${slot}&content_id=eq.${encodeURIComponent(contentId)}&select=*&order=content_id.asc,season.asc.nullsfirst,episode.asc.nullsfirst&limit=1000&offset=${offset}`;
    if (season != null) url += `&season=eq.${season}`;
    if (episode != null) url += `&episode=eq.${episode}`;
    const res = await nuvioFetch(url, { headers: { Prefer: "count=exact" } }, stillCurrent);
    if (!res.ok || !stillCurrent()) return null;
    const rows: unknown = await res.json();
    if (!stillCurrent() || !Array.isArray(rows) || rows.length > 1000) return null;
    const range = res.headers?.get("content-range");
    if (range) {
      const match = /^(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(range);
      if (!match) return null;
      if (
        rows.length > 0 &&
        (Number(match[1]) !== offset || Number(match[2]) + 1 !== offset + rows.length)
      )
        return null;
      if (match[3] !== "*") {
        const count = Number(match[3]);
        if ((total != null && count !== total) || count < offset + rows.length) return null;
        total = count;
      }
    }
    for (const row of rows) {
      if (!validRow(row, slot, accountId)) return null;
      const key =
        table === "watch_progress"
          ? `${coordinate(row)}|${(row as NuvioWatchProgress).progress_key ?? ""}`
          : coordinate(row);
      if (seen.has(key)) return null;
      seen.add(key);
      items.push(row as T);
    }
    if (rows.length === 0) return total != null && items.length < total ? null : items;
    if (total != null ? items.length === total : rows.length < 1000) return items;
  }
  return null;
}

function getWatchProgressKey(slot: number, accountId?: string): string {
  const acc = accountId || getNuvioAccountId() || "anon";
  return `${WATCH_PROGRESS_CACHE_PREFIX}${acc}.slot.${slot}`;
}

/**
 * Loads cached watch progress records for a specific profile slot from localStorage.
 */
export function readCachedWatchProgress(slot: number, accountId?: string): NuvioWatchProgress[] {
  try {
    const raw = localStorage.getItem(getWatchProgressKey(slot, accountId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NuvioWatchProgress[]) : [];
  } catch {
    return [];
  }
}

/**
 * Saves watch progress records for a specific profile slot into localStorage.
 */
export function writeCachedWatchProgress(
  slot: number,
  items: NuvioWatchProgress[],
  accountId?: string,
): void {
  try {
    localStorage.setItem(getWatchProgressKey(slot, accountId), JSON.stringify(items));
  } catch {}
}

export function clearCachedWatchProgress(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith("harbor.nuvio.watch_progress.") ||
          key.startsWith("harbor.nuvio.watch_progress.slot."))
      ) {
        toRemove.push(key);
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
}

/**
 * Pushes watch progress to Nuvio for the active Harbor profile.
 * Progress is saved in integer seconds.
 */
export async function pushWatchProgressToNuvio(
  harborProfileId: string | number | undefined,
  contentId: string,
  progressSeconds: number,
  durationSeconds: number,
  season?: number | null,
  episode?: number | null,
  meta?: { title?: string; name?: string; poster?: string; background?: string },
): Promise<boolean> {
  if (!isNuvioSignedIn()) return false;

  const accountId = getNuvioAccountId();
  if (!accountId) return false;
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);
  const progSec = Math.max(0, Math.round(progressSeconds));
  const durSec = Math.max(0, Math.round(durationSeconds));

  if (progSec <= 0 && durSec <= 0) {
    // Both 0 indicates invalid or empty progress without duration context.
    return true;
  }

  const progressKey =
    season != null && episode != null ? `${contentId}_s${season}e${episode}` : contentId;

  const nowEpoch = Date.now();
  const title = meta?.name || meta?.title || undefined;
  const poster = meta?.poster || undefined;
  const background = meta?.background || undefined;

  const payload: NuvioWatchProgress = {
    profile_id: profileIndex,
    content_id: contentId,
    progress_key: progressKey,
    progress_seconds: progSec,
    duration_seconds: durSec,
    season: season ?? null,
    episode: episode ?? null,
    updated_at: new Date(nowEpoch).toISOString(),
    last_watched: nowEpoch,
    title,
    name: title,
    poster,
    background,
  };

  const recorded = recordPending(profileIndex, accountId, "progress", [payload]);

  // Update local slot cache immediately for instant snappy responsiveness
  try {
    const cached = readCachedWatchProgress(profileIndex);
    const existingIndex = cached.findIndex((p) => p.progress_key === progressKey);
    const existing = existingIndex >= 0 ? cached[existingIndex] : null;
    const mergedPayload: NuvioWatchProgress = {
      ...payload,
      title: title || existing?.title || existing?.name,
      name: title || existing?.name || existing?.title,
      poster: poster || existing?.poster,
      background: background || existing?.background,
    };
    const filtered = cached.filter((p) => p.progress_key !== progressKey);
    filtered.unshift(mergedPayload);
    writeCachedWatchProgress(profileIndex, filtered);
    try {
      const built = buildNuvioPlaybackItems(filtered, profileIndex);
      writeCachedNuvioPlaybackItems(profileIndex, built);
    } catch {}

    // Save to local continue watching immediately
    saveLocalCw(
      {
        id: contentId,
        type: season != null && episode != null ? "series" : "movie",
        name: title || existing?.name || existing?.title || contentId,
        poster: poster || existing?.poster || undefined,
        background: background || existing?.background || undefined,
        season: season ?? undefined,
        episode: episode ?? undefined,
        positionMs: progSec * 1000,
        durationMs: durSec * 1000,
        t: nowEpoch,
      },
      `nuvio-${profileIndex}`,
    );

    window.dispatchEvent(
      new CustomEvent("harbor:nuvio-progress-pushed", { detail: { profileIndex, progressKey } }),
    );
  } catch {}

  return sendRecordedChanges(profileIndex, accountId, recorded);
}

/**
 * Pushes watched items to Nuvio cloud via RPC or table fallback
 */
export async function pushWatchedItemToNuvio(
  harborProfileId: string | number | undefined,
  items: Array<{
    contentId: string;
    contentType?: string;
    title?: string;
    season?: number | null;
    episode?: number | null;
    watchedAt?: number;
  }>,
): Promise<boolean> {
  if (!isNuvioSignedIn() || items.length === 0) return false;
  const accountId = getNuvioAccountId();
  if (!accountId) return false;
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);

  // Update local watched cache immediately for instant snappy responsiveness
  try {
    const cachedWatched = readCachedWatchedItems(profileIndex);
    const updatedWatched = [...cachedWatched];
    for (const item of items) {
      const idx = updatedWatched.findIndex(
        (w) =>
          w.content_id === item.contentId &&
          (item.season == null || w.season === item.season) &&
          (item.episode == null || w.episode === item.episode),
      );
      const newEntry: NuvioWatchedItem = {
        profile_id: profileIndex,
        content_id: item.contentId,
        content_type:
          item.contentType || (item.season != null && item.episode != null ? "series" : "movie"),
        title: item.title || "",
        season: item.season ?? null,
        episode: item.episode ?? null,
        watched_at: item.watchedAt || Date.now(),
      };
      if (idx >= 0) {
        updatedWatched[idx] = newEntry;
      } else {
        updatedWatched.push(newEntry);
      }
    }
    writeCachedWatchedItems(profileIndex, updatedWatched);
  } catch {}

  const recorded = recordPending(
    profileIndex,
    accountId,
    "watched",
    items.map((item) => ({
      content_id: item.contentId,
      content_type: item.contentType,
      title: item.title,
      profile_id: profileIndex,
      season: item.season ?? null,
      episode: item.episode ?? null,
      watched_at: item.watchedAt || Date.now(),
    })),
  );

  return sendRecordedChanges(profileIndex, accountId, recorded);
}

/**
 * Deletes watched items from Nuvio cloud via RPC or table fallback
 */
export async function deleteWatchedItemFromNuvio(
  harborProfileId: string | number | undefined,
  keys: Array<{
    contentId: string;
    season?: number | null;
    episode?: number | null;
  }>,
): Promise<boolean> {
  if (!isNuvioSignedIn() || keys.length === 0) return false;
  const accountId = getNuvioAccountId();
  if (!accountId) return false;
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);

  // Update local watched cache immediately
  try {
    const cachedWatched = readCachedWatchedItems(profileIndex);
    const filtered = cachedWatched.filter(
      (w) =>
        !keys.some(
          (k) =>
            k.contentId === w.content_id &&
            (k.season == null || k.season === w.season) &&
            (k.episode == null || k.episode === w.episode),
        ),
    );
    writeCachedWatchedItems(profileIndex, filtered);
  } catch {}

  const recorded = recordPending(
    profileIndex,
    accountId,
    "watched",
    keys.map((key) => ({
      content_id: key.contentId,
      profile_id: profileIndex,
      season: key.season ?? null,
      episode: key.episode ?? null,
    })),
    true,
  );

  return sendRecordedChanges(profileIndex, accountId, recorded);
}

/**
 * Reads locally cached dismissed Next-Up keys for a profile slot
 */
export function readCachedDismissedNextUpKeys(profileIndex: number): Set<string> {
  try {
    const raw = localStorage.getItem(`harbor.nuvio.dismissedNextUp.v1.${profileIndex}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((k) => typeof k === "string"));
      }
    }
  } catch {}
  return new Set();
}

/**
 * Writes locally cached dismissed Next-Up keys for a profile slot
 */
export function writeCachedDismissedNextUpKeys(profileIndex: number, keys: Set<string>): void {
  try {
    localStorage.setItem(
      `harbor.nuvio.dismissedNextUp.v1.${profileIndex}`,
      JSON.stringify(Array.from(keys)),
    );
  } catch {}
}

/**
 * Returns true if a content item or episode is in the dismissed next up set
 */
export function isDismissedNextUp(
  contentId: string,
  season: number | null | undefined,
  episode: number | null | undefined,
  dismissedKeys: Set<string>,
): boolean {
  if (!contentId || dismissedKeys.size === 0) return false;
  const cleanId = contentId.replace(/^(series|movie|tmdb):/, "").trim();
  const idVariants = [contentId, cleanId, `tmdb:${cleanId}`, `series:${cleanId}`];

  // 1. Check whole-show dismissals or wildcard dismissals (-1|-1) or bare ID
  for (const v of idVariants) {
    if (dismissedKeys.has(v) || dismissedKeys.has(`${v}|-1|-1`)) return true;
  }

  // 2. Check wildcard show-level prefix dismissal
  for (const v of idVariants) {
    const prefix = `${v}|`;
    for (const key of dismissedKeys) {
      if (key.startsWith(prefix)) {
        if (season == null && episode == null) return true;
        const parts = key.split("|");
        const ds = parseInt(parts[1] ?? "-1", 10);
        const de = parseInt(parts[2] ?? "-1", 10);
        if (ds === -1 && de === -1) return true;
      }
    }
  }

  const s = season ?? -1;
  const e = episode ?? -1;

  // 3. Check exact (season, episode), seed episode dismissal (season, episode - 1), and season wildcard (season, -1)
  for (const v of idVariants) {
    if (s >= 0 && e >= 0) {
      if (dismissedKeys.has(`${v}|${s}|${e}`)) return true;
      if (e > 1 && dismissedKeys.has(`${v}|${s}|${e - 1}`)) return true;
    }
    if (s >= 0 && dismissedKeys.has(`${v}|${s}|-1`)) return true;
  }

  return false;
}

/**
 * Pulls dismissed Next-Up keys from Nuvio Cloud's mobile profile settings blob
 */
export async function pullDismissedNextUpKeysFromNuvio(
  harborProfileId?: string | number,
): Promise<Set<string>> {
  if (!isNuvioSignedIn()) return new Set();
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);
  try {
    const pullRes = await nuvioFetch("/rest/v1/rpc/sync_pull_profile_settings_blob", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_profile_id: profileIndex,
        p_platform: "mobile",
      }),
    });
    if (!pullRes.ok) return readCachedDismissedNextUpKeys(profileIndex);
    const blobList = await pullRes.json();
    const first = Array.isArray(blobList) ? blobList[0] : null;
    const features = first?.settings_json?.features;
    let cwPayload: any = {};
    if (
      typeof features?.continue_watching_settings_payload === "string" &&
      features.continue_watching_settings_payload.trim()
    ) {
      try {
        cwPayload = JSON.parse(features.continue_watching_settings_payload);
      } catch {}
    }
    const dismissed = Array.isArray(cwPayload.dismissedNextUpKeys)
      ? new Set<string>(cwPayload.dismissedNextUpKeys)
      : new Set<string>();
    writeCachedDismissedNextUpKeys(profileIndex, dismissed);
    return dismissed;
  } catch {
    return readCachedDismissedNextUpKeys(profileIndex);
  }
}

/**
 * Un-dismisses an Up-Next series in Nuvio Cloud's mobile profile settings blob
 * when a user watches or marks a new episode of that series.
 */
export async function undismissNextUpInNuvioCloud(
  harborProfileId: string | number | undefined,
  contentId: string,
): Promise<boolean> {
  if (!isNuvioSignedIn()) return false;
  const accountId = getNuvioAccountId();
  if (!accountId) return false;
  const sameAccount = () => isNuvioSignedIn() && getNuvioAccountId() === accountId;
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);
  const normalizedContentId = contentId.trim();
  if (!normalizedContentId) return false;

  const cached = readCachedDismissedNextUpKeys(profileIndex);
  const cleanId = normalizedContentId.replace(/^(series|movie|tmdb):/, "");
  let localChanged = false;
  for (const k of Array.from(cached)) {
    if (
      k.startsWith(`${normalizedContentId}|`) ||
      k.startsWith(`${cleanId}|`) ||
      k.startsWith(`tmdb:${cleanId}|`) ||
      k.startsWith(`series:${cleanId}|`)
    ) {
      cached.delete(k);
      localChanged = true;
    }
  }
  if (localChanged) {
    writeCachedDismissedNextUpKeys(profileIndex, cached);
  }

  try {
    const pullRes = await nuvioFetch("/rest/v1/rpc/sync_pull_profile_settings_blob", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_profile_id: profileIndex,
        p_platform: "mobile",
      }),
    });
    if (!pullRes.ok || !sameAccount()) return false;
    const blobList = await pullRes.json();
    if (!sameAccount()) return false;
    const first = Array.isArray(blobList) ? blobList[0] : null;
    const settingsJson = first?.settings_json ?? { version: 4, features: {} };
    if (!settingsJson.features) settingsJson.features = {};
    const features = settingsJson.features;
    let cwPayload: any = {};
    if (
      typeof features.continue_watching_settings_payload === "string" &&
      features.continue_watching_settings_payload.trim()
    ) {
      try {
        cwPayload = JSON.parse(features.continue_watching_settings_payload);
      } catch {}
    }
    const dismissed: string[] = Array.isArray(cwPayload.dismissedNextUpKeys)
      ? [...cwPayload.dismissedNextUpKeys]
      : [];

    const filtered = dismissed.filter(
      (k) =>
        k !== normalizedContentId &&
        k !== cleanId &&
        k !== `tmdb:${cleanId}` &&
        k !== `series:${cleanId}` &&
        !k.startsWith(`${normalizedContentId}|`) &&
        !k.startsWith(`${cleanId}|`) &&
        !k.startsWith(`tmdb:${cleanId}|`) &&
        !k.startsWith(`series:${cleanId}|`),
    );

    if (filtered.length !== dismissed.length) {
      cwPayload.dismissedNextUpKeys = filtered;
      features.continue_watching_settings_payload = JSON.stringify(cwPayload);
      settingsJson.features = features;

      const clientId = getOrCreateSyncClientId();
      const pushRes = await nuvioFetch("/rest/v1/rpc/sync_push_profile_settings_blob", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p_profile_id: profileIndex,
          p_platform: "mobile",
          p_settings_json: settingsJson,
          p_origin_client_id: clientId,
        }),
      });
      return pushRes.ok;
    }
    return true;
  } catch (err) {
    console.warn("[nuvio-sync] failed to undismiss next up in cloud:", err);
    return false;
  }
}

/**
 * Dismisses an Up-Next series in Nuvio Cloud's mobile profile settings blob
 * so that Nuvio Mobile's Next-Up engine never resurrects the card.
 */
export async function dismissNextUpInNuvioCloud(
  harborProfileId: string | number | undefined,
  contentId: string,
  season?: number | null,
  episode?: number | null,
): Promise<boolean> {
  if (!isNuvioSignedIn()) return false;
  const accountId = getNuvioAccountId();
  if (!accountId) return false;
  const sameAccount = () => isNuvioSignedIn() && getNuvioAccountId() === accountId;
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);
  const normalizedContentId = contentId.trim();
  if (!normalizedContentId) return false;

  const cleanId = normalizedContentId.replace(/^(series|movie|tmdb):/, "").trim();
  const idVariants = Array.from(
    new Set([normalizedContentId, cleanId, `tmdb:${cleanId}`, `series:${cleanId}`]),
  );

  const targetKeys: string[] = [];
  for (const v of idVariants) {
    targetKeys.push(v);
    targetKeys.push(`${v}|-1|-1`);
    if (season != null && season >= 0 && episode != null && episode >= 0) {
      targetKeys.push(`${v}|${season}|${episode}`);
      if (episode > 1) {
        targetKeys.push(`${v}|${season}|${episode - 1}`);
      }
    }
  }

  const cached = readCachedDismissedNextUpKeys(profileIndex);
  for (const k of targetKeys) {
    cached.add(k);
  }
  writeCachedDismissedNextUpKeys(profileIndex, cached);

  try {
    const pullRes = await nuvioFetch("/rest/v1/rpc/sync_pull_profile_settings_blob", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_profile_id: profileIndex,
        p_platform: "mobile",
      }),
    });
    if (!pullRes.ok) return false;
    const blobList = await pullRes.json();
    const first = Array.isArray(blobList) ? blobList[0] : null;
    const settingsJson = first?.settings_json ?? { version: 4, features: {} };
    if (!settingsJson.features) settingsJson.features = {};
    const features = settingsJson.features;
    let cwPayload: any = {};
    if (
      typeof features.continue_watching_settings_payload === "string" &&
      features.continue_watching_settings_payload.trim()
    ) {
      try {
        cwPayload = JSON.parse(features.continue_watching_settings_payload);
      } catch {}
    }
    const rawDismissed: string[] = Array.isArray(cwPayload.dismissedNextUpKeys)
      ? [...cwPayload.dismissedNextUpKeys]
      : [];
    let dismissed = rawDismissed.filter((k) => typeof k === "string");

    let changed = dismissed.length !== rawDismissed.length;
    for (const k of targetKeys) {
      if (!dismissed.includes(k)) {
        dismissed.push(k);
        changed = true;
      }
    }

    if (changed) {
      cwPayload.dismissedNextUpKeys = dismissed;
      features.continue_watching_settings_payload = JSON.stringify(cwPayload);
      settingsJson.features = features;

      const clientId = getOrCreateSyncClientId();
      if (!sameAccount()) return false;
      const pushRes = await nuvioFetch("/rest/v1/rpc/sync_push_profile_settings_blob", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p_profile_id: profileIndex,
          p_platform: "mobile",
          p_settings_json: settingsJson,
          p_origin_client_id: clientId,
        }),
      });
      return pushRes.ok;
    }
    return true;
  } catch (err) {
    console.warn("[nuvio-sync] failed to dismiss next up in cloud:", err);
    return false;
  }
}

/**
 * Marks an episode or movie as fully watched in Nuvio
 */
export async function markWatchedInNuvio(
  harborProfileId: string | number | undefined,
  contentId: string,
  season?: number | null,
  episode?: number | null,
  title?: string,
): Promise<boolean> {
  return pushWatchedItemToNuvio(harborProfileId, [
    {
      contentId,
      contentType: season != null && episode != null ? "series" : "movie",
      title,
      season,
      episode,
      watchedAt: Date.now(),
    },
  ]);
}

const WATCHED_ITEMS_CACHE_PREFIX = "harbor.nuvio.watched_items.";

export function readCachedWatchedItems(slot?: number, accountId?: string): NuvioWatchedItem[] {
  const profileIndex = slot ?? resolveNuvioProfileIndex();
  const acc = accountId || getNuvioAccountId() || "anon";
  try {
    const raw = localStorage.getItem(`${WATCHED_ITEMS_CACHE_PREFIX}${acc}.slot.${profileIndex}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as NuvioWatchedItem[];
    }
  } catch {}
  return [];
}

export function writeCachedWatchedItems(
  slot: number,
  items: NuvioWatchedItem[],
  accountId?: string,
): void {
  const acc = accountId || getNuvioAccountId() || "anon";
  try {
    localStorage.setItem(`${WATCHED_ITEMS_CACHE_PREFIX}${acc}.slot.${slot}`, JSON.stringify(items));
  } catch {}
}

/**
 * Pulls watched items for a specific profile slot from Nuvio
 */
export async function pullWatchedItemsFromNuvio(
  harborProfileId?: string | number,
  options?: { force?: boolean },
): Promise<NuvioWatchedItem[] | null> {
  if (!isNuvioSignedIn() || !isNuvioProviderActive()) return null;
  const accountId = getNuvioAccountId();
  if (!accountId) return null;
  const slot = resolveNuvioProfileIndex(harborProfileId);
  const stillCurrent = () =>
    isNuvioSignedIn() &&
    isNuvioProviderActive() &&
    getNuvioAccountId() === accountId &&
    resolveNuvioProfileIndex() === slot;
  const fullSyncKey = `watched:${accountId}:${slot}`;
  const lastFullSync = lastFullSyncAt.get(fullSyncKey) ?? 0;
  if (!options?.force && lastFullSync && Date.now() - lastFullSync < FULL_SYNC_INTERVAL_MS)
    return null;
  let rpcRows: NuvioWatchedItem[] | null = null;
  let confirmedEmpty = false;
  try {
    const res = await nuvioFetch("/rest/v1/rpc/sync_pull_watched_items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_profile_id: slot, p_page: 1, p_page_size: 1000 }),
    });
    if (!stillCurrent()) return null;
    if (res.ok) {
      const rows: unknown = await res.json();
      if (Array.isArray(rows) && rows.every((row) => validRow(row, slot, accountId))) {
        rpcRows = rows as NuvioWatchedItem[];
        confirmedEmpty = rows.length === 0;
      }
    }
  } catch {
    // A fallback may prove completeness through its count or terminal page.
  }
  try {
    const table = await readTableSnapshot<NuvioWatchedItem>(
      "watched_items",
      slot,
      accountId,
      stillCurrent,
      confirmedEmpty,
    );
    if (table) {
      if (rpcRows && rpcRows.length > 0) {
        // The table and the official RPC must agree on the latest rows before a
        // snapshot is allowed to remove local watched state.
        const tableCoordinates = new Set(table.map((row) => coordinate(row)));
        if (!rpcRows.every((row) => tableCoordinates.has(coordinate(row)))) {
          console.warn(
            "[nuvio-sync] watched table does not match the RPC batch; keeping local state",
          );
          return null;
        }
      }
      lastFullSyncAt.set(fullSyncKey, Date.now());
      writeCachedWatchedItems(slot, table, accountId);
      return table;
    }
  } catch {
    // If readTableSnapshot is unavailable (e.g. Supabase RLS enforces stored procedures),
    // fall back to official sync_pull_watched_items RPC batch below.
  }

  if (rpcRows !== null || confirmedEmpty) {
    const allRpc = [...(rpcRows ?? [])];
    if (allRpc.length >= 1000) {
      let page = 2;
      while (page <= 50) {
        try {
          const res = await nuvioFetch("/rest/v1/rpc/sync_pull_watched_items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ p_profile_id: slot, p_page: page, p_page_size: 1000 }),
          });
          if (!stillCurrent() || !res.ok) break;
          const rows: unknown = await res.json();
          if (!Array.isArray(rows) || !rows.every((row) => validRow(row, slot, accountId))) break;
          allRpc.push(...(rows as NuvioWatchedItem[]));
          if (rows.length < 1000) break;
          page++;
        } catch {
          break;
        }
      }
    }
    if (!stillCurrent()) return null;
    lastFullSyncAt.set(fullSyncKey, Date.now());
    writeCachedWatchedItems(slot, allRpc, accountId);
    return allRpc;
  }
  return null;
}

/**
 * Reconciles remote watched items into local watched-flag, movie-watched, and manual-watched storage
 * for the active Nuvio profile slot.
 */
async function resolveNextEpisodeForSeries(
  seriesId: string,
  lastSeason: number,
  lastEpisode: number,
  seriesTitle?: string,
): Promise<{ season: number; episode: number } | null | undefined> {
  const cleanId = seriesId.replace(/^(series|movie|tmdb):/, "").trim();
  try {
    let lookupId = cleanId;
    if (
      !lookupId.startsWith("tt") &&
      !lookupId.startsWith("tmdb:") &&
      !lookupId.startsWith("kitsu:") &&
      !lookupId.startsWith("mal:")
    ) {
      if (/^\d+$/.test(lookupId)) {
        lookupId = `tmdb:${lookupId}`;
      }
    }
    let m = await fetchMeta("series", lookupId).catch(() => null);
    if (!m && seriesTitle) {
      const searchRes = await fetch(
        `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(
          seriesTitle,
        )}.json`,
      ).catch(() => null);
      if (searchRes && searchRes.ok) {
        const searchData = await searchRes.json().catch(() => null);
        const firstHit = searchData?.metas?.[0];
        if (firstHit?.id) {
          m = await fetchMeta("series", firstHit.id).catch(() => null);
        }
      }
    }
    if (!m && lookupId.startsWith("tmdb:")) {
      const tmdbNum = parseTmdbTvId(lookupId);
      const key = loadStoredSettings().tmdbKey;
      if (tmdbNum && key) {
        const episodes = await fetchSeasonEpisodes(
          { id: lookupId, type: "series", name: "" },
          lastSeason,
          { tmdbKey: key },
        ).catch(() => null);
        if (episodes && episodes.length > 0) {
          const nextInSeason = episodes.find((e) => e.episode > lastEpisode);
          if (nextInSeason) return { season: lastSeason, episode: nextInSeason.episode };
          const nextSeasonEps = await fetchSeasonEpisodes(
            { id: lookupId, type: "series", name: "" },
            lastSeason + 1,
            { tmdbKey: key },
          ).catch(() => null);
          if (nextSeasonEps && nextSeasonEps.length > 0) {
            return { season: lastSeason + 1, episode: nextSeasonEps[0].episode };
          } else if (nextSeasonEps !== null) {
            return null;
          }
        }
      }
    }
    if (m?.videos && m.videos.length > 0) {
      const orderedVideos = m.videos
        .flatMap((v) => {
          const s = v.season ?? 0;
          const e = v.episode ?? v.number ?? 0;
          return s > 0 && e > 0 ? [{ season: s, episode: e }] : [];
        })
        .sort((a, b) => a.season - b.season || a.episode - b.episode);
      const nextVid = orderedVideos.find(
        (v) => v.season > lastSeason || (v.season === lastSeason && v.episode > lastEpisode),
      );
      if (nextVid) {
        return { season: nextVid.season, episode: nextVid.episode };
      }
      return null;
    }
  } catch {}
  return undefined;
}

/**
 * True when the Continue Watching end mode keeps caught-up series visible: the
 * "Timer" mode retains the finished card so the tray can draw the countdown,
 * while "Hide" removes the series outright.
 */
export function cwKeepsCaughtUpForTimer(): boolean {
  const settings = loadStoredSettings();
  return settings.animeCwEnd === "timer";
}

const watchedReconcileInflight = new Map<string, Promise<void>>();

// export async function reconcileNuvioWatched
export function reconcileNuvioWatched(
  harborProfileId?: string | number,
  options?: { force?: boolean },
): Promise<void> {
  void expungeLeachedNuvioItemsFromStremio().catch(() => {});
  if (!isNuvioSignedIn() || !isNuvioProviderActive()) return Promise.resolve();
  const accountId = getNuvioAccountId();
  if (!accountId) return Promise.resolve();
  const slot = resolveNuvioProfileIndex(harborProfileId);
  const key = `${accountId}:${slot}:${options?.force ? "force" : "normal"}`;
  const existing = watchedReconcileInflight.get(key);
  if (existing) return existing;
  const work = reconcileNuvioWatchedOnce(slot, options?.force).finally(() => {
    if (watchedReconcileInflight.get(key) === work) watchedReconcileInflight.delete(key);
  });
  watchedReconcileInflight.set(key, work);
  return work;
}

async function reconcileNuvioWatchedOnce(
  harborProfileId?: string | number,
  force = false,
): Promise<void> {
  if (!isNuvioSignedIn() || !isNuvioProviderActive()) return;
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);
  const accountId = getNuvioAccountId();
  if (!accountId) return;
  const pending = readPending(profileIndex, accountId);
  const keys = [
    `harbor.watchedFlag.${nuvioWatchedScope(profileIndex, accountId)}`,
    `harbor.moviewatched.${nuvioWatchedScope(profileIndex, accountId)}`,
    `harbor.manualwatched.v1.${nuvioWatchedScope(profileIndex, accountId)}`,
    `harbor.manualunwatched.v1.${nuvioWatchedScope(profileIndex, accountId)}`,
  ];
  const before = keys.map((key) => localStorage.getItem(key));
  const pulled = await pullWatchedItemsFromNuvio(profileIndex, {
    force: force || Object.values(pending).some((change) => change.kind === "watched"),
  });
  const items =
    pulled &&
    isNuvioProviderActive() &&
    getNuvioAccountId() === accountId &&
    resolveNuvioProfileIndex() === profileIndex &&
    keys.every((key, i) => localStorage.getItem(key) === before[i])
      ? applyPending(pulled, profileIndex, accountId, "watched", true, pending).items
      : null;
  if (
    !items ||
    !accountId ||
    getNuvioAccountId() !== accountId ||
    !isNuvioProviderActive() ||
    resolveNuvioProfileIndex() !== profileIndex
  )
    return;

  const serverWatchedIds = new Set<string>();
  const serverMovieIds = new Set<string>();
  const serverEpisodeKeys = new Set<string>();

  for (const it of items) {
    if (!it.content_id) continue;
    const cleanId = it.content_id.replace(/^(series|movie|tmdb):/, "").trim();
    if (it.season == null && it.episode == null) {
      serverWatchedIds.add(it.content_id);
      if (cleanId) serverWatchedIds.add(cleanId);
      if (it.content_type === "movie" || !it.content_type) {
        serverMovieIds.add(it.content_id);
        if (cleanId) serverMovieIds.add(cleanId);
      }
    } else if (typeof it.season === "number" && typeof it.episode === "number") {
      serverEpisodeKeys.add(`${it.content_id}|${it.season}|${it.episode}`);
      if (cleanId) serverEpisodeKeys.add(`${cleanId}|${it.season}|${it.episode}`);
    }
  }

  // 1. Reconcile episodes with local storage: adds server episodes and removes
  // unflagged episodes (handling single unmarks, up-to unmarks, and whole-season unmarks from Nuvio mobile)
  const { newlyWatchedShows } = reconcileNuvioWatchedEpisodes(
    profileIndex,
    serverEpisodeKeys,
    accountId,
  );

  for (const id of serverWatchedIds) {
    setWatchedFlag(id, true, profileIndex);
  }
  for (const id of serverMovieIds) {
    setMovieWatchedLocal(id, true, profileIndex);
  }

  try {
    const scopedFlagKey = `harbor.watchedFlag.${nuvioWatchedScope(profileIndex, accountId)}`;
    const scopedMovieKey = `harbor.moviewatched.${nuvioWatchedScope(profileIndex, accountId)}`;
    for (const key of [scopedFlagKey, scopedMovieKey]) {
      const raw = localStorage.getItem(key);
      if (raw) {
        const stored = JSON.parse(raw);
        if (Array.isArray(stored)) {
          for (const localId of stored) {
            const cleanLocal = localId.replace(/^(series|movie|tmdb):/, "").trim();
            const hasWatched =
              serverWatchedIds.has(localId) || (cleanLocal && serverWatchedIds.has(cleanLocal));
            const hasMovie =
              serverMovieIds.has(localId) || (cleanLocal && serverMovieIds.has(cleanLocal));
            if (!hasWatched && !hasMovie) {
              setWatchedFlag(localId, false, profileIndex);
              setMovieWatchedLocal(localId, false, profileIndex);
            }
          }
        }
      }
    }
  } catch {}

  // A complete snapshot is authoritative. Commit once, not once per item:
  // repeated writes were O(n^2) on shows with thousands of watched episodes.
  reconcileNuvioWatchedFlags(profileIndex, serverWatchedIds, accountId);
  reconcileNuvioMovieWatched(profileIndex, serverMovieIds, accountId);

  // 4. Update Continue Watching tray and reconcile playback items
  try {
    const progressItems = readCachedWatchProgress(profileIndex);
    const dismissedKeys =
      newlyWatchedShows.size > 0
        ? await pullDismissedNextUpKeysFromNuvio(profileIndex)
        : readCachedDismissedNextUpKeys(profileIndex);
    const localEntries = listLocalCw(false);
    const seenShowIds = new Set<string>();

    // Group serverEpisodeKeys by showId to find most recently watched season & episode
    const showMaxWatched = new Map<
      string,
      { season: number; episode: number; title?: string; watchedAt: number }
    >();
    for (const item of items) {
      if (!item.content_id || item.season == null || item.episode == null) continue;
      const s = item.season;
      const e = item.episode;
      const itemTime = item.watched_at
        ? typeof item.watched_at === "number"
          ? item.watched_at
          : Date.parse(item.watched_at)
        : 0;

      const order = (sn: number, ep: number) => sn * 100000 + ep;
      const register = (cid: string) => {
        const prev = showMaxWatched.get(cid);
        if (
          !prev ||
          order(s, e) > order(prev.season, prev.episode) ||
          (order(s, e) === order(prev.season, prev.episode) && itemTime > prev.watchedAt)
        ) {
          showMaxWatched.set(cid, {
            season: s,
            episode: e,
            title: item.title,
            watchedAt: Math.max(itemTime, prev?.watchedAt ?? 0),
          });
        }
      };

      register(item.content_id);
      const cleanId = item.content_id.replace(/^(series|movie|tmdb):/, "");
      register(cleanId);
      register(`tmdb:${cleanId}`);
      register(`series:${cleanId}`);
    }

    // Only un-dismiss shows that gained newly watched episodes from the server (e.g. watched on mobile),
    // preserving local dismissals so titles removed via (X) do not resurrect on every sync tick.
    for (const showId of newlyWatchedShows) {
      if (serverWatchedIds.has(showId) && !cwKeepsCaughtUpForTimer()) continue;
      undismissCw(showId);
      const clean = showId.replace(/^(series|movie|tmdb):/, "").trim();
      for (const k of Array.from(dismissedKeys)) {
        if (
          k === showId ||
          k === clean ||
          k.startsWith(`${showId}|`) ||
          k.startsWith(`${clean}|`) ||
          k.startsWith(`tmdb:${clean}|`) ||
          k.startsWith(`series:${clean}|`)
        ) {
          dismissedKeys.delete(k);
        }
      }
    }
    if (newlyWatchedShows.size > 0) {
      writeCachedDismissedNextUpKeys(profileIndex, dismissedKeys);
    }

    for (const entry of localEntries) {
      if (entry.type !== "series" || entry.season == null || entry.episode == null) continue;
      seenShowIds.add(entry.id);
      const cleanEntryId = entry.id.replace(/^(series|movie|tmdb):/, "");
      // Check if dismissed in Nuvio Cloud
      if (isDismissedNextUp(entry.id, entry.season, entry.episode, dismissedKeys)) {
        clearLocalCw(entry.id, `nuvio-${profileIndex}`);
        clearResume(entry.id, undefined, undefined, `nuvio-${profileIndex}`);
        clearResume(cleanEntryId, undefined, undefined, `nuvio-${profileIndex}`);
        continue;
      }

      const isServerWatched =
        serverWatchedIds.has(entry.id) ||
        serverWatchedIds.has(cleanEntryId) ||
        serverWatchedIds.has(`tmdb:${cleanEntryId}`) ||
        serverWatchedIds.has(`series:${cleanEntryId}`);

      const maxInfo =
        showMaxWatched.get(entry.id) ||
        showMaxWatched.get(cleanEntryId) ||
        showMaxWatched.get(`tmdb:${cleanEntryId}`) ||
        showMaxWatched.get(`series:${cleanEntryId}`);
      if (maxInfo) {
        const nextTarget = await resolveNextEpisodeForSeries(
          entry.id,
          maxInfo.season,
          maxInfo.episode,
        );
        if (nextTarget === null) {
          clearLocalCw(entry.id, `nuvio-${profileIndex}`);
          if (!cwKeepsCaughtUpForTimer()) {
            clearResume(entry.id, undefined, undefined, `nuvio-${profileIndex}`);
            clearResume(cleanEntryId, undefined, undefined, `nuvio-${profileIndex}`);
          } else {
            saveLocalCw(
              {
                ...entry,
                season: maxInfo.season,
                episode: maxInfo.episode,
                positionMs: 0,
                external: "nuvio" as const,
                t: maxInfo.watchedAt || Date.now(),
              },
              `nuvio-${profileIndex}`,
            );
          }
        } else if (nextTarget) {
          const nextS = nextTarget.season;
          const nextE = nextTarget.episode;
          const localIsAhead =
            (entry.season ?? 0) > nextS ||
            ((entry.season ?? 0) === nextS && (entry.episode ?? 0) > nextE);

          if (!localIsAhead) {
            const sameEpisode = entry.season === nextS && entry.episode === nextE;
            const newPos = sameEpisode && (entry.positionMs ?? 0) > 0 ? entry.positionMs : 0;
            if (entry.season !== nextS || entry.episode !== nextE || entry.positionMs !== newPos) {
              saveLocalCw(
                {
                  ...entry,
                  season: nextS,
                  episode: nextE,
                  positionMs: newPos,
                  external: "nuvio" as const,
                  t: maxInfo.watchedAt || Date.now(),
                },
                `nuvio-${profileIndex}`,
              );
            }
          }
        }
      } else if (isServerWatched) {
        if (!cwKeepsCaughtUpForTimer()) {
          clearLocalCw(entry.id, `nuvio-${profileIndex}`);
          clearResume(entry.id, undefined, undefined, `nuvio-${profileIndex}`);
          clearResume(cleanEntryId, undefined, undefined, `nuvio-${profileIndex}`);
        }
      } else {
        const hasProgress = progressItems?.some(
          (p) =>
            p.content_id &&
            (p.content_id === entry.id ||
              p.content_id === cleanEntryId ||
              p.content_id === `tmdb:${cleanEntryId}` ||
              p.content_id === `series:${cleanEntryId}`),
        );
        if (!hasProgress) {
          clearLocalCw(entry.id, `nuvio-${profileIndex}`);
          clearResume(entry.id, undefined, undefined, `nuvio-${profileIndex}`);
          clearResume(cleanEntryId, undefined, undefined, `nuvio-${profileIndex}`);
        }
      }
    }

    // Seed un-dismissed Midway / Next-Up series from Nuvio Cloud (Option 1)
    const cachedLibrary = readCachedNuvioLibrary(profileIndex);
    const libraryMap = new Map<string, (typeof cachedLibrary)[0]>();
    for (const lib of cachedLibrary) {
      libraryMap.set(lib.content_id, lib);
      const clean = lib.content_id.replace(/^(series|movie|tmdb):/, "");
      libraryMap.set(clean, lib);
      libraryMap.set(`tmdb:${clean}`, lib);
      libraryMap.set(`series:${clean}`, lib);
    }

    const processedMidwayShows = new Set<string>();
    for (const item of items) {
      if (!item.content_id || item.season == null || item.episode == null) continue;
      const cleanShowId = item.content_id.replace(/^(series|movie|tmdb):/, "");
      if (
        seenShowIds.has(item.content_id) ||
        seenShowIds.has(cleanShowId) ||
        seenShowIds.has(`tmdb:${cleanShowId}`) ||
        seenShowIds.has(`series:${cleanShowId}`) ||
        processedMidwayShows.has(cleanShowId)
      ) {
        continue;
      }

      processedMidwayShows.add(cleanShowId);
      const maxInfo = showMaxWatched.get(item.content_id) || showMaxWatched.get(cleanShowId);
      if (!maxInfo) continue;

      let nextTarget = await resolveNextEpisodeForSeries(
        item.content_id,
        maxInfo.season,
        maxInfo.episode,
      );
      if (nextTarget === null) {
        if (cwKeepsCaughtUpForTimer()) {
          nextTarget = { season: maxInfo.season, episode: maxInfo.episode };
        } else {
          continue;
        }
      } else if (nextTarget === undefined) {
        // Metadata unavailable: keep current max watched episode rather than discarding
        nextTarget = { season: maxInfo.season, episode: maxInfo.episode };
      }
      const nextS = nextTarget.season;
      const nextE = nextTarget.episode;

      // Skip if dismissed in Nuvio Cloud
      if (
        isDismissedNextUp(item.content_id, maxInfo.season, maxInfo.episode, dismissedKeys) ||
        isDismissedNextUp(item.content_id, nextS, nextE, dismissedKeys)
      ) {
        continue;
      }

      const libItem = libraryMap.get(item.content_id) || libraryMap.get(cleanShowId);
      let title = maxInfo.title || libItem?.name || item.title || cleanShowId;
      let poster = libItem?.poster || undefined;
      let background = libItem?.background || undefined;

      if (!poster || title === cleanShowId) {
        try {
          let m: any = null;
          if (item.content_id.startsWith("tt")) {
            m = await fetchMeta("series", item.content_id).catch(() => null);
          } else {
            const tmdbNum = parseTmdbTvId(item.content_id);
            const key = loadStoredSettings().tmdbKey;
            if (tmdbNum && key) {
              m = await tmdbDetails(key, { id: String(tmdbNum), type: "series", name: "" }).catch(
                () => null,
              );
            }
            if (!m && title && title !== cleanShowId) {
              const searchRes = await fetch(
                `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(title)}.json`,
              )
                .then((r) => r.json())
                .catch(() => null);
              m = searchRes?.metas?.[0];
            }
          }
          if (m) {
            if (m.name && title === cleanShowId) title = m.name;
            if (m.poster && !poster) poster = m.poster;
            if (m.background && !background) background = m.background;
          }
        } catch {}
      }

      const midwayEntry = {
        id: item.content_id,
        type: "series" as const,
        name: title,
        poster,
        background,
        season: nextS,
        episode: nextE,
        positionMs: 0,
        durationMs: 2640000,
        source: "library" as const,
        external: "nuvio" as const,
        t: maxInfo.watchedAt || Date.now(),
      };

      saveLocalCw(midwayEntry, `nuvio-${profileIndex}`);
    }

    const built = buildNuvioPlaybackItems(
      progressItems ?? [],
      profileIndex,
      items,
      dismissedKeys,
      cwKeepsCaughtUpForTimer(),
    );
    writeCachedNuvioPlaybackItems(profileIndex, built);
    window.dispatchEvent(new CustomEvent("harbor:continue-watching-updated"));
  } catch {}

  window.dispatchEvent(
    new CustomEvent("harbor:nuvio-watched-reconciled", { detail: { profileIndex } }),
  );
  try {
    void expungeLeachedNuvioItemsFromStremio().catch(() => {});
  } catch {}
}

/**
 * Deletes watch progress for a single specific episode from Nuvio Cloud and local cache.
 * Does NOT touch other episodes or dismiss the series from Up Next.
 */
export async function deleteEpisodeWatchProgressFromNuvio(
  harborProfileId: string | number | undefined,
  contentId: string,
  season: number,
  episode: number,
): Promise<boolean> {
  if (!isNuvioSignedIn()) return false;
  const accountId = getNuvioAccountId();
  if (!accountId) return false;
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);
  const normalizedContentId = contentId.trim();
  if (!normalizedContentId) return false;
  const recorded = recordPending(
    profileIndex,
    accountId,
    "progress",
    [
      {
        content_id: normalizedContentId,
        profile_id: profileIndex,
        season: season,
        episode: episode,
      },
    ],
    true,
  );

  const cleanId = normalizedContentId.replace(/^(series|movie|tmdb):/, "");
  const idVariants = Array.from(
    new Set([normalizedContentId, cleanId, `tmdb:${cleanId}`, `series:${cleanId}`]),
  );
  const keysToDelete: string[] = [];
  for (const id of idVariants) {
    keysToDelete.push(`${id}_s${season}e${episode}`);
    keysToDelete.push(`${id}:${season}:${episode}`);
  }
  const deleteKeySet = new Set(keysToDelete);
  const idVariantSet = new Set(idVariants);

  // 1. Prune from local cached watch progress
  try {
    const cached = readCachedWatchProgress(profileIndex);
    const filtered = cached.filter(
      (p) =>
        !(
          (idVariantSet.has(p.content_id) && p.season === season && p.episode === episode) ||
          (p.progress_key && deleteKeySet.has(p.progress_key))
        ),
    );
    writeCachedWatchProgress(profileIndex, filtered);
  } catch {}

  // 2. Clear local resume for this specific episode across all alias IDs
  for (const id of idVariants) {
    clearResume(id, season, episode, `nuvio-${profileIndex}`);
  }
  const local = localCwEntry(normalizedContentId, false, `nuvio-${profileIndex}`);
  if (local?.season === season && local.episode === episode) {
    clearLocalCw(normalizedContentId, `nuvio-${profileIndex}`);
  }

  // 3. Dispatch local event
  window.dispatchEvent(
    new CustomEvent("harbor:nuvio-progress-deleted", {
      detail: {
        profileIndex,
        contentId: normalizedContentId,
        keys: keysToDelete,
        episodeOnly: true,
        season,
        episode,
      },
    }),
  );

  return sendRecordedChanges(profileIndex, accountId, recorded);
}

export async function deleteWatchProgressFromNuvio(
  harborProfileId: string | number | undefined,
  contentId: string,
  progressKey?: string,
  season?: number | null,
  episode?: number | null,
): Promise<boolean> {
  if (!isNuvioSignedIn()) return false;
  const accountId = getNuvioAccountId();
  if (!accountId) return false;

  const profileIndex = resolveNuvioProfileIndex(harborProfileId);
  const normalizedContentId = contentId.trim();
  if (!normalizedContentId) return false;

  const cleanId = normalizedContentId.replace(/^(series|movie|tmdb):/, "").trim();
  const idVariants = Array.from(
    new Set([normalizedContentId, cleanId, `tmdb:${cleanId}`, `series:${cleanId}`]),
  );

  // 1. Immediately harvest known keys and prune local caches for 0ms snappy UI
  const keysToDelete = new Set<string>();
  if (progressKey) keysToDelete.add(progressKey);
  for (const vid of idVariants) {
    keysToDelete.add(vid);
    if (season != null && episode != null) {
      keysToDelete.add(`${vid}_s${season}e${episode}`);
      keysToDelete.add(`${vid}:${season}:${episode}`);
    }
  }

  try {
    const cached = readCachedWatchProgress(profileIndex);
    for (const entry of cached) {
      if (idVariants.includes(entry.content_id)) {
        if (entry.progress_key) keysToDelete.add(entry.progress_key);
        if (entry.season != null && entry.episode != null) {
          for (const vid of idVariants) {
            keysToDelete.add(`${vid}_s${entry.season}e${entry.episode}`);
            keysToDelete.add(`${vid}:${entry.season}:${entry.episode}`);
          }
        }
      }
    }
    const filtered = cached.filter(
      (p) => !keysToDelete.has(p.progress_key) && !idVariants.includes(p.content_id),
    );
    writeCachedWatchProgress(profileIndex, filtered);
  } catch {}

  // Prune local CW, resume states, and playback items for this content across all scopes and variants
  for (const vid of idVariants) {
    clearLocalCw(vid, `nuvio-${profileIndex}`);
    clearResume(vid, undefined, undefined, `nuvio-${profileIndex}`);
  }

  try {
    const existing = readCachedNuvioPlaybackItems(profileIndex);
    if (existing.length > 0) {
      const filteredItems = existing.filter((i: any) => !idVariants.includes(i._id));
      writeCachedNuvioPlaybackItems(profileIndex, filteredItems);
    }
    localStorage.removeItem(`harbor.nuvio.playback_items.slot.${profileIndex}`);
  } catch {}

  // Dispatch events to notify all UI stores immediately
  window.dispatchEvent(
    new CustomEvent("harbor:nuvio-progress-deleted", {
      detail: { profileIndex, contentId: normalizedContentId, keys: Array.from(keysToDelete) },
    }),
  );
  window.dispatchEvent(new CustomEvent("harbor:continue-watching-updated"));

  const inClause = idVariants.map((id) => encodeURIComponent(id)).join(",");
  try {
    await nuvioFetch(
      `/rest/v1/watch_progress?profile_id=eq.${profileIndex}&content_id=in.(${inClause})`,
      { method: "DELETE" },
    );
  } catch (err) {
    console.warn("[nuvio-sync] table delete error:", err);
  }

  const recorded = recordPending(
    profileIndex,
    accountId,
    "progress",
    idVariants.map((id) => ({
      profile_id: profileIndex,
      content_id: id,
      progress_key: id,
      season: null,
      episode: null,
    })),
    true,
  );

  const delivered = await sendRecordedChanges(profileIndex, accountId, recorded);
  if (
    isNuvioSignedIn() &&
    getNuvioAccountId() === accountId &&
    getNuvioActiveSlot() === profileIndex
  )
    await dismissNextUpInNuvioCloud(profileIndex, normalizedContentId, season, episode);
  return delivered;
}

function reconcileNuvioProgressHistory(
  previous: NuvioWatchProgress[],
  items: NuvioWatchProgress[],
  profileIndex: number,
  completeSnapshot: boolean,
): Set<string> {
  const byCoordinate = new Map(items.map((item, i) => [coordinate(item), i]));
  const ownerId = `nuvio-${profileIndex}`;
  const resume = createResumeReader(ownerId);
  const staleResume: Array<{ id: string; season?: number | null; episode?: number | null }> = [];
  for (const prev of previous) {
    const index = byCoordinate.get(coordinate(prev));
    const local = resume(prev.content_id, prev.season ?? undefined, prev.episode ?? undefined);
    const newerResume =
      local &&
      local.source !== "nuvio" &&
      local.t > Math.max(progressTime(prev), index != null ? progressTime(items[index]) : 0);
    if (newerResume) {
      const row = {
        ...prev,
        progress_seconds: local.ms / 1000,
        last_watched: local.t,
        updated_at: new Date(local.t).toISOString(),
      };
      if (index != null) items[index] = row;
      else items.push(row);
    } else if (index != null) {
      if (progressTime(prev) > progressTime(items[index])) items[index] = prev;
    } else if (!completeSnapshot) {
      items.push(prev);
    } else {
      staleResume.push({
        id: prev.content_id,
        season: prev.season ?? null,
        episode: prev.episode ?? null,
      });
    }
  }
  // One map rewrite per storage key instead of one per removed episode/content.
  clearResumeBatch(staleResume, ownerId);
  const contentIds = new Set(items.map((item) => item.content_id));
  const removedIds = new Set(previous.map((row) => row.content_id));
  const staleContent: string[] = [];
  for (const id of removedIds) {
    if (!contentIds.has(id)) staleContent.push(id);
  }
  clearLocalCwBatch(staleContent, ownerId);
  return contentIds;
}

function saveLatestNuvioLocalProgress(items: NuvioWatchProgress[], profileIndex: number): void {
  // Callers sort newest first. Local CW stores one checkpoint per content ID.
  const saved = new Set<string>();
  for (const item of items) {
    if (!item.content_id || saved.has(item.content_id)) continue;
    saved.add(item.content_id);
    const local = localCwEntry(item.content_id, false, `nuvio-${profileIndex}`);
    if (local && local.t > progressTime(item)) continue;
    saveLocalCw(
      {
        id: item.content_id,
        type: item.season != null && item.episode != null ? "series" : "movie",
        name: item.name || item.title || item.content_id,
        poster: item.poster || undefined,
        background: item.background || undefined,
        season: item.season ?? undefined,
        episode: item.episode ?? undefined,
        positionMs: (item.progress_seconds || 0) * 1000,
        durationMs: (item.duration_seconds || 0) * 1000,
        t: item.last_watched || (item.updated_at ? Date.parse(item.updated_at) : Date.now()),
      },
      `nuvio-${profileIndex}`,
    );
  }
}

/**
 * Pulls watch progress for the specified profile from Nuvio.
 * Caches records per profile slot and safely falls back to local cache if network drops.
 */
const progressPullInflight = new Map<string, Promise<NuvioWatchProgress[]>>();

export function pullWatchProgressFromNuvio(
  harborProfileId?: string | number,
): Promise<NuvioWatchProgress[]> {
  if (!isNuvioSignedIn() || !isNuvioProviderActive()) return Promise.resolve([]);
  const accountId = getNuvioAccountId();
  if (!accountId) return Promise.resolve([]);
  const slot = resolveNuvioProfileIndex(harborProfileId);
  const activeSlot = resolveNuvioProfileIndex();
  const key = `${accountId}:${slot}:${activeSlot}`;
  const existing = progressPullInflight.get(key);
  if (existing) return existing;
  const stillCurrent = () =>
    isNuvioSignedIn() &&
    isNuvioProviderActive() &&
    getNuvioAccountId() === accountId &&
    resolveNuvioProfileIndex() === activeSlot;
  const work = pullWatchProgressOnce(slot, accountId, stillCurrent);
  progressPullInflight.set(key, work);
  void work
    .finally(() => {
      if (progressPullInflight.get(key) === work) progressPullInflight.delete(key);
    })
    .catch(() => {});
  return work;
}

async function pullWatchProgressOnce(
  slot: number,
  accountId: string,
  stillCurrent: () => boolean,
): Promise<NuvioWatchProgress[]> {
  const startedAt = Date.now();
  const pending = readPending(slot, accountId);
  let raw: unknown[] | null = null;
  let complete = false;
  try {
    const res = await nuvioFetch("/rest/v1/rpc/sync_pull_watch_progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_profile_id: slot }),
    });
    if (!stillCurrent()) return [];
    if (res.ok) {
      const rows: unknown = await res.json();
      if (Array.isArray(rows) && rows.every((row) => validRow(row, slot, accountId))) raw = rows;
    }
  } catch {
    // The table snapshot can still provide an authoritative response.
  }
  if (!stillCurrent()) return [];
  const rpcRows = raw;
  const rpcCoordinates = new Set((rpcRows ?? []).map((row) => coordinate(row as NuvioCoordinate)));
  const needsConfirmation = Object.values(readPending(slot, accountId)).some(
    (change) =>
      change.kind === "progress" && (change.deleted || !rpcCoordinates.has(coordinate(change.row))),
  );
  const fullSyncKey = `${accountId}:${slot}`;
  const lastFullSync = lastFullSyncAt.get(fullSyncKey) ?? 0;
  const fullSyncDue = !lastFullSync || Date.now() - lastFullSync >= FULL_SYNC_INTERVAL_MS;
  // Routine pulls only merge the latest RPC batch. A full snapshot is needed to
  // prune remote deletions, so it is throttled and forced by pending mutations.
  if (!rpcRows || needsConfirmation || fullSyncDue) {
    try {
      const table = await readTableSnapshot<NuvioWatchProgress>(
        "watch_progress",
        slot,
        accountId,
        stillCurrent,
        rpcRows?.length === 0,
      );
      if (table) {
        // A table that contradicts the RPC batch is not an authoritative
        // snapshot. Keep the RPC/cached history instead of pruning it.
        const tableCoordinates = new Set(table.map((row) => coordinate(row)));
        const consistent =
          !rpcRows ||
          rpcRows.every((row) => tableCoordinates.has(coordinate(row as NuvioCoordinate)));
        if (consistent) {
          raw = table;
          complete = true;
          lastFullSyncAt.set(fullSyncKey, Date.now());
        } else {
          console.warn(
            "[nuvio-sync] table snapshot does not match the RPC batch; keeping cached history",
          );
        }
      }
    } catch {
      // The RPC batch remains valid when the table snapshot drops offline.
    }
  }

  if (!stillCurrent()) return [];
  if (!raw || (raw.length === 0 && !complete)) return readCachedWatchProgress(slot, accountId);

  const previous = readCachedWatchProgress(slot, accountId);
  const byCoordinate = new Map(previous.map((row) => [coordinate(row), row]));
  const rows: NuvioWatchProgress[] = [];
  for (const value of raw) {
    const item = value as NuvioWatchProgress & { position?: number; duration?: number };
    const prev = byCoordinate.get(coordinate(item));
    const time = progressTime(item);
    const progress = Math.max(
      0,
      Math.round(
        item.position != null ? Number(item.position) / 1000 : Number(item.progress_seconds) || 0,
      ),
    );
    const duration = Math.max(
      0,
      Math.round(
        item.duration != null ? Number(item.duration) / 1000 : Number(item.duration_seconds) || 0,
      ),
    );
    if (!Number.isFinite(progress) || !Number.isFinite(duration)) return previous;
    rows.push({
      ...item,
      profile_id: slot,
      progress_key: item.progress_key || item.content_id,
      progress_seconds: progress,
      duration_seconds: duration,
      last_watched: time,
      updated_at: time ? new Date(time).toISOString() : prev?.updated_at,
      title: item.title || item.name || prev?.title || prev?.name,
      name: item.name || item.title || prev?.name || prev?.title,
      poster: item.poster || prev?.poster,
      background: item.background || prev?.background,
    });
  }
  const merged = applyPending(rows, slot, accountId, "progress", complete, pending);
  const allowedPrevious = previous.filter(
    (row) => !merged.deleted.some((change) => matchesChange(row, change)),
  );
  const items = merged.items;
  const ownerId = `nuvio-${slot}`;
  const newestByContent = new Map<string, number>();
  for (const row of [...items, ...allowedPrevious]) {
    newestByContent.set(
      row.content_id,
      Math.max(newestByContent.get(row.content_id) ?? 0, progressTime(row)),
    );
  }
  // Native playback may have saved a newer checkpoint before its throttled push.
  for (const local of listLocalCw(false, ownerId)) {
    if (
      merged.deleted.some((change) =>
        matchesChange(
          {
            content_id: local.id,
            season: local.season,
            episode: local.episode,
            last_watched: local.t,
          } as NuvioWatchProgress,
          change,
        ),
      )
    )
      continue;
    const newest = newestByContent.get(local.id) ?? 0;
    if (local.t <= newest || (!newestByContent.has(local.id) && local.t <= startedAt)) continue;
    const localRow: NuvioWatchProgress = {
      profile_id: slot,
      content_id: local.id,
      progress_key:
        local.season != null && local.episode != null
          ? `${local.id}_s${local.season}e${local.episode}`
          : local.id,
      season: local.season,
      episode: local.episode,
      progress_seconds: local.positionMs / 1000,
      duration_seconds: local.durationMs / 1000,
      last_watched: local.t,
      updated_at: new Date(local.t).toISOString(),
      name: local.name,
      poster: local.poster,
      background: local.background,
    };
    const index = items.findIndex((row) => coordinate(row) === coordinate(localRow));
    if (index >= 0) items[index] = localRow;
    else items.push(localRow);
  }
  const ids = reconcileNuvioProgressHistory(allowedPrevious, items, slot, complete);
  if (!stillCurrent()) return [];
  items.sort((a, b) => progressTime(b) - progressTime(a));
  writeCachedWatchProgress(slot, items, accountId);
  try {
    const playback = readCachedNuvioPlaybackItems(slot, accountId);
    writeCachedNuvioPlaybackItems(
      slot,
      playback.filter(
        (row) =>
          row.upNext === true ||
          ids.has(row._id) ||
          ids.has(row._id.replace(/^(series|movie|tmdb):/, "")),
      ),
      accountId,
    );
    localStorage.removeItem(`harbor.nuvio.playback_items.slot.${slot}`);
  } catch {
    // A disposable playback cache cannot reject a verified progress snapshot.
  }
  saveLatestNuvioLocalProgress(items, slot);
  const state = loadNuvioState();
  if (state.session?.user?.id === accountId) saveNuvioState({ ...state, lastSyncedAt: Date.now() }, { silent: true });
  window.dispatchEvent(
    new CustomEvent("harbor:nuvio-progress-reconciled", {
      detail: { profileIndex: slot, count: items.length },
    }),
  );
  return items;
}

/**
 * Cached Nuvio Addon storage helpers
 */
const memoryAddonCache = new Map<string, NuvioAddonItem[]>();

function getNuvioAddonsCacheKey(slot?: number, accountId?: string): string {
  const acc = accountId || getNuvioAccountId() || "default";
  return `harbor.nuvio.addons.v1.${acc}.slot.${slot ?? 1}`;
}

export function readCachedNuvioAddons(slot?: number, accountId?: string): NuvioAddonItem[] {
  const key = getNuvioAddonsCacheKey(slot, accountId);
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (!raw) return memoryAddonCache.get(key) || [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NuvioAddonItem[]) : [];
  } catch {
    return memoryAddonCache.get(key) || [];
  }
}

export function writeCachedNuvioAddons(
  slot: number,
  items: NuvioAddonItem[],
  accountId?: string,
): void {
  const key = getNuvioAddonsCacheKey(slot, accountId);
  memoryAddonCache.set(key, items);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, JSON.stringify(items));
    }
  } catch {}
}

export function clearCachedNuvioAddons(): void {
  memoryAddonCache.clear();
  try {
    if (typeof localStorage === "undefined") return;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("harbor.nuvio.addons.v1.")) {
        toRemove.push(key);
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
}

/**
 * Pulls addons for the specified profile from Nuvio.
 * If uses_primary_addons is enabled on this profile, pulls profile 1's addons.
 */
export async function pullAddonsFromNuvio(
  harborProfileId?: string | number,
): Promise<NuvioAddonItem[]> {
  if (!isNuvioSignedIn()) return [];

  const profileIndex = resolveEffectiveNuvioAddonSlot(harborProfileId);

  try {
    const res = await nuvioFetch(
      `/rest/v1/addons?profile_id=eq.${profileIndex}&order=sort_order.asc`,
    );

    if (!res.ok) {
      console.warn(
        `[nuvio] failed to pull addons (status ${res.status}) for profile ${profileIndex}`,
      );
      return readCachedNuvioAddons(profileIndex);
    }

    const list = (await res.json()) as NuvioAddonItem[];
    const safeList = Array.isArray(list) ? list : [];
    writeCachedNuvioAddons(profileIndex, safeList);
    return safeList;
  } catch (err) {
    console.warn("[nuvio] failed to pull addons", err);
    return readCachedNuvioAddons(profileIndex);
  }
}

const NUVIO_MANIFEST_CACHE_PREFIX = "harbor.nuvio.manifest_cache.v1.";

function getCachedNuvioManifest(url: string): Addon["manifest"] | null {
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(`${NUVIO_MANIFEST_CACHE_PREFIX}${url}`)
        : null;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCachedNuvioManifest(url: string, manifest: Addon["manifest"]): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(`${NUVIO_MANIFEST_CACHE_PREFIX}${url}`, JSON.stringify(manifest));
    }
  } catch {}
}

/**
 * Resolves full Harbor Addon objects from Nuvio for the given profile.
 * Falls back to cache if network is unavailable or slow.
 */
export async function fetchNuvioAddons(harborProfileId?: string | number): Promise<Addon[]> {
  if (!isNuvioSignedIn()) return [];

  const profileIndex = resolveEffectiveNuvioAddonSlot(harborProfileId);
  const cachedItems = readCachedNuvioAddons(profileIndex);
  let items = cachedItems;

  try {
    const fresh = await pullAddonsFromNuvio(profileIndex);
    if (fresh.length > 0 || cachedItems.length === 0) {
      items = fresh;
    }
  } catch {
    // Keep cachedItems
  }

  const activeItems = items.filter((n) => n.enabled !== false);
  if (activeItems.length === 0) return [];

  const addons: Addon[] = await Promise.all(
    activeItems.map(async (n): Promise<Addon> => {
      const cached = getCachedNuvioManifest(n.url);
      if (cached) {
        return {
          transportUrl: n.url,
          manifest: cached,
        };
      }
      let manifest: Addon["manifest"] = {
        id: n.url,
        name: n.name || "Addon",
      };
      try {
        const fetched = await fetchManifestAt(n.url);
        if (fetched) {
          manifest = fetched;
          setCachedNuvioManifest(n.url, fetched);
        }
      } catch {}
      return {
        transportUrl: n.url,
        manifest,
      };
    }),
  );

  recordNuvioAddons(addons);
  return addons;
}

/**
 * Pushes installed addons to Nuvio using the `sync_push_addons` RPC
 */
export async function pushAddonsToNuvio(
  harborProfileId: string | number,
  addons: NuvioAddonItem[],
): Promise<boolean> {
  if (!isNuvioSignedIn()) return false;

  const profileIndex = resolveEffectiveNuvioAddonSlot(harborProfileId);
  writeCachedNuvioAddons(profileIndex, addons);

  try {
    const clientId = getOrCreateSyncClientId();
    const res = await nuvioFetch("/rest/v1/rpc/sync_push_addons", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_profile_id: profileIndex,
        p_addons: addons,
        p_origin_client_id: clientId,
      }),
    });

    if (res.ok) {
      console.info(
        `[nuvio-sync] addons pushed via RPC for profile ${profileIndex} (${addons.length} addons)`,
      );
      return true;
    }
    return false;
  } catch (err) {
    console.warn("[nuvio] failed to push addons", err);
    return false;
  }
}

/**
 * Adds an addon URL to the effective Nuvio profile's collection and syncs to Nuvio cloud.
 */
export async function addAddonToNuvio(
  harborProfileId: string | number,
  item: { url: string; name?: string },
): Promise<boolean> {
  if (!isNuvioSignedIn()) return false;
  const slot = resolveEffectiveNuvioAddonSlot(harborProfileId);
  const current = readCachedNuvioAddons(slot);
  const existingIdx = current.findIndex((a) => a.url === item.url);
  const updated = [...current];
  if (existingIdx >= 0) {
    updated[existingIdx] = {
      ...updated[existingIdx],
      name: item.name || updated[existingIdx].name,
      enabled: true,
    };
  } else {
    updated.push({
      url: item.url,
      name: item.name || "Addon",
      enabled: true,
      sort_order: updated.length,
    });
  }
  writeCachedNuvioAddons(slot, updated);
  return pushAddonsToNuvio(slot, updated);
}

/**
 * Deletes an addon URL from the effective Nuvio profile's collection and syncs deletion to Nuvio cloud.
 */
export async function deleteAddonFromNuvio(
  harborProfileId: string | number,
  manifestUrl: string,
): Promise<boolean> {
  if (!isNuvioSignedIn()) return false;
  const slot = resolveEffectiveNuvioAddonSlot(harborProfileId);
  const current = readCachedNuvioAddons(slot);
  const remaining = current.filter(
    (a) => a.url !== manifestUrl && !a.url.endsWith(manifestUrl) && !manifestUrl.endsWith(a.url),
  );
  writeCachedNuvioAddons(slot, remaining);

  try {
    // Delete directly from Supabase addons table if permissible
    await nuvioFetch(
      `/rest/v1/addons?profile_id=eq.${slot}&url=eq.${encodeURIComponent(manifestUrl)}`,
      { method: "DELETE" },
    ).catch(() => {});
  } catch {}

  return pushAddonsToNuvio(slot, remaining);
}
