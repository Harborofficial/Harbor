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
import type {
  NuvioAddonItem,
  NuvioWatchProgress,
  NuvioWatchedItem,
} from "./nuvio-types";
import { setWatchedFlag } from "@/lib/watched-flag";
import { setMovieWatchedLocal } from "@/lib/movie-watched";
import { reconcileNuvioWatchedEpisodes } from "@/lib/manual-watched";
import { clearLocalCw, listLocalCw, saveLocalCw } from "@/lib/local-cw";
import { clearResume } from "@/lib/resume";
import { readCachedNuvioPlaybackItems, writeCachedNuvioPlaybackItems, buildNuvioPlaybackItems } from "./nuvio-playback";
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

/**
 * Returns true if Nuvio is the currently active account provider in Harbor.
 */
import { isNuvioProviderActive } from "@/lib/active-profile-id";
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
    if (harborProfileId >= 1 && harborProfileId <= 6) return harborProfileId;
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
    const state = loadNuvioState();
    return typeof state.activeProfileIndex === "number" && state.activeProfileIndex >= 1 && state.activeProfileIndex <= 6
      ? state.activeProfileIndex
      : 1;
  }
  if (typeof harborProfileId === "string" && harborProfileId) {
    return getNuvioProfileIndexForHarborProfile(harborProfileId);
  }
  const state = loadNuvioState();
  return typeof state.activeProfileIndex === "number" && state.activeProfileIndex >= 1 && state.activeProfileIndex <= 6
    ? state.activeProfileIndex
    : 1;
}

const WATCH_PROGRESS_CACHE_PREFIX = "harbor.nuvio.watch_progress.";

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
    localStorage.setItem(
      getWatchProgressKey(slot, accountId),
      JSON.stringify(items),
    );
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

  const profileIndex = resolveNuvioProfileIndex(harborProfileId);
  const progSec = Math.max(0, Math.round(progressSeconds));
  const durSec = Math.max(0, Math.round(durationSeconds));

  if (progSec <= 0) {
    // 0 progress seconds means unstarted. Do not push 0-progress records to Supabase watch_progress
    // as it suppresses Next Up resolution in Nuvio Mobile and violates progress semantics.
    return true;
  }

  const progressKey =
    season != null && episode != null
      ? `${contentId}_s${season}e${episode}`
      : contentId;

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
        poster: (poster || existing?.poster) || undefined,
        background: (background || existing?.background) || undefined,
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

  // Try official sync_push_watch_progress RPC first (matches NuvioMobile)
  try {
    const clientId = getOrCreateSyncClientId();
    const rpcRes = await nuvioFetch("/rest/v1/rpc/sync_push_watch_progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_profile_id: profileIndex,
        p_entries: [
          {
            content_id: contentId,
            content_type: season != null && episode != null ? "series" : "movie",
            video_id:
              season != null && episode != null
                ? `${contentId}:${season}:${episode}`
                : contentId,
            season: season ?? null,
            episode: episode ?? null,
            position: progSec * 1000,
            duration: durSec * 1000,
            last_watched: nowEpoch,
            progress_key: progressKey,
          },
        ],
        p_origin_client_id: clientId,
      }),
    });
    if (rpcRes.ok) {
      console.info(`[nuvio-sync] watch progress pushed via RPC for profile ${profileIndex}: ${progressKey} (${progSec}s / ${durSec}s)`);
      return true;
    }
  } catch {
    // Fall back to table upsert
  }

  try {
    const res = await nuvioFetch("/rest/v1/watch_progress", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        profile_id: profileIndex,
        content_id: contentId,
        content_type: season != null && episode != null ? "series" : "movie",
        video_id:
          season != null && episode != null
            ? `${contentId}:${season}:${episode}`
            : contentId,
        progress_key: progressKey,
        position: progSec * 1000,
        duration: durSec * 1000,
        season: season ?? null,
        episode: episode ?? null,
        last_watched: nowEpoch,
      }),
    });

    if (res.ok) {
      console.info(`[nuvio-sync] watch progress pushed via table upsert for profile ${profileIndex}: ${progressKey}`);
      return true;
    }
    return res.ok;
  } catch (err) {
    console.warn("[nuvio] failed to push watch progress", err);
    return false;
  }
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
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);

  let rpcSuccess = false;
  // 1. Try official sync_push_watched_items RPC (matching Nuvio Mobile)
  try {
    const clientId = getOrCreateSyncClientId();
    const syncItems = items.map((item) => ({
      content_id: item.contentId,
      content_type: item.contentType || (item.season != null && item.episode != null ? "series" : "movie"),
      title: item.title || "",
      season: item.season ?? null,
      episode: item.episode ?? null,
      watched_at: item.watchedAt || Date.now(),
    }));
    const rpcRes = await nuvioFetch("/rest/v1/rpc/sync_push_watched_items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_profile_id: profileIndex,
        p_items: syncItems,
        p_origin_client_id: clientId,
      }),
    });
    if (rpcRes.ok) {
      rpcSuccess = true;
      console.info(`[nuvio-sync] watched items pushed via RPC for profile ${profileIndex} (${syncItems.length} items)`);
    } else {
      console.warn(`[nuvio-sync] RPC push watched items response not ok: ${rpcRes.status}`);
    }
  } catch (err) {
    console.warn("[nuvio-sync] RPC push watched items error:", err);
  }

  // 2. ALSO execute direct table upsert to guarantee clean state and persistence
  try {
    const payloads = items.map((item) => ({
      profile_id: profileIndex,
      content_id: item.contentId,
      content_type: item.contentType || (item.season != null && item.episode != null ? "series" : "movie"),
      title: item.title || "",
      season: item.season ?? null,
      episode: item.episode ?? null,
      watched_at: item.watchedAt || Date.now(),
    }));
    const res = await nuvioFetch("/rest/v1/watched_items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(payloads.length === 1 ? payloads[0] : payloads),
    });
    if (res.ok) return true;
  } catch (err) {
    console.warn("[nuvio] failed to mark watched item via table upsert", err);
  }

  return rpcSuccess;
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
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);

  // 1. Try official sync_delete_watched_items RPC (matching Nuvio Mobile)
  let rpcSuccess = false;
  try {
    const clientId = getOrCreateSyncClientId();
    const rpcRes = await nuvioFetch("/rest/v1/rpc/sync_delete_watched_items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_profile_id: profileIndex,
        p_keys: keys.map((k) => ({
          content_id: k.contentId,
          season: k.season ?? null,
          episode: k.episode ?? null,
        })),
        p_origin_client_id: clientId,
      }),
    });
    if (rpcRes.ok) {
      rpcSuccess = true;
      console.info(`[nuvio-sync] watched items deleted via RPC for profile ${profileIndex} (${keys.length} keys)`);
    }
  } catch {}

  // 2. ALSO execute direct table delete to guarantee clean state
  try {
    for (const k of keys) {
      let url = `/rest/v1/watched_items?profile_id=eq.${profileIndex}&content_id=eq.${encodeURIComponent(k.contentId)}`;
      if (k.season != null) url += `&season=eq.${k.season}`;
      if (k.episode != null) url += `&episode=eq.${k.episode}`;
      await nuvioFetch(url, { method: "DELETE" });
    }
    return true;
  } catch (err) {
    console.warn("[nuvio] failed to delete watched item", err);
    return rpcSuccess;
  }
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
        return new Set(
          parsed.filter((k) => typeof k === "string" && !k.endsWith("|-1|-1")),
        );
      }
    }
  } catch {}
  return new Set();
}

/**
 * Writes locally cached dismissed Next-Up keys for a profile slot
 */
export function writeCachedDismissedNextUpKeys(
  profileIndex: number,
  keys: Set<string>,
): void {
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

  // 1. Check whole-show dismissals or wildcard dismissals (-1|-1)
  for (const v of idVariants) {
    if (dismissedKeys.has(`${v}|-1|-1`)) return true;
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
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);
  const normalizedContentId = contentId.trim();
  if (!normalizedContentId) return false;

  const cleanId = normalizedContentId.replace(/^(series|movie|tmdb):/, "").trim();
  const s = season != null && season >= 0 ? season : 1;
  const e = episode != null && episode >= 0 ? episode : 1;

  const targetKeys: string[] = [
    `${normalizedContentId}|${s}|${e}`,
    `${cleanId}|${s}|${e}`,
    `tmdb:${cleanId}|${s}|${e}`,
    `series:${cleanId}|${s}|${e}`,
    `${normalizedContentId}|-1|-1`,
    `${cleanId}|-1|-1`,
    `tmdb:${cleanId}|-1|-1`,
    `series:${cleanId}|-1|-1`,
    `${normalizedContentId}|${s}|-1`,
    `${cleanId}|${s}|-1`,
  ];
  if (e > 1) {
    targetKeys.push(
      `${normalizedContentId}|${s}|${e - 1}`,
      `${cleanId}|${s}|${e - 1}`,
      `tmdb:${cleanId}|${s}|${e - 1}`,
      `series:${cleanId}|${s}|${e - 1}`,
    );
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
    localStorage.setItem(
      `${WATCHED_ITEMS_CACHE_PREFIX}${acc}.slot.${slot}`,
      JSON.stringify(items),
    );
  } catch {}
}

/**
 * Pulls watched items for a specific profile slot from Nuvio
 */
export async function pullWatchedItemsFromNuvio(
  harborProfileId?: string | number,
): Promise<NuvioWatchedItem[]> {
  if (!isNuvioSignedIn()) return [];
  const startingAccountId = getNuvioAccountId();
  if (!startingAccountId) return [];
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);

  // 1. Try official sync_pull_watched_items RPC (matching Nuvio Mobile)
  try {
    const rpcRes = await nuvioFetch("/rest/v1/rpc/sync_pull_watched_items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_profile_id: profileIndex,
        p_page: 1,
        p_page_size: 1000,
      }),
    });
    if (rpcRes.ok) {
      const data = await rpcRes.json();
      if (Array.isArray(data)) {
        writeCachedWatchedItems(profileIndex, data as NuvioWatchedItem[], startingAccountId);
        return data as NuvioWatchedItem[];
      }
    }
  } catch {}

  // 2. Fallback to direct table query
  try {
    const res = await nuvioFetch(`/rest/v1/watched_items?profile_id=eq.${profileIndex}&select=*`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        writeCachedWatchedItems(profileIndex, data as NuvioWatchedItem[], startingAccountId);
        return data as NuvioWatchedItem[];
      }
    }
  } catch (err) {
    console.warn("[nuvio] failed to pull watched items", err);
  }
  return readCachedWatchedItems(profileIndex, startingAccountId);
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
): Promise<{ season: number; episode: number } | null> {
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
        const episodes = await fetchSeasonEpisodes({ id: lookupId, type: "series", name: "" }, lastSeason, { tmdbKey: key }).catch(() => []);
        if (episodes && episodes.length > 0) {
          const nextInSeason = episodes.find((e) => e.episode > lastEpisode);
          if (nextInSeason) return { season: lastSeason, episode: nextInSeason.episode };
          const nextSeasonEps = await fetchSeasonEpisodes({ id: lookupId, type: "series", name: "" }, lastSeason + 1, { tmdbKey: key }).catch(() => []);
          if (nextSeasonEps && nextSeasonEps.length > 0) {
            return { season: lastSeason + 1, episode: nextSeasonEps[0].episode };
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
  return null;
}

export async function reconcileNuvioWatched(
  harborProfileId?: string | number,
): Promise<void> {
  if (!isNuvioSignedIn()) return;
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);
  const [items, progressItems] = await Promise.all([
    pullWatchedItemsFromNuvio(profileIndex),
    pullWatchProgressFromNuvio(profileIndex),
  ]);
  if (!items) return;

  const serverWatchedIds = new Set<string>();
  const serverMovieIds = new Set<string>();
  const serverEpisodeKeys = new Set<string>();

  for (const it of items) {
    if (!it.content_id) continue;
    if (it.season == null && it.episode == null) {
      serverWatchedIds.add(it.content_id);
      if (it.content_type === "movie" || !it.content_type) {
        serverMovieIds.add(it.content_id);
      }
    } else if (typeof it.season === "number" && typeof it.episode === "number") {
      serverEpisodeKeys.add(`${it.content_id}|${it.season}|${it.episode}`);
    }
  }

  // 1. Reconcile episodes with local storage: adds server episodes and removes
  // unflagged episodes (handling single unmarks, up-to unmarks, and whole-season unmarks from Nuvio mobile)
  const { newlyWatchedShows } = reconcileNuvioWatchedEpisodes(profileIndex, serverEpisodeKeys);

  // 2. Update watched flags for all items reported by Nuvio Cloud
  for (const id of serverWatchedIds) {
    setWatchedFlag(id, true, profileIndex);
  }
  for (const id of serverMovieIds) {
    setMovieWatchedLocal(id, true, profileIndex);
  }

  // 3. Prune any locally flagged items that were deleted/unmarked on Nuvio cloud
  try {
    const flagKey = `harbor.watchedFlag.nuvio.v1.${profileIndex}`;
    const rawFlags = localStorage.getItem(flagKey);
    if (rawFlags) {
      const stored = JSON.parse(rawFlags);
      if (Array.isArray(stored)) {
        for (const localId of stored) {
          if (!serverWatchedIds.has(localId)) {
            setWatchedFlag(localId, false, profileIndex);
            setMovieWatchedLocal(localId, false, profileIndex);
          }
        }
      }
    }
  } catch {}

  // 4. Update Continue Watching tray and reconcile playback items
  try {
    const dismissedKeys = await pullDismissedNextUpKeysFromNuvio(profileIndex);
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
        if (serverWatchedIds.has(showId)) continue;
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

        // If whole series is marked watched, remove it from Continue Watching tray immediately
        if (
          serverWatchedIds.has(entry.id) ||
          serverWatchedIds.has(cleanEntryId) ||
          serverWatchedIds.has(`tmdb:${cleanEntryId}`) ||
          serverWatchedIds.has(`series:${cleanEntryId}`)
        ) {
          clearLocalCw(entry.id, `nuvio-${profileIndex}`);
          clearResume(entry.id, undefined, undefined, `nuvio-${profileIndex}`);
          clearResume(cleanEntryId, undefined, undefined, `nuvio-${profileIndex}`);
          continue;
        }

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
          if (!nextTarget) {
            clearLocalCw(entry.id, `nuvio-${profileIndex}`);
            clearResume(entry.id, undefined, undefined, `nuvio-${profileIndex}`);
            clearResume(cleanEntryId, undefined, undefined, `nuvio-${profileIndex}`);
          } else {
            const nextS = nextTarget.season;
            const nextE = nextTarget.episode;
            if (entry.season !== nextS || entry.episode !== nextE || entry.positionMs !== 0) {
              saveLocalCw(
                {
                  ...entry,
                  season: nextS,
                  episode: nextE,
                  positionMs: 0,
                  external: "nuvio" as const,
                  t: maxInfo.watchedAt || Date.now(),
                },
                `nuvio-${profileIndex}`,
              );
            }
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

        // Check if fully watched series
        if (
          serverWatchedIds.has(item.content_id) ||
          serverWatchedIds.has(cleanShowId) ||
          serverWatchedIds.has(`tmdb:${cleanShowId}`) ||
          serverWatchedIds.has(`series:${cleanShowId}`)
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
        if (!nextTarget) {
          const curSettings = loadStoredSettings();
          if (curSettings.animeCwEnd === "timer" || isNuvioProviderActive()) {
            nextTarget = { season: maxInfo.season, episode: maxInfo.episode };
          } else {
            continue;
          }
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
                m = await tmdbDetails(key, { id: String(tmdbNum), type: "series", name: "" }).catch(() => null);
              }
              if (!m && title && title !== cleanShowId) {
                const searchRes = await fetch(
                  `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(title)}.json`,
                ).then((r) => r.json()).catch(() => null);
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

      const built = buildNuvioPlaybackItems(progressItems ?? [], profileIndex, items, dismissedKeys);
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
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);
  const normalizedContentId = contentId.trim();
  if (!normalizedContentId) return false;

  const cleanId = normalizedContentId.replace(/^(series|movie|tmdb):/, "");
  const idVariants = Array.from(new Set([normalizedContentId, cleanId, `tmdb:${cleanId}`, `series:${cleanId}`]));
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
    clearResume(id, season, episode);
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

  // 4. Call sync_delete_watch_progress RPC
  let rpcSuccess = false;
  try {
    const clientId = getOrCreateSyncClientId();
    const rpcRes = await nuvioFetch("/rest/v1/rpc/sync_delete_watch_progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_profile_id: profileIndex,
        p_keys: keysToDelete,
        p_origin_client_id: clientId,
      }),
    });
    if (rpcRes.ok) rpcSuccess = true;
  } catch {}

  // 5. Also execute table delete for this specific episode across all ID variants
  for (const id of idVariants) {
    try {
      await nuvioFetch(
        `/rest/v1/watch_progress?profile_id=eq.${profileIndex}&content_id=eq.${encodeURIComponent(id)}&season=eq.${season}&episode=eq.${episode}`,
        { method: "DELETE" },
      );
    } catch {}
  }

  return rpcSuccess;
}

/**
 * Deletes watch progress for a title or specific episode in Nuvio
 */
export async function deleteWatchProgressFromNuvio(
  harborProfileId: string | number | undefined,
  contentId: string,
  progressKey?: string,
  season?: number | null,
  episode?: number | null,
): Promise<boolean> {
  if (!isNuvioSignedIn()) return false;

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

  // Also harvest all other episode keys for this content from local cache
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

  // 2. Query Supabase for ALL progress keys currently on the server for all ID variants
  const inClause = idVariants.map((id) => encodeURIComponent(id)).join(",");
  try {
    const serverKeysRes = await nuvioFetch(
      `/rest/v1/watch_progress?profile_id=eq.${profileIndex}&content_id=in.(${inClause})&select=progress_key,season,episode,content_id`,
    );
    if (serverKeysRes.ok) {
      const serverRows = (await serverKeysRes.json()) as any[];
      if (Array.isArray(serverRows)) {
        for (const row of serverRows) {
          if (row.progress_key) keysToDelete.add(row.progress_key);
          if (row.season != null && row.episode != null) {
            for (const vid of idVariants) {
              keysToDelete.add(`${vid}_s${row.season}e${row.episode}`);
              keysToDelete.add(`${vid}:${row.season}:${row.episode}`);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("[nuvio-sync] failed to query server keys before delete", err);
  }

  const keysArray = Array.from(keysToDelete);
  const clientId = getOrCreateSyncClientId();

  // 3. Call official sync_delete_watch_progress RPC (emits delta delete events for Nuvio Mobile)
  let rpcSuccess = false;
  try {
    const rpcRes = await nuvioFetch("/rest/v1/rpc/sync_delete_watch_progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_profile_id: profileIndex,
        p_keys: keysArray,
        p_origin_client_id: clientId,
      }),
    });
    if (rpcRes.ok) {
      rpcSuccess = true;
      console.info(`[nuvio-sync] watch progress deleted via RPC for profile ${profileIndex}:`, keysArray);
    }
  } catch (rpcErr) {
    console.warn("[nuvio-sync] RPC delete error:", rpcErr);
  }

  // 4. ALWAYS ALSO execute direct table delete to guarantee ZERO lingering zombie rows
  try {
    await nuvioFetch(
      `/rest/v1/watch_progress?profile_id=eq.${profileIndex}&content_id=in.(${inClause})`,
      { method: "DELETE" },
    );
  } catch (err) {
    console.warn("[nuvio-sync] table delete error:", err);
  }

  // 5. Dismiss Next-Up in mobile profile settings blob so mobile Up-Next engine never resurrects it
  void dismissNextUpInNuvioCloud(profileIndex, normalizedContentId, season, episode);

  return rpcSuccess;
}

/**
 * Pulls watch progress for the specified profile from Nuvio.
 * Caches records per profile slot and safely falls back to local cache if network drops.
 */
export async function pullWatchProgressFromNuvio(
  harborProfileId?: string | number,
): Promise<NuvioWatchProgress[]> {
  if (!isNuvioSignedIn()) return [];
  const startingAccountId = getNuvioAccountId();
  if (!startingAccountId) return [];

  const isCurrentAccount = () => isNuvioSignedIn() && getNuvioAccountId() === startingAccountId;
  const profileIndex = resolveNuvioProfileIndex(harborProfileId);

  // Try official sync_pull_watch_progress RPC first
  try {
    const rpcRes = await nuvioFetch("/rest/v1/rpc/sync_pull_watch_progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_profile_id: profileIndex,
        p_limit: 50,
      }),
    });

    if (!isCurrentAccount()) return [];

    if (rpcRes.ok) {
      const data = await rpcRes.json();
      if (!isCurrentAccount()) return [];
      if (Array.isArray(data)) {
        if (data.length === 0) {
          if (!isCurrentAccount()) return [];
          // Cloud has NO watch progress for this profile slot (all items deleted on another device or empty)
          writeCachedWatchProgress(profileIndex, [], startingAccountId);
          const cachedWatched = readCachedWatchedItems(profileIndex, startingAccountId);
          if (cachedWatched.length === 0) {
            writeCachedNuvioPlaybackItems(profileIndex, [], startingAccountId);
            try {
              localStorage.removeItem(`harbor.nuvio.playback_items.slot.${profileIndex}`);
            } catch {}
          } else {
            const upNextBuilt = buildNuvioPlaybackItems([], profileIndex, cachedWatched);
            writeCachedNuvioPlaybackItems(profileIndex, upNextBuilt, startingAccountId);
          }
          const state = loadNuvioState();
          if (state.session?.user?.id === startingAccountId) {
            saveNuvioState({ ...state, lastSyncedAt: Date.now() }, { silent: true });
          }
          window.dispatchEvent(
            new CustomEvent("harbor:nuvio-progress-reconciled", { detail: { profileIndex, count: 0 } }),
          );
          return [];
        }

        const prevCached = readCachedWatchProgress(profileIndex, startingAccountId);
        const serverProgressKeys = new Set<string>();
        const serverContentIds = new Set<string>();
        const serverItems: NuvioWatchProgress[] = [];

        for (const item of (data as any[])) {
          const progSec =
            item.position != null
              ? Math.max(0, Math.round(Number(item.position) / 1000))
              : Math.max(0, Math.round(Number(item.progress_seconds) || 0));
          const durSec =
            item.duration != null
              ? Math.max(0, Math.round(Number(item.duration) / 1000))
              : Math.max(0, Math.round(Number(item.duration_seconds) || 0));
          const pKey = item.progress_key || item.content_id;
          serverProgressKeys.add(pKey);
          if (item.content_id) serverContentIds.add(item.content_id);

          const prev = prevCached.find((p) => p.progress_key === pKey || p.content_id === item.content_id);
          const when = item.last_watched
            ? new Date(item.last_watched).toISOString()
            : item.updated_at
              ? new Date(item.updated_at).toISOString()
              : prev?.updated_at || new Date().toISOString();
          const epoch = item.last_watched || (when ? Date.parse(when) : Date.now());

          serverItems.push({
            profile_id: profileIndex,
            content_id: item.content_id,
            progress_key: pKey,
            progress_seconds: progSec,
            duration_seconds: durSec,
            season: item.season ?? null,
            episode: item.episode ?? null,
            updated_at: when,
            last_watched: epoch,
            title: item.title || item.name || prev?.title || prev?.name,
            name: item.name || item.title || prev?.name || prev?.title,
            poster: item.poster || prev?.poster,
            background: item.background || prev?.background,
          });
        }

        if (!isCurrentAccount()) return [];

        // Reconcile: identify any cached items that were deleted on another device!
        for (const prev of prevCached) {
          if (!serverProgressKeys.has(prev.progress_key) && !serverContentIds.has(prev.content_id)) {
            clearResume(prev.content_id, undefined, undefined, `nuvio-${profileIndex}`);
            clearResume(prev.content_id);
          }
        }
        if (!isCurrentAccount()) return [];

        try {
          const existing = readCachedNuvioPlaybackItems(profileIndex, startingAccountId);
          if (existing.length > 0) {
            const pruned = existing.filter((i: any) => serverContentIds.has(i._id));
            writeCachedNuvioPlaybackItems(profileIndex, pruned, startingAccountId);
          }
          localStorage.removeItem(`harbor.nuvio.playback_items.slot.${profileIndex}`);
        } catch {}

        serverItems.sort((a, b) => {
          const ta = a.last_watched || (a.updated_at ? Date.parse(a.updated_at) : 0);
          const tb = b.last_watched || (b.updated_at ? Date.parse(b.updated_at) : 0);
          return tb - ta;
        });

        if (!isCurrentAccount()) return [];

        writeCachedWatchProgress(profileIndex, serverItems, startingAccountId);
        try {
          const built = buildNuvioPlaybackItems(serverItems, profileIndex);
          writeCachedNuvioPlaybackItems(profileIndex, built, startingAccountId);
        } catch {}
        for (const m of serverItems) {
          if (!m.content_id) continue;
          saveLocalCw(
            {
              id: m.content_id,
              type: m.season != null && m.episode != null ? "series" : "movie",
              name: m.name || m.title || m.content_id,
              poster: m.poster || undefined,
              background: m.background || undefined,
              season: m.season ?? undefined,
              episode: m.episode ?? undefined,
              positionMs: (m.progress_seconds || 0) * 1000,
              durationMs: (m.duration_seconds || 0) * 1000,
              t: m.last_watched || (m.updated_at ? Date.parse(m.updated_at) : Date.now()),
            },
            `nuvio-${profileIndex}`,
          );
        }

        if (!isCurrentAccount()) return [];

        const state = loadNuvioState();
        if (state.session?.user?.id === startingAccountId) {
          saveNuvioState({ ...state, lastSyncedAt: Date.now() }, { silent: true });
        }
        window.dispatchEvent(
          new CustomEvent("harbor:nuvio-progress-reconciled", { detail: { profileIndex, count: serverItems.length } }),
        );
        return serverItems;
      }
    }
  } catch {
    // Fall back to table query
  }

  if (!isCurrentAccount()) return [];

  try {
    const res = await nuvioFetch(
      `/rest/v1/watch_progress?profile_id=eq.${profileIndex}&order=last_watched.desc`,
    );

    if (!isCurrentAccount()) return [];

    if (res.ok) {
      const list = (await res.json()) as any[];
      if (!isCurrentAccount()) return [];
      if (Array.isArray(list)) {
        if (list.length === 0) {
          if (!isCurrentAccount()) return [];
          writeCachedWatchProgress(profileIndex, [], startingAccountId);
          const cachedWatched = readCachedWatchedItems(profileIndex, startingAccountId);
          if (cachedWatched.length === 0) {
            writeCachedNuvioPlaybackItems(profileIndex, [], startingAccountId);
            try {
              localStorage.removeItem(`harbor.nuvio.playback_items.slot.${profileIndex}`);
            } catch {}
          } else {
            const upNextBuilt = buildNuvioPlaybackItems([], profileIndex, cachedWatched);
            writeCachedNuvioPlaybackItems(profileIndex, upNextBuilt, startingAccountId);
          }
          window.dispatchEvent(
            new CustomEvent("harbor:nuvio-progress-reconciled", { detail: { profileIndex, count: 0 } }),
          );
          return [];
        }

        const prevCached = readCachedWatchProgress(profileIndex, startingAccountId);
        const serverProgressKeys = new Set<string>();
        const serverContentIds = new Set<string>();
        const serverItems: NuvioWatchProgress[] = [];

        for (const it of list) {
          const k = it.progress_key || it.content_id;
          serverProgressKeys.add(k);
          if (it.content_id) serverContentIds.add(it.content_id);

          const progSec =
            it.position != null
              ? Math.max(0, Math.round(Number(it.position) / 1000))
              : Math.max(0, Math.round(Number(it.progress_seconds) || 0));
          const durSec =
            it.duration != null
              ? Math.max(0, Math.round(Number(it.duration) / 1000))
              : Math.max(0, Math.round(Number(it.duration_seconds) || 0));

          const prev = prevCached.find((p) => p.progress_key === k || p.content_id === it.content_id);
          const epoch = it.last_watched || Date.now();
          const when = new Date(epoch).toISOString();

          serverItems.push({
            profile_id: profileIndex,
            content_id: it.content_id,
            progress_key: k,
            progress_seconds: progSec,
            duration_seconds: durSec,
            season: it.season ?? null,
            episode: it.episode ?? null,
            updated_at: when,
            last_watched: epoch,
            title: it.title || it.name || prev?.title || prev?.name,
            name: it.name || it.title || prev?.name || prev?.title,
            poster: it.poster || prev?.poster,
            background: it.background || prev?.background,
          });
        }

        if (!isCurrentAccount()) return [];

        for (const prev of prevCached) {
          if (!serverProgressKeys.has(prev.progress_key) && !serverContentIds.has(prev.content_id)) {
            clearResume(prev.content_id, undefined, undefined, `nuvio-${profileIndex}`);
            clearResume(prev.content_id);
          }
        }
        if (!isCurrentAccount()) return [];

        try {
          const existing = readCachedNuvioPlaybackItems(profileIndex, startingAccountId);
          if (existing.length > 0) {
            const pruned = existing.filter((i: any) => serverContentIds.has(i._id));
            writeCachedNuvioPlaybackItems(profileIndex, pruned, startingAccountId);
          }
          localStorage.removeItem(`harbor.nuvio.playback_items.slot.${profileIndex}`);
        } catch {}

        serverItems.sort((a, b) => (b.last_watched || 0) - (a.last_watched || 0));

        if (!isCurrentAccount()) return [];

        writeCachedWatchProgress(profileIndex, serverItems, startingAccountId);
        try {
          const built = buildNuvioPlaybackItems(serverItems, profileIndex);
          writeCachedNuvioPlaybackItems(profileIndex, built, startingAccountId);
        } catch {}
        for (const m of serverItems) {
          if (!m.content_id) continue;
          saveLocalCw(
            {
              id: m.content_id,
              type: m.season != null && m.episode != null ? "series" : "movie",
              name: m.name || m.title || m.content_id,
              poster: m.poster || undefined,
              background: m.background || undefined,
              season: m.season ?? undefined,
              episode: m.episode ?? undefined,
              positionMs: (m.progress_seconds || 0) * 1000,
              durationMs: (m.duration_seconds || 0) * 1000,
              t: m.last_watched || (m.updated_at ? Date.parse(m.updated_at) : Date.now()),
            },
            `nuvio-${profileIndex}`,
          );
        }

        if (!isCurrentAccount()) return [];

        window.dispatchEvent(
          new CustomEvent("harbor:nuvio-progress-reconciled", { detail: { profileIndex, count: serverItems.length } }),
        );
        return serverItems;
      }
    }
  } catch (err) {
    console.warn("[nuvio] failed to pull watch progress", err);
  }

  if (!isCurrentAccount()) return [];

  // Gracefully fallback to cached records so CW tray never disappears or remains blank
  return readCachedWatchProgress(profileIndex, startingAccountId);
}

/**
 * Cached Nuvio Addon storage helpers
 */
const memoryAddonCache = new Map<string, NuvioAddonItem[]>();

function getNuvioAddonsCacheKey(slot?: number, accountId?: string): string {
  const acc = accountId || getNuvioAccountId() || "default";
  return `harbor.nuvio.addons.v1.${acc}.slot.${slot ?? 1}`;
}

export function readCachedNuvioAddons(
  slot?: number,
  accountId?: string,
): NuvioAddonItem[] {
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
      console.warn(`[nuvio] failed to pull addons (status ${res.status}) for profile ${profileIndex}`);
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
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(`${NUVIO_MANIFEST_CACHE_PREFIX}${url}`) : null;
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
export async function fetchNuvioAddons(
  harborProfileId?: string | number,
): Promise<Addon[]> {
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

  if (items.length === 0) return [];

  const addons: Addon[] = await Promise.all(
    items.map(async (n): Promise<Addon> => {
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
      console.info(`[nuvio-sync] addons pushed via RPC for profile ${profileIndex} (${addons.length} addons)`);
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
