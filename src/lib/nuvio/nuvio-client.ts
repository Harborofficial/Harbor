/**
 * Nuvio API Client
 * Interfaces with Nuvio's backend services (Supabase PostgREST, GoTrue, RPCs).
 */

import { safeFetch as fetch } from "@/lib/safe-fetch";
export { isNuvioProviderActive } from "@/lib/active-profile-id";
import type { NuvioAccountState, NuvioSession } from "./nuvio-types";

export const NUVIO_DEFAULT_API = "https://api.nuvio.tv";
export const NUVIO_DEFAULT_LINK_URL = "https://nuvio.tv/link";
export const NUVIO_OFFICIAL_WEB_URL = "https://nuvio.tv";
export const NUVIO_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI";

const NUVIO_STATE_KEY = "harbor.nuvio.state.v1";
const NUVIO_PROFILE_MAP_KEY_PREFIX = "harbor.nuvio.profile-map.";

/**
 * Reads persisted Nuvio account state from localStorage
 */
export function loadNuvioState(): NuvioAccountState {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(NUVIO_STATE_KEY) : null;
    if (!raw) return { session: null, profiles: [], activeProfileIndex: 1, lastSyncedAt: null };
    const parsed = JSON.parse(raw) as Partial<NuvioAccountState>;
    return {
      session: parsed.session ?? null,
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      activeProfileIndex:
        typeof parsed.activeProfileIndex === "number" ? parsed.activeProfileIndex : 1,
      lastSyncedAt: typeof parsed.lastSyncedAt === "number" ? parsed.lastSyncedAt : null,
    };
  } catch {
    return { session: null, profiles: [], activeProfileIndex: 1, lastSyncedAt: null };
  }
}

/**
 * Persists Nuvio account state
 */
export function saveNuvioState(state: NuvioAccountState, options?: { silent?: boolean }): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(NUVIO_STATE_KEY, JSON.stringify(state));
    }
    if (!options?.silent && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("harbor:nuvio-state-changed", { detail: state }));
    }
  } catch (e) {
    console.error("[nuvio] failed to save state", e);
  }
}

/**
 * Maps a Harbor profile ID to a Nuvio profile index (1..6)
 */
export function getNuvioProfileIndexForHarborProfile(harborProfileId: string): number {
  try {
    const raw = localStorage.getItem(`${NUVIO_PROFILE_MAP_KEY_PREFIX}${harborProfileId}`);
    if (raw) {
      const idx = parseInt(raw, 10);
      if (idx >= 1 && idx <= 6) return idx;
    }
  } catch {
    /* fallback */
  }
  return 1;
}

/**
 * Saves mapping from Harbor profile ID to Nuvio profile index (1..6)
 */
export function setNuvioProfileIndexForHarborProfile(harborProfileId: string, index: number): void {
  try {
    const bounded = Math.max(1, Math.min(6, index));
    localStorage.setItem(`${NUVIO_PROFILE_MAP_KEY_PREFIX}${harborProfileId}`, String(bounded));
    window.dispatchEvent(new CustomEvent("harbor:nuvio-profile-changed"));
  } catch (e) {
    console.error("[nuvio] failed to save profile mapping", e);
  }
}

/**
 * Checks whether Nuvio is currently signed in
 */
export function getNuvioAccountId(): string | null {
  const state = loadNuvioState();
  return state.session?.user?.id ?? null;
}

export function isNuvioSignedIn(): boolean {
  const state = loadNuvioState();
  return (
    state.session != null &&
    typeof state.session.access_token === "string" &&
    state.session.access_token.length > 0
  );
}

/**
 * Refreshes an expired Nuvio session token
 */
export async function refreshNuvioSession(): Promise<NuvioSession | null> {
  const state = loadNuvioState();
  if (!state.session?.refresh_token) return null;
  const initialRefreshToken = state.session.refresh_token;
  const initialUserId = state.session.user?.id;

  try {
    const res = await fetch(`${NUVIO_DEFAULT_API}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: NUVIO_ANON_KEY,
        Authorization: `Bearer ${NUVIO_ANON_KEY}`,
      },
      body: JSON.stringify({
        refresh_token: initialRefreshToken,
      }),
    });

    if (!res.ok) {
      if (res.status === 400 || res.status === 401) {
        // Refresh token invalidated; only clear if the session hasn't changed concurrently
        const currentState = loadNuvioState();
        if (
          currentState.session &&
          currentState.session.user?.id === initialUserId &&
          currentState.session.refresh_token === initialRefreshToken
        ) {
          saveNuvioState({ ...currentState, session: null });
        }
      }
      return null;
    }

    const data = (await res.json()) as Record<string, unknown>;
    const nowSec = Math.floor(Date.now() / 1000);
    const refreshed: NuvioSession = {
      access_token: String(data.access_token || ""),
      refresh_token: String(data.refresh_token || initialRefreshToken),
      expires_at: nowSec + (typeof data.expires_in === "number" ? data.expires_in : 3600),
      token_type: String(data.token_type || "bearer"),
      user: (data.user as NuvioSession["user"]) || state.session.user,
    };

    const currentState = loadNuvioState();
    // Guard against race conditions:
    // 1. Session was cleared (sign-out)
    // 2. User switched accounts (different user ID)
    // 3. User logged in again / newer session stored (different refresh_token)
    if (
      !currentState.session ||
      currentState.session.user?.id !== initialUserId ||
      currentState.session.refresh_token !== initialRefreshToken
    ) {
      return null;
    }
    saveNuvioState({ ...currentState, session: refreshed });
    return refreshed;
  } catch (err) {
    console.warn("[nuvio] token refresh failed", err);
    return null;
  }
}

/**
 * Safe fetch wrapper that automatically attaches Nuvio Auth bearer header
 * and refreshes token if expired.
 */
export async function nuvioFetch(
  endpoint: string,
  options: RequestInit = {},
  canSend: () => boolean = () => true,
): Promise<Response> {
  const state = loadNuvioState();
  let session = state.session;
  const accountId = session?.user?.id;
  const checkOwner = () => {
    if (loadNuvioState().session?.user?.id !== accountId || !canSend())
      throw new Error("Nuvio request owner changed");
  };
  checkOwner();

  if (session) {
    const nowSec = Math.floor(Date.now() / 1000);
    // Refresh 60 seconds before expiry
    if (session.expires_at && session.expires_at - nowSec < 60) {
      const refreshed = await refreshNuvioSession();
      if (refreshed) session = refreshed;
    }
  }

  checkOwner();
  const url = endpoint.startsWith("http") ? endpoint : `${NUVIO_DEFAULT_API}${endpoint}`;
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  headers.set("apikey", NUVIO_ANON_KEY);

  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  } else if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${NUVIO_ANON_KEY}`);
  }

  let res = await fetch(url, { ...options, headers });

  if (res.status === 401 && session?.refresh_token) {
    // Retry once after refresh
    checkOwner();
    const refreshed = await refreshNuvioSession();
    checkOwner();
    if (refreshed?.access_token) {
      headers.set("Authorization", `Bearer ${refreshed.access_token}`);
      res = await fetch(url, { ...options, headers });
    }
  }

  return res;
}

const SYNC_CLIENT_ID_KEY = "harbor.nuvio.sync_client_id";

/**
 * Returns a stable, validated sync client identifier for Nuvio RPCs (matches NuvioMobile length & format rules).
 */
export function getOrCreateSyncClientId(): string {
  try {
    const existing = localStorage.getItem(SYNC_CLIENT_ID_KEY);
    if (existing && existing.length >= 16 && existing.length <= 96) return existing;
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let randomPart = "";
    for (let i = 0; i < 32; i++) {
      randomPart += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const generated = `harbor-desktop-${randomPart}`;
    localStorage.setItem(SYNC_CLIENT_ID_KEY, generated);
    return generated;
  } catch {
    return "harbor-desktop-sync-client-id-012345";
  }
}

/**
 * Scans local storage across all Nuvio profiles, cw trays, watched states,
 * and library slots to collect every item ID associated with Nuvio.
 */
export function collectAllNuvioItemIds(): Set<string> {
  const ids = new Set<string>();
  if (typeof window === "undefined" || !window.localStorage) return ids;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (
        key.startsWith("harbor.nuvio.") ||
        key.includes(".nuvio.") ||
        key.includes("nuvio-") ||
        key.includes("nuvio_") ||
        key.startsWith("harbor.watchedFlag.nuvio") ||
        key.startsWith("harbor.moviewatched.nuvio") ||
        key.startsWith("harbor.manualwatched.v1.nuvio")
      ) {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && typeof item === "object") {
                const id =
                  item._id ||
                  item.id ||
                  item.contentId ||
                  item.imdb_id ||
                  item.imdbId ||
                  item.content_id;
                if (typeof id === "string" && id.length > 0) ids.add(id);
              } else if (typeof item === "string" && item.length > 0) {
                const baseId = item.split(":")[0];
                if (baseId) ids.add(baseId);
              }
            }
          } else if (parsed && typeof parsed === "object") {
            for (const k of Object.keys(parsed)) {
              if (k.startsWith("tt") || k.includes(":")) {
                const baseId = k.split(":")[0];
                if (baseId) ids.add(baseId);
              }
              const val = parsed[k];
              if (val && typeof val === "object") {
                const id =
                  val._id || val.id || val.contentId || val.imdb_id || val.imdbId || val.content_id;
                if (typeof id === "string" && id.length > 0) ids.add(id);
              }
            }
          }
        } catch {}
      }
    }
  } catch {}

  return ids;
}
