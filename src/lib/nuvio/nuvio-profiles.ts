/**
 * Nuvio Cloud Profiles RPC Client
 * Matches the canonical Supabase PostgREST RPC architecture in NuvioMobile.
 */

import {
  nuvioFetch,
  loadNuvioState,
  saveNuvioState,
  isNuvioSignedIn,
  getNuvioAccountId,
} from "./nuvio-client";
import { safeFetch } from "@/lib/safe-fetch";
import { pushAvatarToEcosystem } from "@/lib/account/avatar-sync";
import {
  fetchNuvioAddons,
  swapNuvioProfileCloudData,
  pullWatchedItemsFromNuvio,
  pullWatchProgressSnapshotFromNuvio,
  getWatchProgressKey,
  getWatchedItemsKey,
  getDismissedNextUpStorageKey,
  getNuvioAddonsCacheKey,
  getPendingSyncKey,
  remapPendingChangesProfileId,
} from "./nuvio-sync";
import { getPlaybackItemsKey } from "./nuvio-playback";
import { hashProfilePassword } from "@/lib/profile-password";
import type {
  NuvioProfile,
  ProfilePushPayload,
  PinVerifyResult,
  AvatarCatalogItem,
} from "./nuvio-types";

export const MAX_NUVIO_PROFILES = 6;

import DEFAULT_AVATAR_CATALOG from "./nuvio-avatar-catalog-data.json";

export const NUVIO_PROFILE_COLORS = [
  "#1E88E5",
  "#E53935",
  "#43A047",
  "#FB8C00",
  "#8E24AA",
  "#00ACC1",
  "#F4511E",
  "#3949AB",
  "#C0CA33",
  "#D81B60",
  "#00897B",
  "#5E35B1",
  "#7CB342",
  "#039BE5",
  "#FFB300",
  "#6D4C41",
];

const AVATAR_CATALOG_STORAGE_KEY = "harbor.nuvio.avatar_catalog";

function loadInitialAvatarCatalog(): AvatarCatalogItem[] {
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(AVATAR_CATALOG_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
  }
  return (DEFAULT_AVATAR_CATALOG as AvatarCatalogItem[]) || [];
}

let catalogCache: AvatarCatalogItem[] = loadInitialAvatarCatalog();

export function setAvatarCatalogCache(items: AvatarCatalogItem[]): void {
  catalogCache = items;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(AVATAR_CATALOG_STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }
}

export function getAvatarCatalogCache(): AvatarCatalogItem[] {
  return catalogCache;
}

export function getNuvioAvatarUrl(storagePathOrUrl: string | null | undefined): string | null {
  if (!storagePathOrUrl) return null;
  const cleaned = storagePathOrUrl.trim();
  if (!cleaned) return null;
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    return cleaned;
  }
  return `https://api.nuvio.tv/storage/v1/object/public/avatars/${cleaned}`;
}

export function resolveNuvioAvatar(
  profile: NuvioProfile | null | undefined,
  catalog?: AvatarCatalogItem[],
): string | null {
  if (!profile) return null;
  try {
    const kidRaw = localStorage.getItem(`harbor.nuvio.kid.${profile.profile_index}`);
    if (kidRaw) {
      const parsed = JSON.parse(kidRaw);
      if (parsed?.avatar) return parsed.avatar;
    }
  } catch {}
  const url = profile.avatar_url?.trim();
  if (
    url &&
    (url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("/") ||
      url.startsWith("data:"))
  ) {
    return url;
  }
  const avatarId = profile.avatar_id?.trim();
  if (avatarId) {
    const list = catalog && catalog.length > 0 ? catalog : catalogCache;
    const matched =
      list.find((item) => item.id === avatarId) ||
      (DEFAULT_AVATAR_CATALOG as AvatarCatalogItem[]).find((item) => item.id === avatarId);
    if (matched?.storage_path) {
      return getNuvioAvatarUrl(matched.storage_path);
    }
    if (avatarId.includes("/") || avatarId.endsWith(".png") || avatarId.endsWith(".webp")) {
      return getNuvioAvatarUrl(avatarId);
    }
    return getNuvioAvatarUrl(avatarId);
  }
  try {
    const local = localStorage.getItem(`harbor.nuvio.local-avatar.${profile.profile_index}`);
    if (local?.trim()) return local.trim();
  } catch {}
  return null;
}

/**
 * Pulls all profiles for the authenticated Nuvio user from Supabase.
 */
export async function pullNuvioProfiles(): Promise<NuvioProfile[]> {
  if (!isNuvioSignedIn()) return [];

  try {
    const res = await nuvioFetch("/rest/v1/rpc/sync_pull_profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      console.warn("[nuvio] sync_pull_profiles returned status", res.status);
      return loadNuvioState().profiles;
    }

    const data = (await res.json()) as NuvioProfile[];
    if (Array.isArray(data)) {
      const sorted = [...data].sort((a, b) => a.profile_index - b.profile_index);
      const merged = sorted.map((p) => {
        if (!p.avatar_url && !p.avatar_id) {
          try {
            const local = localStorage.getItem(`harbor.nuvio.local-avatar.${p.profile_index}`);
            if (local?.trim()) return { ...p, avatar_url: local.trim() };
          } catch {}
        } else if (p.avatar_url?.trim()) {
          try {
            localStorage.setItem(
              `harbor.nuvio.local-avatar.${p.profile_index}`,
              p.avatar_url.trim(),
            );
          } catch {}
        }
        return p;
      });
      const state = loadNuvioState();
      // Ensure activeProfileIndex is valid
      const activeIdx = merged.some((p) => p.profile_index === state.activeProfileIndex)
        ? state.activeProfileIndex
        : (merged[0]?.profile_index ?? 1);

      saveNuvioState({
        ...state,
        profiles: merged,
        activeProfileIndex: activeIdx,
        lastSyncedAt: Date.now(),
      });
      window.dispatchEvent(new CustomEvent("harbor:nuvio-profiles-updated", { detail: merged }));
      return merged;
    }
    return [];
  } catch (err) {
    console.error("[nuvio] failed to pull profiles", err);
    return loadNuvioState().profiles;
  }
}

/**
 * Pushes updated profile payload list to Nuvio using `sync_push_profiles`.
 */
export async function pushNuvioProfiles(payloads: ProfilePushPayload[]): Promise<boolean> {
  if (!isNuvioSignedIn()) {
    console.warn("[nuvio] pushNuvioProfiles: user is not signed in to Nuvio");
    return false;
  }
  if (!payloads || payloads.length === 0) {
    console.warn("[nuvio] pushNuvioProfiles: payloads array is empty");
    return false;
  }

  const cleanPayloads = payloads.map((p) => {
    let avatarUrl = (p.avatar_url ?? p.avatarUrl)?.trim() || null;
    if (
      avatarUrl &&
      (avatarUrl.startsWith("data:") || avatarUrl.length > 2048 || !avatarUrl.startsWith("http"))
    ) {
      avatarUrl = null;
    }
    let avatarId = (p.avatar_id ?? p.avatarId)?.trim() || null;
    if (avatarUrl) {
      avatarId = null;
    }
    const color = p.avatar_color_hex ?? p.avatarColorHex ?? "#1E88E5";

    return {
      profile_index: p.profile_index,
      name: (p.name || `Profile ${p.profile_index}`).trim(),
      avatar_color_hex: color,
      uses_primary_addons: Boolean(p.uses_primary_addons),
      uses_primary_plugins: Boolean(p.uses_primary_plugins),
      avatar_id: avatarId,
      avatar_url: avatarUrl,
      profile_background_id: p.profile_background_id || null,
      profile_background_url: p.profile_background_url || null,
      pin_enabled: Boolean(p.pin_enabled),
    };
  });

  const clientId = "harbor-desktop-sync-client-01";

  try {
    // 1. Try standard Nuvio signature (p_client_max_profiles, p_profiles, p_origin_client_id)
    let res = await nuvioFetch("/rest/v1/rpc/sync_push_profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_client_max_profiles: MAX_NUVIO_PROFILES,
        p_profiles: cleanPayloads,
        p_origin_client_id: clientId,
      }),
    });

    // 2. If 404 or 400 (function not found with p_origin_client_id in PostgREST), try without origin client id
    if (!res.ok && (res.status === 404 || res.status === 400)) {
      console.warn(
        "[nuvio] sync_push_profiles returned status",
        res.status,
        ", retrying without p_origin_client_id...",
      );
      res = await nuvioFetch("/rest/v1/rpc/sync_push_profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p_client_max_profiles: MAX_NUVIO_PROFILES,
          p_profiles: cleanPayloads,
        }),
      });
    }

    if (res.ok) {
      await pullNuvioProfiles();
      return true;
    }

    const errJson = await res.json().catch(() => null);
    const errText =
      errJson?.message || errJson?.hint || errJson?.details || (await res.text().catch(() => ""));
    console.error(
      "[nuvio] sync_push_profiles failed:",
      res.status,
      errText,
      "Payload sent:",
      cleanPayloads,
    );
    return false;
  } catch (err) {
    console.error("[nuvio] failed to push profiles", err);
    return false;
  }
}

/**
 * Uploads a custom avatar (Base64 data URL, local path, or Blob) to Supabase Storage
 * or a reliable permanent image CDN fallback, returning a public HTTPS URL.
 */
export async function uploadNuvioCustomAvatar(
  input: string | Blob,
  profileIndex: number,
): Promise<string | null> {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (
      (trimmed.startsWith("http://") || trimmed.startsWith("https://")) &&
      trimmed.length <= 2048
    ) {
      return trimmed;
    }
  }

  const timestamp = Date.now();
  let ext = "webp";
  let payloadFilename = `avatar_p${profileIndex}_${timestamp}.webp`;
  let blob: Blob | null = null;

  if (typeof input === "string") {
    if (input.startsWith("data:")) {
      const match = input.match(/^data:image\/([a-zA-Z0-9+]+);base64,/);
      if (match && match[1]) {
        ext = match[1] === "jpeg" ? "jpg" : match[1];
        payloadFilename = `avatar_p${profileIndex}_${timestamp}.${ext}`;
      }
      try {
        const res = await fetch(input);
        blob = await res.blob();
      } catch {
        try {
          const base64Data = input.split(",")[1];
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Uint8Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          blob = new Blob([byteNumbers], { type: match ? `image/${match[1]}` : "image/webp" });
        } catch {}
      }
    } else if (input.startsWith("/")) {
      const parts = input.split("/");
      payloadFilename = parts[parts.length - 1] || payloadFilename;
      try {
        const fullUrl =
          typeof window !== "undefined" && window.location?.origin
            ? `${window.location.origin}${input}`
            : input;
        const res = await fetch(fullUrl);
        blob = await res.blob();
      } catch {
        try {
          const res = await fetch(input);
          blob = await res.blob();
        } catch {}
      }
    }
  } else if (input instanceof Blob) {
    blob = input;
    if (blob.type.includes("jpeg") || blob.type.includes("jpg")) ext = "jpg";
    else if (blob.type.includes("png")) ext = "png";
    payloadFilename = `avatar_p${profileIndex}_${timestamp}.${ext}`;
  }

  // Upload via public image hosts (Catbox -> Tmpfiles -> Freeimage)
  if (blob) {
    // 2a. Catbox
    try {
      const fd = new FormData();
      fd.append("reqtype", "fileupload");
      fd.append("fileToUpload", blob, payloadFilename);

      const res = await safeFetch("https://catbox.moe/user/api.php", {
        method: "POST",
        body: fd,
      });

      if (res.ok) {
        const text = (await res.text()).trim();
        if (text.startsWith("http://") || text.startsWith("https://")) {
          console.log("[nuvio] Avatar uploaded via safeFetch (Catbox):", text);
          return text;
        }
      }
    } catch (catboxErr) {
      console.warn("[nuvio] Catbox safeFetch failed, trying tmpfiles:", catboxErr);
    }

    // 2b. Tmpfiles (returns direct image download link)
    try {
      const fdTmp = new FormData();
      fdTmp.append("file", blob, payloadFilename);

      const resTmp = await safeFetch("https://tmpfiles.org/api/v1/upload", {
        method: "POST",
        body: fdTmp,
      });

      if (resTmp.ok) {
        const json = (await resTmp.json()) as { status?: string; data?: { url?: string } };
        if (json?.status === "success" && json.data?.url) {
          const directUrl = json.data.url.replace("tmpfiles.org/", "tmpfiles.org/dl/");
          console.log("[nuvio] Avatar uploaded via safeFetch (Tmpfiles):", directUrl);
          return directUrl;
        }
      }
    } catch (tmpErr) {
      console.warn("[nuvio] Tmpfiles safeFetch failed, trying freeimage:", tmpErr);
    }

    // 2c. Freeimage
    try {
      const fd2 = new FormData();
      fd2.append("key", "6d207e02198a847aa98d0a2a901485a5");
      fd2.append("action", "upload");
      fd2.append("source", blob, payloadFilename);

      const res2 = await safeFetch("https://freeimage.host/api/1/upload", {
        method: "POST",
        body: fd2,
      });

      if (res2.ok) {
        const data = (await res2.json()) as { status_code?: number; image?: { url?: string } };
        const uploadedUrl = data?.image?.url;
        if (
          uploadedUrl &&
          (uploadedUrl.startsWith("http://") || uploadedUrl.startsWith("https://"))
        ) {
          console.log("[nuvio] Avatar uploaded via safeFetch (Freeimage):", uploadedUrl);
          return uploadedUrl;
        }
      }
    } catch (fiErr) {
      console.warn("[nuvio] Freeimage safeFetch failed:", fiErr);
    }
  }

  return null;
}

/**
 * Creates a new Nuvio profile slot (up to MAX_NUVIO_PROFILES).
 */
export async function createNuvioProfile(opts: {
  name: string;
  avatarColorHex?: string;
  avatarId?: string | null;
  avatarUrl?: string | null;
  usesPrimaryAddons?: boolean;
  profileIndex?: number;
}): Promise<boolean> {
  let state = loadNuvioState();
  if (!state.profiles || state.profiles.length === 0) {
    await pullNuvioProfiles();
    state = loadNuvioState();
  }
  const existing = state.profiles;
  if (existing.length >= MAX_NUVIO_PROFILES) {
    return false;
  }

  const existingIndices = new Set(existing.map((p) => p.profile_index));
  let nextIndex =
    opts.profileIndex &&
    !existingIndices.has(opts.profileIndex) &&
    opts.profileIndex >= 1 &&
    opts.profileIndex <= MAX_NUVIO_PROFILES
      ? opts.profileIndex
      : 1;
  while (nextIndex <= MAX_NUVIO_PROFILES && existingIndices.has(nextIndex)) {
    nextIndex++;
  }
  if (nextIndex > MAX_NUVIO_PROFILES) return false;

  let avatarUrl = opts.avatarUrl?.trim() || null;
  let avatarId = opts.avatarId ?? null;
  if (avatarUrl) {
    try {
      localStorage.setItem(`harbor.nuvio.local-avatar.${nextIndex}`, avatarUrl);
    } catch {}
  }
  if (avatarUrl && (avatarUrl.startsWith("data:") || avatarUrl.startsWith("/"))) {
    const uploaded = await uploadNuvioCustomAvatar(avatarUrl, nextIndex);
    if (uploaded) {
      avatarUrl = uploaded;
      avatarId = null;
      try {
        localStorage.setItem(`harbor.nuvio.local-avatar.${nextIndex}`, uploaded);
      } catch {}
    }
    if (nextIndex === 1 && avatarUrl) {
      void pushAvatarToEcosystem(avatarUrl);
    }
  }

  const payloads: ProfilePushPayload[] = existing.map((p) => ({
    profile_index: p.profile_index,
    name: p.name,
    avatar_color_hex: p.avatar_color_hex || "#1E88E5",
    uses_primary_addons: Boolean(p.uses_primary_addons),
    uses_primary_plugins: Boolean(p.uses_primary_plugins),
    avatar_id: p.avatar_id ?? null,
    avatar_url: p.avatar_url ?? null,
    profile_background_id: p.profile_background_id ?? null,
    profile_background_url: p.profile_background_url ?? null,
  }));

  payloads.push({
    profile_index: nextIndex,
    name: opts.name.trim() || `Profile ${nextIndex}`,
    avatar_color_hex:
      opts.avatarColorHex || NUVIO_PROFILE_COLORS[(nextIndex - 1) % NUVIO_PROFILE_COLORS.length],
    uses_primary_addons: Boolean(opts.usesPrimaryAddons),
    uses_primary_plugins: false,
    avatar_id: avatarId,
    avatar_url: avatarUrl,
  });

  // OPTIMISTIC LOCAL UPDATE: Immediately add to local state for 0ms latency
  const newProfile: NuvioProfile = {
    id: `temp-${nextIndex}`,
    user_id: state.session?.user?.id || existing[0]?.user_id || "",
    profile_index: nextIndex,
    name: opts.name.trim() || `Profile ${nextIndex}`,
    avatar_color_hex:
      opts.avatarColorHex || NUVIO_PROFILE_COLORS[(nextIndex - 1) % NUVIO_PROFILE_COLORS.length],
    uses_primary_addons: Boolean(opts.usesPrimaryAddons),
    uses_primary_plugins: false,
    avatar_id: avatarId,
    avatar_url: avatarUrl,
    pin_enabled: false,
    is_kids: false,
    created_at: new Date().toISOString(),
  };
  const updatedProfiles = [...existing.filter((p) => p.profile_index !== nextIndex), newProfile];
  updatedProfiles.sort((a, b) => a.profile_index - b.profile_index);
  saveNuvioState({ ...state, profiles: updatedProfiles });
  window.dispatchEvent(
    new CustomEvent("harbor:nuvio-profiles-updated", { detail: updatedProfiles }),
  );
  window.dispatchEvent(new CustomEvent("harbor:nuvio-profile-changed"));

  return pushNuvioProfiles(payloads);
}

/**
 * Updates a specific Nuvio profile.
 */
export async function updateNuvioProfile(
  profileIndex: number,
  updates: Partial<ProfilePushPayload>,
): Promise<boolean> {
  let state = loadNuvioState();
  if (!state.profiles || state.profiles.length === 0) {
    await pullNuvioProfiles();
    state = loadNuvioState();
  }
  const existing = state.profiles;

  let resolvedAvatarUrl: string | null | undefined = undefined;
  let resolvedAvatarId: string | null | undefined = undefined;

  const rawAvatarUrl = updates.avatar_url !== undefined ? updates.avatar_url : updates.avatarUrl;
  if (rawAvatarUrl !== undefined) {
    if (rawAvatarUrl === null || rawAvatarUrl === "") {
      resolvedAvatarUrl = null;
      resolvedAvatarId = null;
      try {
        localStorage.removeItem(`harbor.nuvio.local-avatar.${profileIndex}`);
      } catch {}
      const optimisticProfiles = existing.map((p) =>
        p.profile_index === profileIndex ? { ...p, avatar_url: null, avatar_id: null } : p,
      );
      saveNuvioState({ ...state, profiles: optimisticProfiles });
      window.dispatchEvent(
        new CustomEvent("harbor:nuvio-profiles-updated", { detail: optimisticProfiles }),
      );
      window.dispatchEvent(new CustomEvent("harbor:nuvio-profile-changed"));
    } else if (typeof rawAvatarUrl === "string") {
      const trimmed = rawAvatarUrl.trim();
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        resolvedAvatarUrl = trimmed;
        resolvedAvatarId = null;
        try {
          localStorage.setItem(`harbor.nuvio.local-avatar.${profileIndex}`, trimmed);
        } catch {}
        const optimisticProfiles = existing.map((p) =>
          p.profile_index === profileIndex ? { ...p, avatar_url: trimmed, avatar_id: null } : p,
        );
        saveNuvioState({ ...state, profiles: optimisticProfiles });
        window.dispatchEvent(
          new CustomEvent("harbor:nuvio-profiles-updated", { detail: optimisticProfiles }),
        );
        window.dispatchEvent(new CustomEvent("harbor:nuvio-profile-changed"));
      } else if (trimmed.startsWith("/kids/avatars/")) {
        resolvedAvatarUrl = trimmed;
        resolvedAvatarId = null;
        try {
          localStorage.setItem(`harbor.nuvio.local-avatar.${profileIndex}`, trimmed);
        } catch {}
        const optimisticProfiles = existing.map((p) =>
          p.profile_index === profileIndex ? { ...p, avatar_url: trimmed, avatar_id: null } : p,
        );
        saveNuvioState({ ...state, profiles: optimisticProfiles });
        window.dispatchEvent(
          new CustomEvent("harbor:nuvio-profiles-updated", { detail: optimisticProfiles }),
        );
        window.dispatchEvent(new CustomEvent("harbor:nuvio-profile-changed"));
        // Attempt upload in background to get permanent HTTPS URL for cloud
        void uploadNuvioCustomAvatar(trimmed, profileIndex).then((uploadedUrl) => {
          if (uploadedUrl) {
            try {
              localStorage.setItem(`harbor.nuvio.local-avatar.${profileIndex}`, uploadedUrl);
            } catch {}
            const currentProfiles = loadNuvioState().profiles.map((p) =>
              p.profile_index === profileIndex
                ? { ...p, avatar_url: uploadedUrl, avatar_id: null }
                : p,
            );
            saveNuvioState({ ...loadNuvioState(), profiles: currentProfiles });
            const payloads: ProfilePushPayload[] = currentProfiles.map((p) => ({
              profile_index: p.profile_index,
              name: p.name,
              avatar_color_hex: p.avatar_color_hex || "#1E88E5",
              uses_primary_addons: Boolean(p.uses_primary_addons),
              uses_primary_plugins: Boolean(p.uses_primary_plugins),
              avatar_id: null,
              avatar_url: p.avatar_url,
            }));
            void pushNuvioProfiles(payloads);
          }
        });
      } else if (trimmed.startsWith("data:") || trimmed.startsWith("/")) {
        // Optimistically apply local dataUrl or path to state so UI updates instantly (0ms)
        try {
          localStorage.setItem(`harbor.nuvio.local-avatar.${profileIndex}`, trimmed);
        } catch {}
        const optimisticProfiles = existing.map((p) =>
          p.profile_index === profileIndex ? { ...p, avatar_url: trimmed, avatar_id: null } : p,
        );
        saveNuvioState({ ...state, profiles: optimisticProfiles });
        window.dispatchEvent(
          new CustomEvent("harbor:nuvio-profiles-updated", { detail: optimisticProfiles }),
        );
        window.dispatchEvent(new CustomEvent("harbor:nuvio-profile-changed"));

        // If primary profile (slot 1), also push to Harbor ecosystem pfp
        if (profileIndex === 1) {
          void pushAvatarToEcosystem(trimmed);
        }

        // Upload to obtain public HTTPS URL for Nuvio Cloud
        const uploadedUrl = await uploadNuvioCustomAvatar(trimmed, profileIndex);
        if (uploadedUrl) {
          resolvedAvatarUrl = uploadedUrl;
          resolvedAvatarId = null;
          try {
            localStorage.setItem(`harbor.nuvio.local-avatar.${profileIndex}`, uploadedUrl);
          } catch {}
          const updatedWithRemoteUrl = loadNuvioState().profiles.map((p) =>
            p.profile_index === profileIndex
              ? { ...p, avatar_url: uploadedUrl, avatar_id: null }
              : p,
          );
          saveNuvioState({ ...loadNuvioState(), profiles: updatedWithRemoteUrl });
          window.dispatchEvent(
            new CustomEvent("harbor:nuvio-profiles-updated", { detail: updatedWithRemoteUrl }),
          );
          window.dispatchEvent(new CustomEvent("harbor:nuvio-profile-changed"));
          if (profileIndex === 1) {
            void pushAvatarToEcosystem(uploadedUrl);
          }
        } else {
          // Keep local dataUrl in Harbor so Harbor never loses the pfp!
          resolvedAvatarUrl = trimmed;
        }
      }
    }
  }

  const payloads: ProfilePushPayload[] = existing.map((p) => {
    if (p.profile_index === profileIndex) {
      const finalAvatarUrl =
        resolvedAvatarUrl !== undefined
          ? resolvedAvatarUrl
          : updates.avatar_url !== undefined
            ? updates.avatar_url
            : updates.avatarUrl !== undefined
              ? updates.avatarUrl
              : (p.avatar_url ?? null);

      const finalAvatarId =
        resolvedAvatarId !== undefined
          ? resolvedAvatarId
          : updates.avatar_id !== undefined
            ? updates.avatar_id
            : updates.avatarId !== undefined
              ? updates.avatarId
              : (p.avatar_id ?? null);

      return {
        profile_index: profileIndex,
        name: updates.name !== undefined ? updates.name.trim() : p.name,
        avatar_color_hex:
          updates.avatar_color_hex ?? updates.avatarColorHex ?? p.avatar_color_hex ?? "#1E88E5",
        uses_primary_addons:
          updates.uses_primary_addons !== undefined
            ? updates.uses_primary_addons
            : Boolean(p.uses_primary_addons),
        uses_primary_plugins: Boolean(p.uses_primary_plugins),
        avatar_id: finalAvatarUrl ? null : finalAvatarId,
        avatar_url: finalAvatarUrl,
        profile_background_id: p.profile_background_id ?? null,
        profile_background_url: p.profile_background_url ?? null,
      };
    }
    return {
      profile_index: p.profile_index,
      name: p.name,
      avatar_color_hex: p.avatar_color_hex || "#1E88E5",
      uses_primary_addons: Boolean(p.uses_primary_addons),
      uses_primary_plugins: Boolean(p.uses_primary_plugins),
      avatar_id: p.avatar_id ?? null,
      avatar_url: p.avatar_url ?? null,
      profile_background_id: p.profile_background_id ?? null,
      profile_background_url: p.profile_background_url ?? null,
    };
  });

  const chosenAvatarUrl =
    resolvedAvatarUrl !== undefined
      ? resolvedAvatarUrl
      : updates.avatar_url !== undefined
        ? updates.avatar_url
        : updates.avatarUrl !== undefined
          ? updates.avatarUrl
          : undefined;

  // OPTIMISTIC LOCAL UPDATE: Apply updates immediately to local state for 0ms lag
  const optimisticProfiles: NuvioProfile[] = existing.map((p) => {
    if (p.profile_index === profileIndex) {
      return {
        ...p,
        name: updates.name !== undefined ? updates.name.trim() : p.name,
        avatar_color_hex:
          updates.avatar_color_hex ?? updates.avatarColorHex ?? p.avatar_color_hex ?? "#1E88E5",
        uses_primary_addons:
          updates.uses_primary_addons !== undefined
            ? updates.uses_primary_addons
            : Boolean(p.uses_primary_addons),
        avatar_url: chosenAvatarUrl !== undefined ? chosenAvatarUrl : p.avatar_url,
      };
    }
    return p;
  });
  saveNuvioState({ ...state, profiles: optimisticProfiles });
  window.dispatchEvent(
    new CustomEvent("harbor:nuvio-profiles-updated", { detail: optimisticProfiles }),
  );
  window.dispatchEvent(new CustomEvent("harbor:nuvio-profile-changed"));

  const ok = await pushNuvioProfiles(payloads);
  if (ok) {
    window.dispatchEvent(new CustomEvent("harbor:nuvio-profiles-updated"));
  }
  return ok;
}

const nuvioSessionUnlockedIndices = new Set<number>();
const sessionPlaintextPins = new Map<number, string>();

/**
 * Transfers primary profile status to another Nuvio profile slot.
 * In Nuvio, Slot 1 is canonically the primary profile. Transferring primary
 * coordinates with the backend to swap identities, migrates cloud watch progress
 * and history, swaps server-side PIN credentials, and rolls back local state upon failure.
 */
export async function transferPrimaryNuvioProfile(
  targetSlotIndex: number,
  options?: {
    sourcePin?: string;
    targetPin?: string;
  },
): Promise<boolean> {
  if (!isNuvioSignedIn() || targetSlotIndex <= 1 || targetSlotIndex > 6) {
    return false;
  }
  // A child profile cannot become the primary profile
  try {
    const rawKid = localStorage.getItem(`harbor.nuvio.kid.${targetSlotIndex}`);
    if (rawKid && JSON.parse(rawKid)) return false;
  } catch {}

  const state = loadNuvioState();
  const slot1 = state.profiles.find((p) => p.profile_index === 1);
  const targetSlot = state.profiles.find((p) => p.profile_index === targetSlotIndex);
  if (!slot1 || !targetSlot) return false;

  // Resolve PIN credentials. A supplied PIN is verified here, so the transfer no
  // longer depends on the target profile having been unlocked earlier this session.
  const pinPlain1 = options?.sourcePin?.trim() || sessionPlaintextPins.get(1);
  const pinPlainTarget = options?.targetPin?.trim() || sessionPlaintextPins.get(targetSlotIndex);

  // If a profile has a PIN enabled, we MUST have its credentials to migrate it server-side.
  // Explicitly handle unavailable credentials before making any cloud or local modifications.
  if (slot1.pin_enabled) {
    if (!pinPlain1 || !pinPlain1.trim()) {
      console.warn(
        `[nuvio] Primary profile transfer aborted: Slot 1 has PIN enabled but plaintext credentials are not available.`,
      );
      return false;
    }
    if (!isNuvioProfileUnlocked(1)) {
      const verified = await verifyNuvioPin(1, pinPlain1, { skipProfilePull: true });
      if (!verified.unlocked) {
        console.warn("[nuvio] Primary profile transfer aborted: Slot 1 PIN was rejected.");
        return false;
      }
    }
  }
  if (targetSlot.pin_enabled) {
    if (!pinPlainTarget || !pinPlainTarget.trim()) {
      console.warn(
        `[nuvio] Primary profile transfer aborted: Slot ${targetSlotIndex} has PIN enabled but plaintext credentials are not available.`,
      );
      return false;
    }
    if (!isNuvioProfileUnlocked(targetSlotIndex)) {
      const verified = await verifyNuvioPin(targetSlotIndex, pinPlainTarget, {
        skipProfilePull: true,
      });
      if (!verified.unlocked) {
        console.warn(
          `[nuvio] Primary profile transfer aborted: Slot ${targetSlotIndex} PIN was rejected.`,
        );
        return false;
      }
    }
  }

  // Build the push payload for the backend
  const payloads: ProfilePushPayload[] = state.profiles.map((p) => {
    if (p.profile_index === 1) {
      return {
        profile_index: 1,
        name: targetSlot.name,
        avatar_id: targetSlot.avatar_id,
        avatar_url: targetSlot.avatar_url,
        avatar_color_hex: targetSlot.avatar_color_hex || "#1E88E5",
        uses_primary_addons: false,
        uses_primary_plugins: Boolean(targetSlot.uses_primary_plugins),
        profile_background_id: targetSlot.profile_background_id || null,
        profile_background_url: targetSlot.profile_background_url || null,
        pin_enabled: Boolean(targetSlot.pin_enabled),
      };
    }
    if (p.profile_index === targetSlotIndex) {
      return {
        profile_index: targetSlotIndex,
        name: slot1.name,
        avatar_id: slot1.avatar_id,
        avatar_url: slot1.avatar_url,
        avatar_color_hex: slot1.avatar_color_hex || "#1E88E5",
        uses_primary_addons: slot1.uses_primary_addons ?? true,
        uses_primary_plugins: Boolean(slot1.uses_primary_plugins),
        profile_background_id: slot1.profile_background_id || null,
        profile_background_url: slot1.profile_background_url || null,
        pin_enabled: Boolean(slot1.pin_enabled),
      };
    }
    return {
      profile_index: p.profile_index,
      name: p.name,
      avatar_id: p.avatar_id,
      avatar_url: p.avatar_url,
      avatar_color_hex: p.avatar_color_hex || "#1E88E5",
      uses_primary_addons: Boolean(p.uses_primary_addons),
      uses_primary_plugins: Boolean(p.uses_primary_plugins),
      profile_background_id: p.profile_background_id || null,
      profile_background_url: p.profile_background_url || null,
      pin_enabled: Boolean(p.pin_enabled),
    };
  });

  const accountId = getNuvioAccountId();
  if (!accountId) return false;

  // 1. HYDRATE BOTH SLOTS FROM THE CLOUD BEFORE TOUCHING ANYTHING.
  // A transfer must never migrate stale local caches: the target slot may
  // never have been opened on this device, and partial snapshots are rejected.
  try {
    const [watched1, watchedTarget, progress1, progressTarget] = await Promise.all([
      pullWatchedItemsFromNuvio(1, { force: true, allowInactiveSlot: true }),
      pullWatchedItemsFromNuvio(targetSlotIndex, { force: true, allowInactiveSlot: true }),
      pullWatchProgressSnapshotFromNuvio(1, accountId),
      pullWatchProgressSnapshotFromNuvio(targetSlotIndex, accountId),
    ]);
    if (
      watched1 === null ||
      watchedTarget === null ||
      progress1 === null ||
      progressTarget === null
    ) {
      console.warn(
        "[nuvio] Primary profile transfer aborted: could not read a complete cloud snapshot for both profiles",
      );
      return false;
    }
  } catch (err) {
    console.warn("[nuvio] Primary profile transfer aborted: cloud hydration failed", err);
    return false;
  }

  // 2. COORDINATE WITH BACKEND FIRST: Confirm cloud write succeeds before mutating local data
  const pushOk = await pushNuvioProfiles(payloads);
  if (!pushOk) {
    console.warn("[nuvio] Primary profile transfer aborted: backend rejected sync_push_profiles");
    return false;
  }

  // 3. BACKUP SNAPSHOT FOR ROLLBACK IN CASE CLOUD DATA MIGRATION FAILS
  const slotKeyPrefixes = [
    "harbor.localcw.v1.nuvio-",
    "harbor.localcw.private.v1.nuvio-",
    "harbor.resume.private.v1.nuvio-",
    "harbor.manualwatched.v1.nuvio.",
    "harbor.manualwatched.v1.nuvio.v2.",
    "harbor.manualunwatched.v1.nuvio.",
    "harbor.manualunwatched.v1.nuvio.v2.",
    "harbor.watchlist.v1.nuvio.",
    "harbor.cw.dismissed.private.v1.nuvio-",
    "harbor.installed-addons.nuvio-",
    "harbor.nuvio.playback_items.slot.",
    "harbor.nuvio.watch_progress.slot.",
    "harbor.nuvio.watched_items.slot.",
    "harbor.nuvio.addons.v1.slot.",
    "harbor.nuvio.dismissedNextUp.v1.",
    "harbor.nuvio.local_progress.",
    "harbor.moviewatched.nuvio.",
    "harbor.watchedFlag.nuvio.",
    "harbor.nuvio.local-avatar.",
    "harbor.nuvio.locked-tabs.",
  ];

  const keyPairs: Array<[string, string]> = [];
  for (const prefix of slotKeyPrefixes) {
    keyPairs.push([`${prefix}1`, `${prefix}${targetSlotIndex}`]);
  }

  // Account-scoped keys strictly for the authenticated account
  keyPairs.push([
    getPlaybackItemsKey(1, accountId),
    getPlaybackItemsKey(targetSlotIndex, accountId),
  ]);
  keyPairs.push([
    getWatchProgressKey(1, accountId),
    getWatchProgressKey(targetSlotIndex, accountId),
  ]);
  keyPairs.push([getWatchedItemsKey(1, accountId), getWatchedItemsKey(targetSlotIndex, accountId)]);
  keyPairs.push([
    getDismissedNextUpStorageKey(1, accountId),
    getDismissedNextUpStorageKey(targetSlotIndex, accountId),
  ]);
  keyPairs.push([
    getNuvioAddonsCacheKey(1, accountId),
    getNuvioAddonsCacheKey(targetSlotIndex, accountId),
  ]);
  keyPairs.push([getPinCacheKey(1, accountId), getPinCacheKey(targetSlotIndex, accountId)]);

  const storageBackup = new Map<string, string | null>();
  for (const [k1, kTarget] of keyPairs) {
    storageBackup.set(k1, localStorage.getItem(k1));
    storageBackup.set(kTarget, localStorage.getItem(kTarget));
  }

  // Pending sync mutations for authenticated account
  const pendingKey1 = getPendingSyncKey(1, accountId);
  const pendingKeyTarget = getPendingSyncKey(targetSlotIndex, accountId);
  storageBackup.set(pendingKey1, localStorage.getItem(pendingKey1));
  storageBackup.set(pendingKeyTarget, localStorage.getItem(pendingKeyTarget));

  const key1 = getPinCacheKey(1, accountId);
  const keyTarget = getPinCacheKey(targetSlotIndex, accountId);
  const pin1 = localStorage.getItem(key1);
  const pinTarget = localStorage.getItem(keyTarget);

  let cloudDataSwapped = false;
  let pinMigratedStage: "none" | "half" | "done" = "none";

  try {
    // 4. MIGRATE CLOUD WATCH HISTORY, PROGRESS, AND DATA BETWEEN SLOTS
    const swapCloudOk = await swapNuvioProfileCloudData(1, targetSlotIndex);
    if (!swapCloudOk) {
      throw new Error(
        `swapNuvioProfileCloudData failed to migrate cloud watch progress and history`,
      );
    }
    cloudDataSwapped = true;

    // 5. MIGRATE SERVER-SIDE PIN CREDENTIALS
    // We verify each operation succeeded. Both setNuvioPin and clearNuvioPin return { unlocked: boolean, message?: string }.
    // If backend rejects or fails, abort immediately and rollback to prevent credential mismatch.
    if (slot1.pin_enabled && !targetSlot.pin_enabled) {
      const setRes = await setNuvioPin(targetSlotIndex, pinPlain1!);
      if (!setRes.unlocked) {
        throw new Error(
          `Failed to set PIN on slot ${targetSlotIndex}: ${setRes.message || "rejected"}`,
        );
      }
      pinMigratedStage = "half";
      const clearRes = await clearNuvioPin(1, pinPlain1);
      if (!clearRes.unlocked) {
        throw new Error(`Failed to clear PIN on slot 1: ${clearRes.message || "rejected"}`);
      }
      pinMigratedStage = "done";
    } else if (!slot1.pin_enabled && targetSlot.pin_enabled) {
      const setRes = await setNuvioPin(1, pinPlainTarget!);
      if (!setRes.unlocked) {
        throw new Error(`Failed to set PIN on slot 1: ${setRes.message || "rejected"}`);
      }
      pinMigratedStage = "half";
      const clearRes = await clearNuvioPin(targetSlotIndex, pinPlainTarget);
      if (!clearRes.unlocked) {
        throw new Error(
          `Failed to clear PIN on slot ${targetSlotIndex}: ${clearRes.message || "rejected"}`,
        );
      }
      pinMigratedStage = "done";
    } else if (slot1.pin_enabled && targetSlot.pin_enabled) {
      const set1Res = await setNuvioPin(1, pinPlainTarget!, pinPlain1);
      if (!set1Res.unlocked) {
        throw new Error(`Failed to set PIN on slot 1: ${set1Res.message || "rejected"}`);
      }
      pinMigratedStage = "half";
      const setTargetRes = await setNuvioPin(targetSlotIndex, pinPlain1!, pinPlainTarget);
      if (!setTargetRes.unlocked) {
        throw new Error(
          `Failed to set PIN on slot ${targetSlotIndex}: ${setTargetRes.message || "rejected"}`,
        );
      }
      pinMigratedStage = "done";
    }

    // 6. SWAP LOCAL STORAGE AND PIN CACHES
    if (pinTarget) localStorage.setItem(key1, pinTarget);
    else localStorage.removeItem(key1);
    if (pin1) localStorage.setItem(keyTarget, pin1);
    else localStorage.removeItem(keyTarget);

    // Swap session plaintext PINs
    if (pinPlainTarget) sessionPlaintextPins.set(1, pinPlainTarget);
    else sessionPlaintextPins.delete(1);
    if (pinPlain1) sessionPlaintextPins.set(targetSlotIndex, pinPlain1);
    else sessionPlaintextPins.delete(targetSlotIndex);

    // Swap session unlocked indices
    const un1 = nuvioSessionUnlockedIndices.has(1);
    const unTarget = nuvioSessionUnlockedIndices.has(targetSlotIndex);
    if (unTarget) nuvioSessionUnlockedIndices.add(1);
    else nuvioSessionUnlockedIndices.delete(1);
    if (un1) nuvioSessionUnlockedIndices.add(targetSlotIndex);
    else nuvioSessionUnlockedIndices.delete(targetSlotIndex);

    localStorage.removeItem("harbor.nuvio.kid.1");
    localStorage.removeItem(`harbor.nuvio.kid.${targetSlotIndex}`);

    for (const [k1, kTarget] of keyPairs) {
      const v1 = storageBackup.get(k1);
      const vTarget = storageBackup.get(kTarget);
      if (vTarget !== null && vTarget !== undefined) localStorage.setItem(k1, vTarget);
      else localStorage.removeItem(k1);
      if (v1 !== null && v1 !== undefined) localStorage.setItem(kTarget, v1);
      else localStorage.removeItem(kTarget);
    }

    // Swap and remap pending sync mutations so embedded profile_id matches destination slot
    const rawPending1 = storageBackup.get(pendingKey1);
    const rawPendingTarget = storageBackup.get(pendingKeyTarget);

    if (rawPendingTarget !== null && rawPendingTarget !== undefined) {
      const remapped = remapPendingChangesProfileId(rawPendingTarget, 1);
      localStorage.setItem(pendingKey1, remapped ?? rawPendingTarget);
    } else {
      localStorage.removeItem(pendingKey1);
    }

    if (rawPending1 !== null && rawPending1 !== undefined) {
      const remapped = remapPendingChangesProfileId(rawPending1, targetSlotIndex);
      localStorage.setItem(pendingKeyTarget, remapped ?? rawPending1);
    } else {
      localStorage.removeItem(pendingKeyTarget);
    }

    // 7. UPDATE LOCAL PROFILE STATE
    const newSlot1: NuvioProfile = {
      ...targetSlot,
      profile_index: 1,
      uses_primary_addons: false,
    };
    const newTarget: NuvioProfile = {
      ...slot1,
      profile_index: targetSlotIndex,
      uses_primary_addons: slot1.uses_primary_addons ?? true,
    };
    const updatedProfiles = state.profiles.map((p) => {
      if (p.profile_index === 1) return newSlot1;
      if (p.profile_index === targetSlotIndex) return newTarget;
      return p;
    });

    let nextActive = state.activeProfileIndex;
    if (state.activeProfileIndex === targetSlotIndex) {
      nextActive = 1;
    } else if (state.activeProfileIndex === 1) {
      nextActive = targetSlotIndex;
    }

    saveNuvioState({
      ...state,
      profiles: updatedProfiles,
      activeProfileIndex: nextActive,
    });

    await pullNuvioProfiles();

    // 8. DISPATCH SYNC EVENTS
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("harbor:nuvio-profiles-updated", { detail: updatedProfiles }),
      );
      window.dispatchEvent(new CustomEvent("harbor:nuvio-profile-changed"));
      window.dispatchEvent(new CustomEvent("harbor:active-profile-changed"));
      window.dispatchEvent(new CustomEvent("harbor:secondary-privileges-changed"));
      window.dispatchEvent(new CustomEvent("harbor:nuvio-playback-updated"));
      window.dispatchEvent(new CustomEvent("harbor:local-cw-changed"));
    }

    return true;
  } catch (err) {
    console.error("[nuvio] Primary profile transfer failed, rolling back:", err);

    // ROLLBACK LOCAL STORAGE
    for (const [k, v] of storageBackup) {
      if (v !== null) localStorage.setItem(k, v);
      else localStorage.removeItem(k);
    }
    if (pin1) localStorage.setItem(key1, pin1);
    else localStorage.removeItem(key1);
    if (pinTarget) localStorage.setItem(keyTarget, pinTarget);
    else localStorage.removeItem(keyTarget);
    saveNuvioState(state);

    // Rollback cloud data if it was swapped
    if (cloudDataSwapped) {
      try {
        await swapNuvioProfileCloudData(1, targetSlotIndex);
      } catch (rbCloudErr) {
        console.error("[nuvio] Failed to rollback cloud data swap:", rbCloudErr);
      }
    }

    // Rollback server-side PINs if partially migrated
    if (pinMigratedStage === "half" || pinMigratedStage === "done") {
      try {
        if (slot1.pin_enabled && pinPlain1) {
          await setNuvioPin(1, pinPlain1).catch(() => {});
        } else {
          await clearNuvioPin(1).catch(() => {});
        }
        if (targetSlot.pin_enabled && pinPlainTarget) {
          await setNuvioPin(targetSlotIndex, pinPlainTarget).catch(() => {});
        } else {
          await clearNuvioPin(targetSlotIndex).catch(() => {});
        }
      } catch (rbPinErr) {
        console.error("[nuvio] Failed to rollback server-side PINs:", rbPinErr);
      }
    }

    // Rollback profiles in cloud
    const rollbackPayloads: ProfilePushPayload[] = state.profiles.map((p) => ({
      profile_index: p.profile_index,
      name: p.name,
      avatar_id: p.avatar_id,
      avatar_url: p.avatar_url,
      avatar_color_hex: p.avatar_color_hex || "#1E88E5",
      uses_primary_addons: Boolean(p.uses_primary_addons),
      uses_primary_plugins: Boolean(p.uses_primary_plugins),
      profile_background_id: p.profile_background_id || null,
      profile_background_url: p.profile_background_url || null,
      pin_enabled: Boolean(p.pin_enabled),
    }));
    await pushNuvioProfiles(rollbackPayloads).catch(() => {});

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("harbor:nuvio-playback-updated"));
      window.dispatchEvent(new CustomEvent("harbor:local-cw-changed"));
    }

    return false;
  }
}

export function getPinCacheKey(profileIndex: number, accountId?: string | null): string {
  const accountIdVal = accountId || getNuvioAccountId() || "anon";
  return `harbor.nuvio.pin_cache.${accountIdVal}.${profileIndex}`;
}

export function getCachedNuvioPinHash(profileIndex: number): string | null {
  try {
    return localStorage.getItem(getPinCacheKey(profileIndex));
  } catch {
    return null;
  }
}

export function clearAllNuvioPinCaches(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("harbor.nuvio.pin_cache.")) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (e) {
    console.warn("[nuvio-profiles] failed to clear pin caches", e);
  }
}

/**
 * Local PIN cache utilities (matches Nuvio Mobile ProfilePinCacheStorage).
 * Caches verified and set PIN digests for instantaneous 0ms profile unlocks.
 */
export async function rememberNuvioPin(profileIndex: number, pin: string): Promise<void> {
  try {
    const hash = await hashProfilePassword(pin);
    localStorage.setItem(getPinCacheKey(profileIndex), hash);
  } catch {}
}

export function forgetNuvioPin(profileIndex: number): void {
  try {
    localStorage.removeItem(getPinCacheKey(profileIndex));
  } catch {}
}

export async function verifyNuvioPinLocally(profileIndex: number, pin: string): Promise<boolean> {
  try {
    const cachedHash = localStorage.getItem(getPinCacheKey(profileIndex));
    if (!cachedHash) return false;
    const candidate = await hashProfilePassword(pin);
    return candidate === cachedHash;
  } catch {
    return false;
  }
}

/**
 * Deletes a Nuvio profile slot via `sync_delete_profile_data` and propagates the update.
 * Operates optimistically: immediately expunges from local state and UI, and executes
 * cloud sync and push in the background for a snappy user experience.
 */
export async function deleteNuvioProfile(profileIndex: number): Promise<boolean> {
  if (profileIndex === 1) return false; // Primary profile cannot be deleted

  // 1. OPTIMISTIC LOCAL UPDATE: Disappear immediately from UI and state!
  const state = loadNuvioState();
  const remaining = state.profiles.filter((p) => p.profile_index !== profileIndex);
  const active =
    state.activeProfileIndex === profileIndex
      ? (remaining[0]?.profile_index ?? 1)
      : state.activeProfileIndex;

  saveNuvioState({ ...state, profiles: remaining, activeProfileIndex: active });
  forgetNuvioPin(profileIndex);

  try {
    localStorage.removeItem(`harbor.nuvio.kid.${profileIndex}`);
    localStorage.removeItem(`harbor.nuvio.locked-tabs.${profileIndex}`);
    sessionStorage.removeItem(`harbor.nuvio.unlocked.${profileIndex}`);
  } catch {}

  window.dispatchEvent(new CustomEvent("harbor:nuvio-profiles-updated", { detail: remaining }));
  window.dispatchEvent(new CustomEvent("harbor:nuvio-profile-changed"));

  if (!isNuvioSignedIn()) {
    return true;
  }

  // 2. BACKGROUND CLOUD SYNC: Propagate deletion to Supabase and other devices asynchronously
  const clientId = "harbor-desktop-sync-client-01";
  (async () => {
    try {
      let res = await nuvioFetch("/rest/v1/rpc/sync_delete_profile_data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p_profile_id: profileIndex,
          p_origin_client_id: clientId,
        }),
      });

      if (!res.ok && (res.status === 404 || res.status === 400)) {
        res = await nuvioFetch("/rest/v1/rpc/sync_delete_profile_data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            p_profile_id: profileIndex,
          }),
        });
      }

      // Push remaining roster to ensure the profile slot is expunged across all other devices
      const remainingPayloads: ProfilePushPayload[] = remaining.map((p) => ({
        profile_index: p.profile_index,
        name: p.name,
        avatar_color_hex: p.avatar_color_hex || "#1E88E5",
        uses_primary_addons: Boolean(p.uses_primary_addons),
        uses_primary_plugins: Boolean(p.uses_primary_plugins),
        avatar_id: p.avatar_id ?? null,
        avatar_url: p.avatar_url ?? null,
        profile_background_id: p.profile_background_id ?? null,
        profile_background_url: p.profile_background_url ?? null,
      }));
      await pushNuvioProfiles(remainingPayloads);
      await pullNuvioProfiles();
    } catch (err) {
      console.warn("[nuvio] background profile deletion sync failed", err);
    }
  })();

  return true;
}

/**
 * Verifies a Nuvio profile's PIN via local cache first, then Supabase `verify_profile_pin`.
 */
export async function verifyNuvioPin(
  profileIndex: number,
  pin: string,
  options?: { skipProfilePull?: boolean },
): Promise<PinVerifyResult> {
  // 1. Fast local verification (0ms unlock without network roundtrip)
  const isMatchLocally = await verifyNuvioPinLocally(profileIndex, pin);
  if (isMatchLocally) {
    nuvioSessionUnlockedIndices.add(profileIndex);
    sessionPlaintextPins.set(profileIndex, pin);
    return { unlocked: true };
  }

  if (!isNuvioSignedIn()) {
    return { unlocked: false, message: "Not signed in to Nuvio" };
  }

  try {
    const res = await nuvioFetch("/rest/v1/rpc/verify_profile_pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_profile_id: profileIndex,
        p_pin: pin,
      }),
    });

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as { message?: string };
      return { unlocked: false, message: errJson.message || "Invalid PIN" };
    }

    const raw = await res.json();
    const data = Array.isArray(raw) ? raw[0] : raw;
    const unlocked = Boolean(data?.unlocked ?? (typeof raw === "boolean" ? raw : false));

    if (unlocked) {
      nuvioSessionUnlockedIndices.add(profileIndex);
      sessionPlaintextPins.set(profileIndex, pin);
      void rememberNuvioPin(profileIndex, pin);
      if (!options?.skipProfilePull) void pullNuvioProfiles();
    }

    return {
      unlocked,
      retry_after_seconds: data?.retry_after_seconds ?? 0,
      message: data?.message,
    };
  } catch (err) {
    console.error("[nuvio] failed to verify PIN", err);
    return { unlocked: false, message: "Network error verifying PIN" };
  }
}

/**
 * Sets or updates a Nuvio profile's PIN via `set_profile_pin`.
 */
export async function setNuvioPin(
  profileIndex: number,
  pin: string,
  currentPin?: string,
): Promise<PinVerifyResult> {
  if (!isNuvioSignedIn()) {
    return { unlocked: false, message: "Not signed in to Nuvio" };
  }

  try {
    const body: Record<string, any> = {
      p_profile_id: profileIndex,
      p_pin: pin,
    };
    if (currentPin && currentPin.trim()) {
      body.p_current_pin = currentPin.trim();
    }

    const res = await nuvioFetch("/rest/v1/rpc/set_profile_pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as { message?: string };
      return { unlocked: false, message: errJson.message || "Failed to set PIN" };
    }

    const raw = await res.json().catch(() => null);
    const data = Array.isArray(raw) ? raw[0] : raw;
    if (data && typeof data === "object") {
      if (data.unlocked === false) {
        return { unlocked: false, message: data.message || "Failed to set PIN" };
      }
    } else if (raw === false) {
      return { unlocked: false, message: "Failed to set PIN" };
    }

    nuvioSessionUnlockedIndices.add(profileIndex);
    sessionPlaintextPins.set(profileIndex, pin);
    void rememberNuvioPin(profileIndex, pin);
    await pullNuvioProfiles();
    return { unlocked: true };
  } catch (err) {
    console.error("[nuvio] failed to set PIN", err);
    return { unlocked: false, message: "Network error setting PIN" };
  }
}

/**
 * Clears/removes a Nuvio profile's PIN via `clear_profile_pin`.
 */
export async function clearNuvioPin(
  profileIndex: number,
  currentPin?: string,
): Promise<PinVerifyResult> {
  if (!isNuvioSignedIn()) {
    return { unlocked: false, message: "Not signed in to Nuvio" };
  }

  try {
    const body: Record<string, any> = {
      p_profile_id: profileIndex,
    };
    if (currentPin && currentPin.trim()) {
      body.p_current_pin = currentPin.trim();
    }

    const res = await nuvioFetch("/rest/v1/rpc/clear_profile_pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as { message?: string };
      console.warn("[nuvio] clear_profile_pin RPC failure:", errJson);
      return { unlocked: false, message: errJson.message || "Failed to clear PIN on server" };
    }

    const raw = await res.json().catch(() => null);
    const data = Array.isArray(raw) ? raw[0] : raw;
    if (data && typeof data === "object") {
      if (data.unlocked === false) {
        return { unlocked: false, message: data.message || "Failed to clear PIN on server" };
      }
    } else if (raw === false) {
      return { unlocked: false, message: "Failed to clear PIN on server" };
    }

    forgetNuvioPin(profileIndex);
    sessionPlaintextPins.delete(profileIndex);
    nuvioSessionUnlockedIndices.delete(profileIndex);

    // Update local state directly so UI updates instantly without waiting
    const state = loadNuvioState();
    const updatedProfiles = state.profiles.map((p) =>
      p.profile_index === profileIndex ? { ...p, pin_enabled: false } : p,
    );
    saveNuvioState({ ...state, profiles: updatedProfiles });

    await pullNuvioProfiles();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("harbor:nuvio-profile-changed"));
      window.dispatchEvent(new CustomEvent("harbor:nuvio-profiles-updated"));
    }
    return { unlocked: true };
  } catch (err) {
    console.error("[nuvio] failed to clear PIN", err);
    return { unlocked: false, message: "Network error clearing PIN" };
  }
}

/**
 * Fetches the official Nuvio avatar catalog from `get_avatar_catalog`.
 */
export async function fetchNuvioAvatarCatalog(): Promise<AvatarCatalogItem[]> {
  try {
    const res = await nuvioFetch("/rest/v1/rpc/get_avatar_catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!res.ok) return catalogCache;
    const items = (await res.json()) as AvatarCatalogItem[];
    if (Array.isArray(items)) {
      const active = items.filter((i) => i.is_active);
      setAvatarCatalogCache(active);
      return active;
    }
    return catalogCache;
  } catch (err) {
    console.warn("[nuvio] failed to fetch avatar catalog", err);
    return catalogCache;
  }
}

export function isNuvioProfileLocked(profile: NuvioProfile | null | undefined): boolean {
  return Boolean(profile?.pin_enabled);
}

export function isNuvioProfileUnlocked(profileIndex: number): boolean {
  return nuvioSessionUnlockedIndices.has(profileIndex);
}

export function markNuvioProfileUnlocked(profileIndex: number): void {
  nuvioSessionUnlockedIndices.add(profileIndex);
}

export function clearNuvioSessionUnlocks(): void {
  nuvioSessionUnlockedIndices.clear();
  sessionPlaintextPins.clear();
}

export function refuseNuvioProfileSelect(
  target: NuvioProfile | null | undefined,
  unlockedIndices: ReadonlySet<number>,
  opts?: { unlocked?: boolean },
): boolean {
  if (!target) return true;
  if (opts?.unlocked === true) return false;
  if (!isNuvioProfileLocked(target)) return false;
  return !unlockedIndices.has(target.profile_index);
}

/**
 * Sets the active Nuvio profile index (1..6).
 * Gated by PIN verification if profile has pin_enabled.
 */
export function setActiveNuvioProfile(
  profileIndex: number,
  opts?: { unlocked?: boolean },
): boolean {
  const state = loadNuvioState();
  const bounded = Math.max(1, Math.min(MAX_NUVIO_PROFILES, profileIndex));
  const target = state.profiles.find((p) => p.profile_index === bounded);

  if (refuseNuvioProfileSelect(target, nuvioSessionUnlockedIndices, opts)) {
    console.warn(
      `[nuvio] Refusing switch to locked profile slot ${bounded} without PIN verification`,
    );
    return false;
  }

  // Clear previous session unlocks when switching profiles so other profiles don't stay unlocked
  nuvioSessionUnlockedIndices.clear();
  if (opts?.unlocked) {
    nuvioSessionUnlockedIndices.add(bounded);
  }

  if (state.activeProfileIndex === bounded) return true;

  saveNuvioState({ ...state, activeProfileIndex: bounded });
  window.dispatchEvent(
    new CustomEvent("harbor:nuvio-profile-changed", { detail: { profileIndex: bounded } }),
  );
  void fetchNuvioAddons(bounded).then(() => {
    window.dispatchEvent(new CustomEvent("harbor:nuvio-addons-changed"));
  });
  return true;
}

/**
 * Gets the current active Nuvio profile object.
 */
export function getActiveNuvioProfile(): NuvioProfile | null {
  const state = loadNuvioState();
  return (
    state.profiles.find((p) => p.profile_index === state.activeProfileIndex) ||
    state.profiles[0] ||
    null
  );
}
