import { useSyncExternalStore } from "react";
import { noteNotify } from "./render-cause";
import { clearResume, readResumeEntry } from "./resume";
import { setItemWithRecovery } from "./storage-recovery";
import { episodeFromVideoId, type LibraryItem } from "./stremio";
import { cloudLibraryPut } from "./stremio-write-queue";
import { privateCwProfileId } from "./cw-profile";
import { isNuvioSignedIn } from "./nuvio/nuvio-client";
import { removeExternalCwItem } from "@/lib/feed/external-cw";
import {
  deleteWatchProgressFromNuvio,
  dismissNextUpInNuvioCloud,
  isNuvioProviderActive,
  resolveNuvioProfileIndex,
} from "./nuvio/nuvio-sync";
import { clearLocalCw } from "./local-cw";
import { loadStoredSettings } from "@/lib/settings/load";
import {
  clearProviderPlayback,
  type CwProviderSource,
  type ProviderDismissResult,
} from "./cw-provider-dismiss";

const SIMKL_KEY = "harbor.cw.dismissed.simkl";
const DISMISS_KEY = "harbor.cw.dismissed.v1";
const PRIVATE_PREFIX = "harbor.cw.dismissed.private.v1.";
const MIGRATION_KEY = "harbor.cw.dismissed.private-migrated.v1";
let loadedKey: string | null = null;
const dismissed = new Map<string, number>();
const dismissedVid = new Map<string, string>();
const dismissedPos = new Map<string, { s?: number; e?: number; p: number }>();
const listeners = new Set<() => void>();
let version = 0;

function migratePrivateDismissals(): void {
  try {
    if (localStorage.getItem(MIGRATION_KEY)) return;
    const roster = JSON.parse(localStorage.getItem("harbor.profiles.v1") ?? "null");
    if (!Array.isArray(roster?.profiles) || !roster.profiles.length) return;
    // The old store applied to every existing profile. Snapshot it once for
    // those profiles, preserving newer private stores (including explicit {}).
    // Profiles created after migration must not inherit someone else's choices.
    const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "{}");
    const now = Date.now();
    const seed: Record<string, unknown> = Array.isArray(raw)
      ? Object.fromEntries(raw.filter((id) => typeof id === "string").map((id) => [id, now]))
      : raw && typeof raw === "object"
        ? raw
        : {};
    const simkl = JSON.parse(localStorage.getItem(SIMKL_KEY) ?? "[]");
    if (Array.isArray(simkl))
      for (const id of simkl) {
        if (typeof id !== "string" || !id) continue;
        const key = id.startsWith("simkl|") ? id : `simkl|${id}`;
        if (!Object.hasOwn(seed, key)) seed[key] = now;
      }
    const encoded = JSON.stringify(seed);
    for (const profile of roster.profiles) {
      if (typeof profile?.id !== "string" || !profile.id) continue;
      const key = PRIVATE_PREFIX + profile.id;
      if (localStorage.getItem(key) == null) {
        setItemWithRecovery(key, encoded);
        if (localStorage.getItem(key) !== encoded) return;
      }
    }
    setItemWithRecovery(MIGRATION_KEY, "1");
  } catch {
    // Keep the original data intact if storage is unavailable or malformed.
  }
}

function loadDismissed(): void {
  migratePrivateDismissals();
  const profileId = privateCwProfileId();
  const key = profileId ? PRIVATE_PREFIX + profileId : DISMISS_KEY;
  if (key === loadedKey) return;
  loadedKey = key;
  dismissed.clear();
  dismissedVid.clear();
  dismissedPos.clear();
  const loadNow = Date.now();
  const add = (k: string, ms: number) => {
    const prev = dismissed.get(k);
    if (prev == null || ms > prev) dismissed.set(k, ms);
  };
  let legacy = false;
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null");
    if (Array.isArray(raw)) {
      for (const v of raw) if (typeof v === "string") add(v, loadNow);
      legacy = true;
    } else if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "number") {
          add(k, v);
        } else if (v && typeof v === "object") {
          const t = (v as { t?: unknown }).t;
          if (typeof t === "number") {
            add(k, t);
            const o = v as { v?: unknown; s?: unknown; e?: unknown; p?: unknown };
            if (typeof o.v === "string" && o.v) dismissedVid.set(k, o.v);
            if (typeof o.p === "number" && Number.isFinite(o.p)) {
              dismissedPos.set(k, {
                s: typeof o.s === "number" ? o.s : undefined,
                e: typeof o.e === "number" ? o.e : undefined,
                p: o.p,
              });
            }
          }
        }
      }
    }
  } catch {}
  try {
    const raw = JSON.parse(profileId ? "[]" : (localStorage.getItem(SIMKL_KEY) ?? "[]"));
    const arr = Array.isArray(raw) ? (raw as string[]) : [];
    for (const v of arr) {
      if (typeof v !== "string" || !v) continue;
      const key = v.startsWith("simkl|") ? v : `simkl|${v}`;
      if (!dismissed.has(key)) add(key, loadNow);
    }
    if (arr.length > 0) {
      localStorage.removeItem(SIMKL_KEY);
      legacy = true;
    }
  } catch {}
  if (legacy) persistDismissed();
}

function persistDismissed(
  times = dismissed,
  videos = dismissedVid,
  acknowledged = false,
  positions = dismissedPos,
): void {
  try {
    const out: Record<
      string,
      number | { t: number; v?: string; s?: number; e?: number; p?: number }
    > = {};
    for (const [k, t] of times) {
      const v = videos.get(k);
      const pos = positions.get(k);
      if (v || pos) {
        out[k] = { t };
        if (v) out[k].v = v;
        if (pos) {
          if (pos.s !== undefined) out[k].s = pos.s;
          if (pos.e !== undefined) out[k].e = pos.e;
          out[k].p = pos.p;
        }
      } else {
        out[k] = t;
      }
    }
    const saved = setItemWithRecovery(loadedKey ?? DISMISS_KEY, JSON.stringify(out));
    if (acknowledged && !saved) throw new Error("Storage could not save this dismissal.");
  } catch (error) {
    if (acknowledged)
      throw new Error("Could not save the change. Check available storage and try again.", {
        cause: error,
      });
  }
}

function emit(): void {
  version += 1;
  noteNotify("store:cw-dismiss");
  listeners.forEach((l) => l());
}

function parseMs(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const p = Date.parse(String(v ?? ""));
  return Number.isFinite(p) ? p : 0;
}

function resolveEpisode(item: LibraryItem): { season?: number; episode?: number } {
  const vid = item.state?.video_id ?? "";
  const kitsuThreeSeg = /^(kitsu|mal|anilist|anidb):/.test(item._id) && vid.split(":").length === 3;
  const se = kitsuThreeSeg ? null : episodeFromVideoId(item.state?.video_id);
  return {
    season: item.state?.season ?? (kitsuThreeSeg ? 1 : se?.season),
    episode: item.state?.episode ?? (kitsuThreeSeg ? Number(vid.split(":")[2]) : se?.episode),
  };
}

function itemActivity(item: LibraryItem): number {
  const t = Math.max(parseMs(item._mtime), parseMs(item.state?.lastWatched));
  const { season, episode } = resolveEpisode(item);
  const entry = readResumeEntry(item._id, season, episode);
  // Harbor's own resume (and external playback imports) write `harbor.resume` with
  // t=Date.now() without touching the Stremio cloud _mtime, so it must join the max
  // instead of being a fallback. Otherwise a same-episode resume after dismiss keeps
  // returning the dismissal-time _mtime and never un-dismisses.
  return Math.max(t, entry?.t ?? 0);
}

function progressRatio(item: LibraryItem): number {
  const duration = item.state?.duration ?? 0;
  if (!(duration > 0)) return 0;
  const { season, episode } = resolveEpisode(item);
  const entry = readResumeEntry(item._id, season, episode);
  const pct = entry?.pct;
  const resumeMs =
    typeof pct === "number" && Number.isFinite(pct) ? pct * duration : (entry?.ms ?? 0);
  return Math.min(1, Math.max(item.state?.timeOffset ?? 0, resumeMs) / duration);
}

// A dismissal is lifted only by moving forward. An entry reporting an earlier episode
// than the one dismissed - a stale tracker copy, or a sibling entry sharing the same id -
// is not new progress, so it must stay hidden instead of resurfacing.
function isEpisodeAhead(
  current: { season?: number; episode?: number },
  dismissed: { season?: number; episode?: number },
): boolean | null {
  const { season: cs, episode: ce } = current;
  const { season: ds, episode: de } = dismissed;
  if (cs == null || ce == null || ds == null || de == null) return null;
  if (
    !Number.isFinite(cs) ||
    !Number.isFinite(ce) ||
    !Number.isFinite(ds) ||
    !Number.isFinite(de)
  ) {
    return null;
  }
  if (cs !== ds) return cs > ds;
  return ce > de;
}

// A title can arrive with more than one provider id; a dismissal of any of them
// must keep the same card hidden when the source changes.
function itemIds(item: LibraryItem): string[] {
  const ids = [item._id];
  const seen = new Set<string>([item._id]);
  for (const id of item.altIds ?? []) {
    if (typeof id === "string" && id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function groupedDismissalKey(
  source: string,
  id: string,
  videoId: string | undefined,
  season?: number,
  episode?: number,
): string {
  return `group|${encodeURIComponent(source)}|${encodeURIComponent(id)}|${encodeURIComponent(videoId ?? "")}|${season ?? "?"}|${episode ?? "?"}`;
}

function dismissalSource(item: LibraryItem): string {
  return item.external ?? (item.local ? "local" : "library");
}

/**
 * Source-scoped checkpoint for a deduped card. Unlike the exact grouped key,
 * this survives a provider changing its video id for the same episode and lets
 * an older episode stay hidden after the card was dismissed at a later one.
 */
function groupedSourceDismissalKey(source: string, id: string): string {
  return `group-source|${encodeURIComponent(source)}|${encodeURIComponent(id)}`;
}

type DismissCheckpoint = { s?: number; e?: number; p: number };

/** Keep the furthest checkpoint when a stale source copy is dismissed later. */
function furthestCheckpoint(
  previous: DismissCheckpoint | undefined,
  previousVideo: string | undefined,
  next: DismissCheckpoint,
  nextVideo: string | undefined,
): { pos: DismissCheckpoint; video: string | undefined } {
  if (!previous) return { pos: next, video: nextVideo };
  const previousRank =
    previous.s != null && previous.e != null ? previous.s * 100_000 + previous.e : -1;
  const nextRank = next.s != null && next.e != null ? next.s * 100_000 + next.e : -1;
  if (previousRank > nextRank || (previousRank === nextRank && previous.p > next.p)) {
    return { pos: previous, video: previousVideo ?? nextVideo };
  }
  return { pos: next, video: nextVideo };
}

function isDismissedCheckpoint(
  item: LibraryItem,
  dismissedAt: number,
  dismissedVid: string | undefined,
  pos: DismissCheckpoint | undefined,
): boolean {
  const { season, episode } = resolveEpisode(item);
  const resume = readResumeEntry(item._id, season, episode);
  // Only real playback can lift a checkpoint dismissal. `_mtime` also moves for
  // library maintenance (name repair, cloud re-save, server clock skew), and
  // treating that as new progress is what made dismissed cards return.
  const playbackActivity = Math.max(parseMs(item.state?.lastWatched), resume?.t ?? 0);
  const activity =
    pos != null ? playbackActivity : Math.max(playbackActivity, parseMs(item._mtime));
  if (activity > dismissedAt) return false;
  const curVid = item.state?.video_id;
  // Further-ahead position on the same episode un-dismisses even when its timestamp
  // predates the dismissal (e.g. dismissed after watching elsewhere).
  if (pos != null && progressRatio(item) > pos.p + 0.01) {
    if (season === pos.s && episode === pos.e) return false;
  }
  if (dismissedVid && typeof curVid === "string" && curVid) {
    if (dismissedVid !== curVid) {
      const ahead = isEpisodeAhead(
        episodeFromVideoId(curVid) ?? {},
        episodeFromVideoId(dismissedVid) ?? {},
      );
      if (ahead === null || ahead) return false;
    }
  } else if (pos != null) {
    if (season !== pos.s || episode !== pos.e) {
      const ahead = isEpisodeAhead({ season, episode }, { season: pos.s, episode: pos.e });
      if (ahead === null || ahead) return false;
    }
  }
  return true;
}

function isGroupedCheckpointDismissed(item: LibraryItem): boolean {
  const { season, episode } = resolveEpisode(item);
  const ids = itemIds(item);
  const videoId = item.state?.video_id;
  const source = dismissalSource(item);
  const exactKeys = [
    groupedDismissalKey(source, ids[0], videoId, season, episode),
    ...ids.slice(1).map((id) => groupedDismissalKey(source, id, videoId, season, episode)),
  ];
  const sourceKeys = ids.map((id) => groupedSourceDismissalKey(source, id));
  let dismissedAt = -1;
  let dismissedVideo: string | undefined;
  let pos: { s?: number; e?: number; p: number } | undefined;
  for (const key of [...exactKeys, ...sourceKeys]) {
    const at = dismissed.get(key);
    if (at == null || at < dismissedAt) continue;
    if (at > dismissedAt) {
      dismissedAt = at;
      dismissedVideo = dismissedVid.get(key);
      pos = dismissedPos.get(key);
    } else {
      // Exact and source keys are written together; prefer whichever carries
      // the richer checkpoint when they share the dismissal timestamp.
      dismissedVideo ??= dismissedVid.get(key);
      pos ??= dismissedPos.get(key);
    }
  }
  if (dismissedAt < 0) return false;
  return isDismissedCheckpoint(item, dismissedAt, dismissedVideo, pos);
}

export function isCwDismissed(item: LibraryItem): boolean {
  loadDismissed();
  if (isGroupedCheckpointDismissed(item)) return true;
  let dismissedAt = -1;
  let dismissedId = item._id;
  for (const id of itemIds(item)) {
    const plain = dismissed.get(id);
    const ext = item.external ? dismissed.get(`${item.external}|${id}`) : undefined;
    const at = Math.max(plain ?? -1, ext ?? -1);
    if (at > dismissedAt) {
      dismissedAt = at;
      dismissedId = id;
    }
  }
  if (dismissedAt < 0) return false;
  return isDismissedCheckpoint(
    item,
    dismissedAt,
    dismissedVid.get(dismissedId),
    dismissedPos.get(dismissedId),
  );
}

type CleanupOptions = { acknowledged?: boolean };

function clearResumeForItem(item: LibraryItem, options: CleanupOptions): void {
  const { season, episode } = resolveEpisode(item);
  clearResume(item._id, season, episode, options);
}

/**
 * Clean up one source represented by a deduped card. The grouped dismissal
 * checkpoints hide the card locally; this keeps the same source records that a
 * single-card dismissal clears from lingering on the Stremio cloud, Nuvio, or
 * local stores.
 */
function cleanupGroupedSource(
  item: LibraryItem,
  authKey: string | null,
  options: CleanupOptions,
  now: string,
  cloudIds: Set<string>,
): Promise<boolean> | null {
  const id = item._id;
  if (!id) return null;
  const nuvio =
    item.external === "nuvio" ||
    (!item.local && !item.external && isNuvioSignedIn() && isNuvioProviderActive());
  if (nuvio) {
    clearResumeForItem(item, options);
    try {
      const slot = resolveNuvioProfileIndex();
      clearLocalCw(id, `nuvio-${slot}`, options);
      clearLocalCw(id, options);
      const { season, episode } = resolveEpisode(item);
      const write = deleteWatchProgressFromNuvio(slot, id, undefined, season, episode);
      if (write && typeof write.then === "function") {
        return write.then((ok) => ok !== false);
      }
      return null;
    } catch {
      return null;
    }
  }
  if (item.local) {
    clearLocalCw(id, options);
    return null;
  }
  if (item.external) {
    clearResumeForItem(item, options);
    return null;
  }
  if (!authKey || !item.state || privateCwProfileId()) return null;
  clearResumeForItem(item, options);
  if (cloudIds.has(id)) return null;
  cloudIds.add(id);
  return cloudLibraryPut(
    authKey,
    { ...item, state: { ...item.state, timeOffset: 0 }, _mtime: now },
    options,
  );
}

export type CwDismissResult = {
  sync: "not-required" | "synced" | "queued";
  providerFailures?: CwProviderSource[];
};

function providerDismissSources(): CwProviderSource[] {
  try {
    if (privateCwProfileId()) return [];
    const settings = loadStoredSettings();
    if (settings.cwClearProviderProgress !== true) return [];
    // Clearing is independent of which sources feed the row. A tracker can be
    // connected for scrobbling while its cards are hidden, and its stale resume
    // point would otherwise survive the dismissal.
    return ["trakt", "simkl", "publicmetadb"];
  } catch {
    return [];
  }
}

function sameProviderCheckpoint(a: LibraryItem, b: LibraryItem): boolean {
  const aEp = resolveEpisode(a);
  const bEp = resolveEpisode(b);
  // Deleting provider progress is irreversible: an unknown episode must be
  // resolved through a fresh lookup, never guessed from a stale member.
  if (aEp.season == null || aEp.episode == null) return false;
  if (bEp.season == null || bEp.episode == null) return false;
  return aEp.season === bEp.season && aEp.episode === bEp.episode;
}

function providerSourceOf(item: LibraryItem): CwProviderSource | null {
  return item.external === "trakt" || item.external === "simkl" || item.external === "publicmetadb"
    ? item.external
    : null;
}

/**
 * Provider pause times can come from another device's clock. Trust a little
 * skew so a late copy stays covered, but never enough to hide real progress
 * for hours after the dismissal.
 */
const DISMISS_CLOCK_SKEW_MS = 5 * 60_000;

function dismissalNow(item: LibraryItem, members: readonly LibraryItem[]): number {
  const latest = Math.max(Date.now(), itemActivity(item), ...members.map(itemActivity));
  return Math.min(latest, Date.now() + DISMISS_CLOCK_SKEW_MS);
}

function providerFailureList(results: ProviderDismissResult[]): CwProviderSource[] {
  return [...new Set(results.flatMap((result) => result.failed))];
}

export function dismissCw(item: LibraryItem, authKey: string | null): void;
export function dismissCw(
  item: LibraryItem,
  authKey: string | null,
  options: { acknowledged: true },
): Promise<CwDismissResult>;
export function dismissCw(
  item: LibraryItem,
  authKey: string | null,
  options: { acknowledged?: boolean } = {},
): void | Promise<CwDismissResult> {
  loadDismissed();
  const providerSources = providerDismissSources();
  const members = (item as LibraryItem & { cwMembers?: LibraryItem[] }).cwMembers;
  if (members?.length) {
    // A provider's pause time can be ahead of the local clock. The dismissal
    // must cover every member's activity or the hidden survivor's member
    // reappears as a fresh card after its checkpoint is filtered out.
    const nowMs = dismissalNow(item, members);
    const now = new Date(nowMs).toISOString();
    const times = new Map(dismissed);
    const videos = new Map(dismissedVid);
    const positions = new Map(dismissedPos);
    // A deduped card represents several independent library records. Store each
    // observed checkpoint locally so a provider-specific survivor cannot resurface.
    // Include the visible survivor's current state: up-next may have advanced it
    // beyond every source member retained by deduplication.
    //
    // The exact keys are checkpoint-scoped. The source keys are needed so a
    // provider that later changes its video id, or a stale source copy reporting
    // an earlier episode, is still compared against the dismissed checkpoint
    // rather than resurfacing just because the exact key is missing.
    type SourceCheckpoint = {
      rank: number;
      p: number;
      checkpoint?: DismissCheckpoint;
      video?: string;
    };
    // A later dismissal may arrive from a stale copy. Never lower an existing
    // checkpoint or timestamp, or the more advanced episode resurfaces beneath it.
    const apply = (key: string, checkpoint: DismissCheckpoint | undefined, video?: string) => {
      times.set(key, Math.max(nowMs, dismissed.get(key) ?? 0));
      if (checkpoint) {
        const merged = furthestCheckpoint(
          dismissedPos.get(key),
          dismissedVid.get(key),
          checkpoint,
          video,
        );
        positions.set(key, merged.pos);
        if (merged.video) videos.set(key, merged.video);
        else videos.delete(key);
      } else {
        // No checkpoint to compare; keep any prior one rather than weakening it.
        if (video) videos.set(key, video);
        else videos.delete(key);
      }
    };
    const sourceCheckpoints = new Map<string, SourceCheckpoint>();
    for (const member of [...members, item]) {
      const ids = itemIds(member);
      const { season, episode } = resolveEpisode(member);
      const source = dismissalSource(member);
      const vid = typeof member.state?.video_id === "string" ? member.state.video_id : undefined;
      const keys = ids.map((entryId) => groupedDismissalKey(source, entryId, vid, season, episode));
      const checkpoint = member.state
        ? { s: season, e: episode, p: progressRatio(member) }
        : undefined;
      for (const key of keys) apply(key, checkpoint, vid);

      const rank = season == null || episode == null ? -1 : season * 100_000 + episode;
      for (const entryId of ids) {
        const key = groupedSourceDismissalKey(source, entryId);
        const held = sourceCheckpoints.get(key);
        if (!held || rank > held.rank || (rank === held.rank && (checkpoint?.p ?? 0) >= held.p)) {
          sourceCheckpoints.set(key, {
            rank,
            p: checkpoint?.p ?? 0,
            checkpoint,
            video: vid,
          });
        }
      }
    }
    for (const [key, value] of sourceCheckpoints) {
      apply(key, value.checkpoint, value.video);
    }
    persistDismissed(times, videos, options.acknowledged, positions);
    dismissed.clear();
    dismissedVid.clear();
    dismissedPos.clear();
    for (const [key, value] of times) dismissed.set(key, value);
    for (const [key, value] of videos) dismissedVid.set(key, value);
    for (const [key, value] of positions) dismissedPos.set(key, value);
    emit();

    const providerWrites: Promise<ProviderDismissResult>[] = [];
    if (providerSources.length > 0) {
      // A deduped show can keep an old episode next to the displayed one. Only a
      // member whose episode matches this card may authorize deleting a
      // provider's saved position; a stale member would clear another episode.
      // Providers left without such a member fall back to the fresh lookup in
      // clearProviderPlayback, which verifies the episode before deleting.
      const byProvider = new Map<CwProviderSource, LibraryItem>();
      const itemSource = providerSourceOf(item);
      if (itemSource) byProvider.set(itemSource, item);
      for (const member of members) {
        const source = providerSourceOf(member);
        if (!source || !providerSources.includes(source)) continue;
        if (!sameProviderCheckpoint(item, member)) continue;
        byProvider.set(source, member);
      }
      for (const provider of providerSources) {
        providerWrites.push(clearProviderPlayback(byProvider.get(provider) ?? item, [provider]));
      }
    }

    const cleanupSeen = new Set<string>();
    const cloudIds = new Set<string>();
    const cloudWrites: Promise<boolean>[] = [];
    let cleanupError: unknown;
    for (const member of [item, ...members]) {
      const id = member._id;
      if (!id) continue;
      const { season, episode } = resolveEpisode(member);
      const cleanupKey = `${dismissalSource(member)}|${id}|${season ?? ""}|${episode ?? ""}`;
      if (cleanupSeen.has(cleanupKey)) continue;
      cleanupSeen.add(cleanupKey);
      try {
        const write = cleanupGroupedSource(member, authKey, options, now, cloudIds);
        if (write) cloudWrites.push(write);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (cleanupError) {
      void Promise.allSettled([...cloudWrites, ...providerWrites]);
      throw new Error(
        "Removed from Continue Watching, but the saved position could not be cleared.",
        {
          cause: cleanupError,
        },
      );
    }
    if (!options.acknowledged) {
      void Promise.allSettled([...cloudWrites, ...providerWrites]);
      return;
    }
    return Promise.all([Promise.all(cloudWrites), Promise.all(providerWrites)]).then(
      ([cloudResults, providerResults]) => {
        const providerFailures = providerFailureList(providerResults);
        const sync =
          cloudWrites.length === 0
            ? "not-required"
            : cloudResults.every(Boolean)
              ? "synced"
              : "queued";
        return {
          sync,
          ...(providerFailures.length > 0 ? { providerFailures } : {}),
        };
      },
      () => {
        throw new Error(
          "Removed from Continue Watching on this device, but synchronization could not be saved.",
        );
      },
    );
  }
  const id = item._id;
  const now = new Date().toISOString();
  // Never let a stale copy or a server clock ahead of the local one move the
  // dismissal behind existing progress, and never let it run hours ahead either.
  const nowMs = Math.min(
    Math.max(
      Date.parse(now),
      itemActivity(item),
      ...itemIds(item).map((entryId) => dismissed.get(entryId) ?? 0),
    ),
    Date.now() + DISMISS_CLOCK_SKEW_MS,
  );
  const times = new Map(dismissed);
  const videos = new Map(dismissedVid);
  const positions = new Map(dismissedPos);
  const ids = itemIds(item);
  const dismissVid = typeof item.state?.video_id === "string" ? item.state.video_id : undefined;
  const { season, episode } = resolveEpisode(item);
  const checkpoint = item.state ? { s: season, e: episode, p: progressRatio(item) } : undefined;
  for (const entryId of ids) {
    times.set(entryId, nowMs);
    if (checkpoint) {
      const merged = furthestCheckpoint(
        dismissedPos.get(entryId),
        dismissedVid.get(entryId),
        checkpoint,
        dismissVid,
      );
      positions.set(entryId, merged.pos);
      if (merged.video) videos.set(entryId, merged.video);
      else videos.delete(entryId);
    } else {
      positions.delete(entryId);
      if (dismissVid) videos.set(entryId, dismissVid);
      else videos.delete(entryId);
    }
  }
  const source =
    item.external === "nuvio" || (isNuvioSignedIn() && isNuvioProviderActive())
      ? "nuvio"
      : item.external;
  if (source) {
    for (const entryId of ids) {
      const key = `${source}|${entryId}`;
      times.set(key, Math.max(nowMs, dismissed.get(key) ?? 0));
    }
  }
  persistDismissed(times, videos, options.acknowledged, positions);
  dismissed.clear();
  dismissedVid.clear();
  dismissedPos.clear();
  for (const [key, value] of times) dismissed.set(key, value);
  for (const [key, value] of videos) dismissedVid.set(key, value);
  for (const [key, value] of positions) dismissedPos.set(key, value);
  emit();
  const providerWrite =
    providerSources.length > 0 ? clearProviderPlayback(item, providerSources) : null;
  const withProviderResult = async (result: CwDismissResult): Promise<CwDismissResult> => {
    if (!providerWrite) return result;
    try {
      const providerResult = await providerWrite;
      return providerResult.failed.length > 0
        ? { ...result, providerFailures: providerResult.failed }
        : result;
    } catch {
      return { ...result, providerFailures: providerSources };
    }
  };
  if (item.external === "nuvio" || (isNuvioSignedIn() && isNuvioProviderActive())) {
    const { season, episode } = resolveEpisode(item);
    const slot = resolveNuvioProfileIndex();
    const cleanId = id.replace(/^(series|movie|tmdb):/, "").trim();
    const idVariants = [id, cleanId, `tmdb:${cleanId}`, `series:${cleanId}`];
    try {
      for (const vid of idVariants) {
        clearResume(vid, undefined, undefined, { ...options, ownerId: `nuvio-${slot}` });
        if (season != null && episode != null) {
          clearResume(vid, season, episode, { ...options, ownerId: `nuvio-${slot}` });
        }
      }
    } catch {
      throw new Error(
        "Removed from Continue Watching, but the saved position could not be cleared.",
      );
    }
    try {
      for (const vid of idVariants) {
        clearLocalCw(vid, `nuvio-${slot}`);
        clearLocalCw(vid);
      }
      removeExternalCwItem(item);
      const write = deleteWatchProgressFromNuvio(slot, id, undefined, season, episode);
      void dismissNextUpInNuvioCloud(slot, id, season, episode);
      window.dispatchEvent(
        new CustomEvent("harbor:nuvio-progress-deleted", {
          detail: { profileIndex: slot, contentId: id },
        }),
      );
      window.dispatchEvent(new CustomEvent("harbor:continue-watching-updated"));
      if (options.acknowledged) {
        if (write && typeof write.then === "function") {
          return write.then(
            (ok) => withProviderResult({ sync: ok !== false ? "synced" : "queued" }),
            () => {
              throw new Error(
                "Removed from Continue Watching on this device, but synchronization could not be saved.",
              );
            },
          );
        }
        return withProviderResult({ sync: "synced" });
      }
      if (providerWrite) void providerWrite;
      return undefined;
    } catch (err) {
      if (options.acknowledged) {
        throw new Error(
          "Removed from Continue Watching on this device, but synchronization could not be saved.",
          { cause: err },
        );
      }
    }
    return undefined;
  }
  if (item.external) {
    const { season, episode } = resolveEpisode(item);
    try {
      clearResume(id, season, episode, options);
    } catch {
      throw new Error(
        "Removed from Continue Watching, but the saved position could not be cleared.",
      );
    }
  }
  if (item.external || !authKey || !item.state || privateCwProfileId()) {
    if (!options.acknowledged) {
      if (providerWrite) void providerWrite;
      return;
    }
    return withProviderResult({ sync: "not-required" });
  }
  const vid = item.state.video_id ?? "";
  const kitsuThreeSeg = /^(kitsu|mal|anilist|anidb):/.test(id) && vid.split(":").length === 3;
  const se = kitsuThreeSeg ? null : episodeFromVideoId(item.state.video_id);
  try {
    clearResume(
      id,
      item.state.season ?? (kitsuThreeSeg ? 1 : se?.season),
      item.state.episode ?? (kitsuThreeSeg ? Number(vid.split(":")[2]) : se?.episode),
      options,
    );
  } catch {
    throw new Error("Removed from Continue Watching, but the saved position could not be cleared.");
  }
  const write = cloudLibraryPut(
    authKey,
    { ...item, state: { ...item.state, timeOffset: 0 }, _mtime: now },
    options,
  );
  if (!options.acknowledged) {
    void write;
    if (providerWrite) void providerWrite;
    return;
  }
  return write.then(
    (synced) => withProviderResult({ sync: synced ? "synced" : "queued" }),
    () => {
      throw new Error(
        "Removed from Continue Watching on this device, but synchronization could not be saved.",
      );
    },
  );
}

function extractDismissalKeyId(key: string): string {
  if (key.startsWith("group|") || key.startsWith("group-source|")) {
    const parts = key.split("|");
    if (parts.length >= 3) {
      try {
        return decodeURIComponent(parts[2]);
      } catch {
        return parts[2];
      }
    }
  } else if (key.includes("|")) {
    const parts = key.split("|");
    return parts[parts.length - 1];
  }
  return key;
}

export function undismissCw(id: string): void {
  loadDismissed();
  const cleanId = id.replace(/^(series|movie|tmdb):/, "").trim();
  const targetLower = id.toLowerCase();
  const targetCleanLower = cleanId.toLowerCase();

  let changed = false;

  const matchesId = (key: string): boolean => {
    const rawId = extractDismissalKeyId(key);
    const keyLower = rawId.toLowerCase();
    const keyCleanLower = rawId
      .replace(/^(series|movie|tmdb):/, "")
      .trim()
      .toLowerCase();
    return (
      keyLower === targetLower ||
      keyCleanLower === targetCleanLower ||
      keyLower === targetCleanLower ||
      keyCleanLower === targetLower
    );
  };

  for (const [key] of Array.from(dismissed.entries())) {
    if (matchesId(key)) {
      dismissed.delete(key);
      changed = true;
    }
  }
  for (const [key] of Array.from(dismissedVid.entries())) {
    if (matchesId(key)) {
      dismissedVid.delete(key);
      changed = true;
    }
  }
  for (const [key] of Array.from(dismissedPos.entries())) {
    if (matchesId(key)) {
      dismissedPos.delete(key);
      changed = true;
    }
  }

  // Also clean SIMKL dismissal store
  try {
    const simkl = JSON.parse(localStorage.getItem(SIMKL_KEY) ?? "[]");
    if (Array.isArray(simkl)) {
      const filtered = simkl.filter((k: string) => !matchesId(k));
      if (filtered.length !== simkl.length) {
        localStorage.setItem(SIMKL_KEY, JSON.stringify(filtered));
        changed = true;
      }
    }
  } catch {}

  if (changed) {
    persistDismissed(dismissed, dismissedVid, false, dismissedPos);
    emit();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useCwDismissVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}

if (typeof window !== "undefined") {
  const refresh = () => {
    loadDismissed();
    emit();
  };
  window.addEventListener("harbor:active-profile-changed", refresh);
  window.addEventListener("harbor:profiles-updated", refresh);
  window.addEventListener("harbor:nuvio-profile-changed", refresh);
  window.addEventListener("harbor:nuvio-state-changed", refresh);
  window.addEventListener("harbor:account-provider-changed", refresh);
}
