/**
 * Nuvio Authentication Service
 * Implements Email/Password and TV Device Code linking (nuvio.tv/link).
 */

import { safeFetch as fetch } from "@/lib/safe-fetch";
import { openUrl } from "@/lib/window";
import {
  NUVIO_ANON_KEY,
  NUVIO_DEFAULT_API,
  NUVIO_DEFAULT_LINK_URL,
  loadNuvioState,
  nuvioFetch,
  saveNuvioState,
} from "./nuvio-client";
import { clearAllNuvioPinCaches, clearNuvioSessionUnlocks } from "./nuvio-profiles";
import { clearCachedWatchProgress, clearCachedNuvioAddons, fetchNuvioAddons } from "./nuvio-sync";
import { recordNuvioAddons } from "./nuvio-addon-registry";
import { clearCachedPlaybackItems } from "./nuvio-playback";
import { clearAllNuvioLocalCw } from "@/lib/local-cw";
import { clearAllNuvioResume } from "@/lib/resume";
import { clearNuvioLibraryCache } from "./nuvio-library";
import type {

  NuvioDeviceCodeSession,
  NuvioProfile,
  NuvioSession,
} from "./nuvio-types";

/**
 * Sign in using email and password
 */
export async function signInWithEmailPassword(
  email: string,
  pass: string,
  _remember: boolean = true,
): Promise<{ ok: true; session: NuvioSession } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${NUVIO_DEFAULT_API}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: NUVIO_ANON_KEY,
        Authorization: `Bearer ${NUVIO_ANON_KEY}`,
      },
      body: JSON.stringify({
        email: email.trim(),
        password: pass,
      }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const msg =
        typeof err.error_description === "string"
          ? err.error_description
          : typeof err.msg === "string"
          ? err.msg
          : `Authentication failed (HTTP ${res.status})`;
      return { ok: false, error: msg };
    }

    const data = (await res.json()) as Record<string, unknown>;
    const nowSec = Math.floor(Date.now() / 1000);
    const session: NuvioSession = {
      access_token: String(data.access_token || ""),
      refresh_token: String(data.refresh_token || ""),
      expires_at: nowSec + (typeof data.expires_in === "number" ? data.expires_in : 3600),
      token_type: String(data.token_type || "bearer"),
      user: (data.user as NuvioSession["user"]) || { id: "" },
    };

    const state = loadNuvioState();
    saveNuvioState({ ...state, session });

    // Fetch user profiles immediately after login
    await fetchNuvioProfiles();
    void fetchNuvioAddons().then(() => {
      window.dispatchEvent(new CustomEvent("harbor:nuvio-addons-changed"));
    });

    return { ok: true, session };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "Network error during sign in" };
  }
}

/**
 * Initiates TV / Device Code link flow.
 * Returns device_code, user_code, and complete verification URL.
 */
export async function startDeviceCodeSession(
  nonce?: string,
): Promise<NuvioDeviceCodeSession & { nonce: string }> {
  const deviceNonce = nonce || crypto.randomUUID();
  const res = await fetch(`${NUVIO_DEFAULT_API}/rest/v1/rpc/start_device_login_session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      apikey: NUVIO_ANON_KEY,
      Authorization: `Bearer ${NUVIO_ANON_KEY}`,
    },
    body: JSON.stringify({
      p_device_nonce: deviceNonce,
      p_redirect_base_url: NUVIO_DEFAULT_LINK_URL,
      p_device_name: "Harbor Desktop",
      p_device_type: "mobile",
    }),
  });

  if (!res.ok) {
    throw new Error(`Device code request failed (HTTP ${res.status})`);
  }

  const raw = await res.json();
  const data = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>;
  const userCode = String(data.user_code || data.code || "");
  const deviceCode = String(data.device_code || data.session_id || "");
  const verificationUri = String(data.verification_uri || NUVIO_DEFAULT_LINK_URL);
  const verificationUriComplete = String(
    data.verification_uri_complete || `${verificationUri}?code=${userCode}`,
  );

  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : 600,
    interval: typeof data.poll_interval_seconds === "number" ? data.poll_interval_seconds : 3,
    nonce: deviceNonce,
  };
}

/**
 * Polls the device code session. Returns null if pending, session if approved, or throws on error.
 */
export async function pollDeviceCodeSession(
  deviceCode: string,
  nonce: string,
): Promise<NuvioSession | null> {
  try {
    const res = await fetch(`${NUVIO_DEFAULT_API}/rest/v1/rpc/poll_tv_login_session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        apikey: NUVIO_ANON_KEY,
        Authorization: `Bearer ${NUVIO_ANON_KEY}`,
      },
      body: JSON.stringify({ p_code: deviceCode, p_device_nonce: nonce }),
    });

    if (!res.ok) return null;

    const raw = await res.json();
    const data = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>;
    const status = String(data.status || "").toLowerCase().trim();

    if (status === "approved" || data.access_token) {
      let tokenData = data;
      if (!data.access_token) {
        // Exchange session via official edge function
        const exchangeRes = await fetch(`${NUVIO_DEFAULT_API}/functions/v1/tv-logins-exchange`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: NUVIO_ANON_KEY,
            Authorization: `Bearer ${NUVIO_ANON_KEY}`,
          },
          body: JSON.stringify({ code: deviceCode, device_nonce: nonce }),
        });
        if (exchangeRes.ok) {
          tokenData = (await exchangeRes.json()) as Record<string, unknown>;
        }
      }

      if (tokenData.access_token) {
        const nowSec = Math.floor(Date.now() / 1000);
        const session: NuvioSession = {
          access_token: String(tokenData.access_token),
          refresh_token: String(tokenData.refresh_token || ""),
          expires_at: nowSec + (typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600),
          token_type: "bearer",
          user:
            (tokenData.user as NuvioSession["user"]) || { id: String(tokenData.user_id || "") },
        };

        const state = loadNuvioState();
        saveNuvioState({ ...state, session });
        await fetchNuvioProfiles();
        void fetchNuvioAddons().then(() => {
          window.dispatchEvent(new CustomEvent("harbor:nuvio-addons-changed"));
        });
        return session;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Full browser web authorization flow.
 * Starts session, opens browser to nuvio.tv/link?code=..., and polls until completed.
 */
export async function startNuvioWebAuth(
  onCode?: (info: { userCode: string; verificationUri: string }) => void,
): Promise<NuvioSession> {
  const sessionData = await startDeviceCodeSession();
  if (onCode) {
    onCode({
      userCode: sessionData.user_code,
      verificationUri: sessionData.verification_uri_complete,
    });
  }

  // Open official Nuvio device link in user's default browser
  openUrl(sessionData.verification_uri_complete);

  return new Promise<NuvioSession>((resolve, reject) => {
    let settled = false;
    const intervalMs = Math.max(2, sessionData.interval || 3) * 1000;
    const timeoutMs = 300_000; // 5 minutes

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(pollInterval);
      reject(new Error("Timed out waiting for browser authorization. Try again."));
    }, timeoutMs);

    const pollInterval = setInterval(async () => {
      if (settled) return;
      try {
        const session = await pollDeviceCodeSession(sessionData.device_code, sessionData.nonce);
        if (session && !settled) {
          settled = true;
          clearTimeout(timer);
          clearInterval(pollInterval);
          resolve(session);
        }
      } catch {
        /* keep polling until timeout */
      }
    }, intervalMs);
  });
}

/**
 * Fetches user profiles from Nuvio backend
 */
export async function fetchNuvioProfiles(): Promise<NuvioProfile[]> {
  try {
    const res = await nuvioFetch("/rest/v1/profiles?order=profile_index.asc");
    if (!res.ok) return [];

    const list = await res.json() as NuvioProfile[];
    if (Array.isArray(list)) {
      const state = loadNuvioState();
      saveNuvioState({ ...state, profiles: list });
      return list;
    }
    return [];
  } catch (e) {
    console.warn("[nuvio] failed to fetch profiles", e);
    return [];
  }
}

/**
 * Sign out of Nuvio
 */
export async function signOutNuvio(): Promise<void> {
  const state = loadNuvioState();
  const token = state.session?.access_token;

  clearNuvioSessionUnlocks();
  clearAllNuvioPinCaches();
  clearNuvioLibraryCache();
  clearCachedWatchProgress();
  clearCachedPlaybackItems();
  clearAllNuvioLocalCw();
  clearAllNuvioResume();
  clearCachedNuvioAddons();
  recordNuvioAddons([]);

  const wasNuvio = localStorage.getItem("harbor.account-provider") === "nuvio";
  if (wasNuvio) {
    try {
      localStorage.setItem("harbor.account-provider", "stremio");
      const raw = localStorage.getItem("harbor.settings");
      if (raw) {
        const p = JSON.parse(raw);
        localStorage.setItem("harbor.settings", JSON.stringify({ ...p, accountProvider: "stremio" }));
      }
      const sharedRaw = localStorage.getItem("harbor.settings.shared");
      if (sharedRaw) {
        const p = JSON.parse(sharedRaw);
        localStorage.setItem("harbor.settings.shared", JSON.stringify({ ...p, accountProvider: "stremio" }));
      }
    } catch {}
  }

  saveNuvioState({
    ...state,
    session: null,
    profiles: [],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  });

  if (wasNuvio) {
    window.dispatchEvent(
      new CustomEvent("harbor:account-provider-changed", { detail: { provider: "stremio", skipPicker: true } }),
    );
  }

  if (token) {
    try {
      await fetch(`${NUVIO_DEFAULT_API}/auth/v1/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: NUVIO_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      /* ignore network errors on signout */
    }
  }
}

