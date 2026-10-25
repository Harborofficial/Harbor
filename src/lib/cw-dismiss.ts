import { useSyncExternalStore } from "react";
import { noteNotify } from "./render-cause";
import { clearResume, readResumeEntry } from "./resume";
import { setItemWithRecovery } from "./storage-recovery";
import { episodeFromVideoId, type LibraryItem } from "./stremio";
import { cloudLibraryPut } from "./stremio-write-queue";
import { privateCwProfileId } from "./cw-profile";
import { isNuvioSignedIn } from "./nuvio/nuvio-client";
import {
  deleteWatchProgressFromNuvio,
  isNuvioProviderActive,
  resolveNuvioProfileIndex,
} from "./nuvio/nuvio-sync";
import { clearLocalCw } from "./local-cw";

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
  for (const id of item.altIds ?? []) {
    if (typeof id === "string" && id && !ids.includes(id)) ids.push(id);
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

function isDismissedCheckpoint(
  item: LibraryItem,
  dismissedAt: number,
  dismissedVid: string | undefined,
  pos: { s?: number; e?: number; p: number } | undefined,
): boolean {
  // Newer progress from any source (Harbor resume, Stremio cloud _mtime/lastWatched,
  // Trakt paused_at, Simkl watched_at) un-dismisses even when the video_id is unchanged.
  const activity = itemActivity(item);
  if (activity > dismissedAt) return false;
  const curVid = item.state?.video_id;
  // Further-ahead position on the same episode un-dismisses even when its timestamp
  // predates the dismissal (e.g. dismissed after watching elsewhere).
  if (pos != null && progressRatio(item) > pos.p + 0.01) {
    const { season, episode } = resolveEpisode(item);
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
    const { season, episode } = resolveEpisode(item);
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

export type CwDismissResult = { sync: "not-required" | "synced" | "queued" };

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
  const members = (item as LibraryItem & { cwMembers?: LibraryItem[] }).cwMembers;
  if (members?.length) {
    const nowMs = Date.now();
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
      checkpoint?: { s?: number; e?: number; p: number };
      video?: string;
    };
    const sourceCheckpoints = new Map<string, SourceCheckpoint>();
    for (const member of [...members, item]) {
      const ids = itemIds(member);
      const { season, episode } = resolveEpisode(member);
      const source = dismissalSource(member);
      const vid = member.state?.video_id;
      const keys = ids.map((entryId) => groupedDismissalKey(source, entryId, vid, season, episode));
      for (const key of keys) times.set(key, nowMs);
      for (const key of keys) {
        if (typeof vid === "string" && vid) videos.set(key, vid);
        else videos.delete(key);
      }
      const checkpoint = member.state
        ? { s: season, e: episode, p: progressRatio(member) }
        : undefined;
      if (checkpoint) for (const key of keys) positions.set(key, checkpoint);

      const rank = season == null || episode == null ? -1 : season * 100_000 + episode;
      for (const entryId of ids) {
        const key = groupedSourceDismissalKey(source, entryId);
        const held = sourceCheckpoints.get(key);
        if (!held || rank > held.rank || (rank === held.rank && (checkpoint?.p ?? 0) >= held.p)) {
          sourceCheckpoints.set(key, {
            rank,
            p: checkpoint?.p ?? 0,
            checkpoint,
            video: typeof vid === "string" && vid ? vid : undefined,
          });
        }
      }
    }
    for (const [key, value] of sourceCheckpoints) {
      times.set(key, nowMs);
      if (value.video) videos.set(key, value.video);
      else videos.delete(key);
      if (value.checkpoint) positions.set(key, value.checkpoint);
    }
    persistDismissed(times, videos, options.acknowledged, positions);
    dismissed.clear();
    dismissedVid.clear();
    dismissedPos.clear();
    for (const [key, value] of times) dismissed.set(key, value);
    for (const [key, value] of videos) dismissedVid.set(key, value);
    for (const [key, value] of positions) dismissedPos.set(key, value);
    emit();
    return options.acknowledged ? Promise.resolve({ sync: "not-required" }) : undefined;
  }
  const id = item._id;
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const times = new Map(dismissed);
  const videos = new Map(dismissedVid);
  const ids = itemIds(item);
  for (const entryId of ids) times.set(entryId, nowMs);
  const dismissVid = item.state?.video_id;
  for (const entryId of ids) {
    if (typeof dismissVid === "string" && dismissVid) videos.set(entryId, dismissVid);
    else videos.delete(entryId);
  }
  const positions = new Map(dismissedPos);
  if (item.state) {
    const { season, episode } = resolveEpisode(item);
    const checkpoint = { s: season, e: episode, p: progressRatio(item) };
    for (const entryId of ids) positions.set(entryId, checkpoint);
  } else {
    for (const entryId of ids) positions.delete(entryId);
  }
  if (item.external === "nuvio" || (isNuvioSignedIn() && isNuvioProviderActive())) {
    for (const entryId of ids) times.set(`nuvio|${entryId}`, nowMs);
  } else if (item.external) {
    for (const entryId of ids) times.set(`${item.external}|${entryId}`, nowMs);
  }
  persistDismissed(times, videos, options.acknowledged, positions);
  dismissed.clear();
  dismissedVid.clear();
  dismissedPos.clear();
  for (const [key, value] of times) dismissed.set(key, value);
  for (const [key, value] of videos) dismissedVid.set(key, value);
  for (const [key, value] of positions) dismissedPos.set(key, value);
  emit();
  if (item.external === "nuvio" || (isNuvioSignedIn() && isNuvioProviderActive())) {
    const { season, episode } = resolveEpisode(item);
    try {
      clearResume(id, season, episode, options);
    } catch {
      throw new Error(
        "Removed from Continue Watching, but the saved position could not be cleared.",
      );
    }
    try {
      const slot = resolveNuvioProfileIndex();
      clearLocalCw(id, `nuvio-${slot}`);
      void deleteWatchProgressFromNuvio(slot, id, undefined, season, episode);
    } catch {}
    return options.acknowledged ? Promise.resolve({ sync: "not-required" }) : undefined;
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
    return options.acknowledged ? Promise.resolve({ sync: "not-required" }) : undefined;
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
    return;
  }
  return write.then(
    (synced) => ({ sync: synced ? "synced" : "queued" }),
    () => {
      throw new Error(
        "Removed from Continue Watching on this device, but synchronization could not be saved.",
      );
    },
  );
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
