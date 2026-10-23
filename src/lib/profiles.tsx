import { purgeGameNotes } from "./games/game-notes";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { anyTabLocked, type HiddenTabs } from "./lockable-tabs";
import type { ContentFilters } from "./settings";
import { isRemovedBuiltinAvatar } from "./avatars/catalog";
import { deleteProfileBgImage } from "./theme-storage";
// Concrete modules, not the barrel: it re-exports ProfileSyncRunner, and pulling the
// whole sync layer in from the profile provider is how a cycle gets built by accident.
import { configureRosterStore } from "./profile-sync/roster-store";
import { noteProfileDeleted } from "./profile-sync/roster-section";
import { refuseProfileSelect } from "./profile-sync/profile-lock";
import type { LocalProfileLike } from "./profile-sync/types";
import type { NuvioProfile } from "./nuvio/nuvio-types";
import { loadNuvioState } from "./nuvio/nuvio-client";
import {
  clearNuvioSessionUnlocks,
  isNuvioProfileUnlocked,
  setActiveNuvioProfile,
  resolveNuvioAvatar,
  updateNuvioProfile,
  deleteNuvioProfile,
  transferPrimaryNuvioProfile,
} from "./nuvio/nuvio-profiles";

export const PROFILE_COLORS = [
  "#7dd3fc",
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#fb7185",
  "#fb923c",
  "#fbbf24",
  "#a3e635",
  "#34d399",
  "#22d3ee",
] as const;

export type ProfileColor = string;

export function defaultNuvioHarborProfile(slot = 1): Profile {
  return {
    id: `nuvio-${slot}`,
    name: slot === 1 ? "Primary" : `Profile ${slot}`,
    avatar: null,
    color: PROFILE_COLORS[(slot - 1) % PROFILE_COLORS.length],
    isPrimary: slot === 1,
    shareStremioWith: null,
    passwordHash: null,
    hideContent: null,
    lockedTabs: null,
    kid: null,
    createdAt: Date.now(),
  };
}

function nuvioProfileToHarborProfile(p: NuvioProfile): Profile {
  let lockedTabs: HiddenTabs | null = null;
  try {
    const raw = localStorage.getItem(`harbor.nuvio.locked-tabs.${p.profile_index}`);
    if (raw) lockedTabs = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {
    id: `nuvio-${p.profile_index}`,
    name: p.name || `Profile ${p.profile_index}`,
    avatar: resolveNuvioAvatar(p),
    color: p.avatar_color_hex || PROFILE_COLORS[(p.profile_index - 1) % PROFILE_COLORS.length],
    isPrimary: p.profile_index === 1,
    shareStremioWith: null,
    passwordHash: p.pin_enabled ? "pin-protected" : null,
    hideContent: null,
    lockedTabs,
    kid: p.is_kids ? { age: 7, curfewMinutes: null, parentPinHash: null } : null,
    createdAt: p.created_at ? new Date(p.created_at).getTime() : Date.now(),
  };
}

export type KidConfig = {
  age: number;
  curfewMinutes: number | null;
  parentPinHash: string | null;
};

export const DEFAULT_KID: KidConfig = { age: 7, curfewMinutes: null, parentPinHash: null };

// Every namespaced key a profile owns. Kept as one list because deleteProfile and the
// sync roster apply both purge, and a key that only one of them knows about is a leak
// that outlives the profile.
const PROFILE_KEY_PREFIXES = [
  "harbor.games.sims.folder:",
  "harbor.games.ffxiv.center:",
  "harbor.games.eve.route:",
  "harbor.auth.",
  "harbor.games.search-view:",
  "harbor.games.download-notified.v1.",
  "harbor.theme-session.",
  "harbor.localcw.v1.",
  "harbor.localcw.private.v1.",
  "harbor.resume.private.v1.",
  "harbor.cw.dismissed.private.v1.",
  "harbor.favorites.v1.",
  "harbor.charfavorites.v1.",
  "harbor.mangafav.v1.",
  "harbor.mangaread.v1.",
  "harbor.manga.match.mal.v1.",
  "harbor.manga.match.anilist.v1.",
  "harbor.localwatchlist.v1.",
  "harbor.settings.",
  "harbor.nuvio.profile-map.",
  "harbor.trakt.session.v1.",
  "harbor.simkl.session.v1.",
  "harbor.anilist.session.v1.",
  "harbor.mal.session.v1.",
  "harbor.simkl.cache.v2.",
  "harbor.anilist.synced.v1.",
  "harbor.mal.synced.v1.",
  "harbor.moviewatched.v1.",
  "harbor.watchedFlag.v1.",
  "harbor.manualwatched.v1.",
  "harbor.manualunwatched.v1.",
  "harbor.manualwatched.meta.v1.",
  "harbor.manualwatched.dismissed.v1.",
  "harbor.manualunwatched.at.v1.",
  "harbor.manualwatched.fromremote.v1.",
  "harbor.watchevents.v1.",
  "harbor.playback-history.v1.",
  "harbor.watchlist.v1.",
  "harbor.watchlist.aggregate.v1.",
  "harbor.installed-addons.",
  "harbor.addons.disabled.",
  "harbor.stremio.freshwatched.v1.",
];

function purgeProfileStorage(id: string): void {
  try { purgeGameNotes(id); } catch { /* Keep the existing profile cleanup best-effort. */ }
  try {
    for (const prefix of PROFILE_KEY_PREFIXES) localStorage.removeItem(`${prefix}${id}`);
    localStorage.removeItem(`harbor.games.search-history.v1:${encodeURIComponent(id)}`);
    localStorage.removeItem(`harbor.league.pool:${encodeURIComponent(id)}`);
    const tftPrefix = `harbor.games.tft.teams:${encodeURIComponent(id)}:`;
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(tftPrefix)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

/**
 * The wire carries no secrets and no shareStremioWith, so those come off the profile
 * being replaced rather than being dropped. A parentPinHash lost here would silently
 * unlock a kid profile on the device that adopted the roster.
 */
function adoptProfile(
  next: LocalProfileLike,
  prev: Profile | undefined,
  fallbackColor: ProfileColor,
): Profile {
  return {
    id: next.id,
    name: next.name,
    avatar: next.avatar,
    color: next.color || prev?.color || fallbackColor,
    isPrimary: next.isPrimary,
    shareStremioWith: prev?.shareStremioWith ?? null,
    passwordHash: next.passwordHash ?? prev?.passwordHash ?? null,
    hideContent: (next.hideContent as ContentFilters | null) ?? null,
    lockedTabs: (next.lockedTabs as HiddenTabs | null) ?? null,
    kid: next.isPrimary
      ? null
      : next.kid
        ? {
            age: next.kid.age,
            curfewMinutes: next.kid.curfewMinutes,
            parentPinHash: next.kid.parentPinHash ?? prev?.kid?.parentPinHash ?? null,
          }
        : null,
    settingsLinked: next.settingsLinked !== false,
    createdAt: next.createdAt,
  };
}

export type Profile = {
  id: string;
  name: string;
  avatar: string | null;
  color: ProfileColor;
  isPrimary: boolean;
  shareStremioWith: string | null;
  passwordHash: string | null;
  hideContent: ContentFilters | null;
  lockedTabs: HiddenTabs | null;
  kid: KidConfig | null;
  settingsLinked?: boolean;
  createdAt: number;
};

type ProfilesState = {
  profiles: Profile[];
  activeId: string | null;
};

export type PickerView =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; profileId: string }
  | { kind: "unlock"; profileId: string }
  | { kind: "unlock-for-edit"; profileId: string };

type ProfilesValue = {
  profiles: Profile[];
  activeId: string | null;
  activeProfile: Profile | null;
  pickerOpen: boolean;
  pickerView: PickerView;
  openPicker: (view?: PickerView) => void;
  setPickerView: (view: PickerView) => void;
  closePicker: () => void;
  /** False when the profile is locked and this call did not prove the PIN. */
  selectProfile: (id: string, opts?: { unlocked?: boolean }) => boolean;
  sessionUnlockedIds: Set<string>;
  createProfile: (input: {
    name: string;
    avatar?: string | null;
    color: ProfileColor;
    kid?: KidConfig | null;
  }) => Profile;
  updateProfile: (
    id: string,
    patch: Partial<Omit<Profile, "id" | "createdAt" | "isPrimary">>,
  ) => void;
  deleteProfile: (id: string) => void;
  setPrimary: (id: string) => void;
  isCurrentProfileLocked: () => boolean;
  clearSessionUnlocks: () => void;
};

const STORAGE_KEY = "harbor.profiles.v1";
const TOGETHER_NAME_KEY = "harbor.together.name";
const SETTINGS_KEY = "harbor.settings";
const SHARED_SETTINGS_KEY = "harbor.settings.shared";
const LEGACY_PARENTAL_KEY = "harbor.parental";

function readLaunchSettingsRaw(): string | null {
  try {
    return localStorage.getItem(SHARED_SETTINGS_KEY) ?? localStorage.getItem(SETTINGS_KEY);
  } catch {
    return null;
  }
}

function readLegacyParental(): { hiddenTabs: HiddenTabs | null; hadPin: boolean } {
  try {
    const raw = localStorage.getItem(LEGACY_PARENTAL_KEY);
    if (!raw) return { hiddenTabs: null, hadPin: false };
    const parsed = JSON.parse(raw) as { hiddenTabs?: HiddenTabs; pinHash?: string | null };
    const hidden = parsed.hiddenTabs ?? null;
    const hadAny = !!hidden && Object.values(hidden).some(Boolean);
    return {
      hiddenTabs: hadAny ? hidden : null,
      hadPin: typeof parsed.pinHash === "string" && parsed.pinHash.length > 0,
    };
  } catch {
    return { hiddenTabs: null, hadPin: false };
  }
}

function generateGuestName(): string {
  return `Guest ${1000 + Math.floor(Math.random() * 9000)}`;
}

const PLACEHOLDER_NAMES = new Set(["Me", "You", "Profile"]);

export function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_NAMES.has(trimmed)) return true;
  return /^Guest \d+$/.test(trimmed);
}

function defaultPrimaryName(): string {
  try {
    const existing = localStorage.getItem(TOGETHER_NAME_KEY)?.trim();
    if (existing && !isPlaceholderName(existing)) return existing;
  } catch {
    return generateGuestName();
  }
  return generateGuestName();
}

function readSettingsIdentity(): { color: string | null; avatar: string | null } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { color: null, avatar: null };
    const parsed = JSON.parse(raw) as { harborColor?: unknown; harborAvatar?: unknown };
    const color =
      typeof parsed.harborColor === "string" && /^#[0-9a-f]{6}$/i.test(parsed.harborColor)
        ? parsed.harborColor
        : null;
    const avatar =
      typeof parsed.harborAvatar === "string" && parsed.harborAvatar.length > 0
        ? parsed.harborAvatar
        : null;
    return { color, avatar };
  } catch {
    return { color: null, avatar: null };
  }
}

type ProfilePromptInterval = "launch" | "15m" | "30m" | "never";
function readProfilePromptInterval(): ProfilePromptInterval {
  try {
    const raw = readLaunchSettingsRaw();
    if (!raw) return "launch";
    const parsed = JSON.parse(raw) as {
      profilePromptInterval?: unknown;
      skipProfileScreen?: unknown;
    };
    const v = parsed.profilePromptInterval;
    if (v === "launch" || v === "15m" || v === "30m" || v === "never") return v;
    return parsed.skipProfileScreen === true ? "never" : "launch";
  } catch {
    return "launch";
  }
}
function intervalMinutes(i: ProfilePromptInterval): number {
  return i === "15m" ? 15 : i === "30m" ? 30 : 0;
}
function readDefaultProfileId(): string {
  try {
    const raw = readLaunchSettingsRaw();
    if (!raw) return "";
    const v = (JSON.parse(raw) as { defaultProfileId?: unknown }).defaultProfileId;
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}
function launchDefault(profiles: Profile[]): Profile | null {
  const id = readDefaultProfileId();
  if (!id) return null;
  const p = profiles.find((x) => x.id === id);
  return p && !p.passwordHash ? p : null;
}
const LAST_SELECT_KEY = "harbor.profile.lastSelectAt";
function readLastProfileSelectAt(): number {
  try {
    return Number(localStorage.getItem(LAST_SELECT_KEY)) || 0;
  } catch {
    return 0;
  }
}
function markProfileSelectedNow(): void {
  try {
    localStorage.setItem(LAST_SELECT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

// Module-level on purpose: sessionStorage can survive across app launches in the webview, which suppressed this prompt.
let pickerPromptShownThisRun = false;

export function readActiveProfileIdentity(): {
  id: string;
  name: string;
  avatar: string | null;
  color: string;
} | null {
  try {
    if (isNuvioProviderActive()) {
      const nuvioState = loadNuvioState();
      const slot = nuvioState.activeProfileIndex || 1;
      const active = nuvioState.profiles.find((p) => p.profile_index === slot) || nuvioState.profiles[0];
      if (active) {
        return {
          id: `nuvio-${active.profile_index}`,
          name: active.name || `Profile ${active.profile_index}`,
          avatar: resolveNuvioAvatar(active),
          color: active.avatar_color_hex || PROFILE_COLORS[(active.profile_index - 1) % PROFILE_COLORS.length],
        };
      }
      return {
        id: "nuvio-1",
        name: "Primary",
        avatar: null,
        color: PROFILE_COLORS[0],
      };
    }
    const { profiles, activeId } = readState();
    if (!profiles.length) return null;
    const active =
      profiles.find((p) => p.id === activeId) ?? profiles.find((p) => p.isPrimary) ?? profiles[0];
    return active
      ? { id: active.id, name: active.name, avatar: active.avatar, color: `${active.color}` }
      : null;
  } catch {
    return null;
  }
}

export function readAllProfilesIdentity(): Array<{
  id: string;
  name: string;
  avatar: string | null;
  color: string;
}> {
  try {
    if (isNuvioProviderActive()) {
      const nuvioState = loadNuvioState();
      if (nuvioState.profiles.length > 0) {
        return nuvioState.profiles.map((p) => ({
          id: `nuvio-${p.profile_index}`,
          name: p.name || `Profile ${p.profile_index}`,
          avatar: resolveNuvioAvatar(p),
          color: p.avatar_color_hex || PROFILE_COLORS[(p.profile_index - 1) % PROFILE_COLORS.length],
        }));
      }
      return [{
        id: "nuvio-1",
        name: "Primary",
        avatar: null,
        color: PROFILE_COLORS[0],
      }];
    }
    return readState().profiles.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      color: `${p.color}`,
    }));
  } catch {
    return [];
  }
}

function readState(): ProfilesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { profiles: [], activeId: null };
    const parsed = JSON.parse(raw) as ProfilesState;
    if (!parsed || !Array.isArray(parsed.profiles)) {
      return { profiles: [], activeId: null };
    }
    if (parsed.profiles.length === 0) {
      return { profiles: [], activeId: null };
    }

    // Determine the single true primary profile (must be adult, non-kid)
    let primaryIndex = parsed.profiles.findIndex((p) => p.isPrimary && !p.kid);
    if (primaryIndex === -1) {
      primaryIndex = parsed.profiles.findIndex((p) => !p.kid);
    }
    if (primaryIndex === -1) {
      primaryIndex = 0;
    }
    const primaryId = parsed.profiles[primaryIndex]?.id ?? null;

    const fallbackName = defaultPrimaryName();
    const identity = readSettingsIdentity();
    const legacyParental = readLegacyParental();
    const migrated = parsed.profiles.map((p, idx) => {
      const next = { ...p };
      const isThisPrimary = idx === primaryIndex;
      next.isPrimary = isThisPrimary;

      if (typeof p.shareStremioWith === "undefined") {
        next.shareStremioWith = isThisPrimary ? null : primaryId;
      }
      if (typeof p.passwordHash === "undefined") {
        next.passwordHash = null;
      }
      if (typeof p.hideContent === "undefined") {
        next.hideContent = null;
      }
      if (typeof p.lockedTabs === "undefined") {
        next.lockedTabs = isThisPrimary ? legacyParental.hiddenTabs : null;
      }
      if (isThisPrimary || typeof p.kid === "undefined" || p.kid == null) {
        next.kid = null;
      } else {
        next.kid = {
          age: p.kid.age ?? 7,
          curfewMinutes: p.kid.curfewMinutes ?? null,
          parentPinHash: p.kid.parentPinHash ?? null,
        };
      }
      if (isThisPrimary) {
        if (isPlaceholderName(p.name)) next.name = fallbackName;
        if (identity.color) next.color = identity.color;
        if (
          p.avatar == null &&
          identity.avatar != null &&
          !identity.avatar.startsWith("/kids/avatars/")
        ) {
          next.avatar = identity.avatar;
        }
      }
      if (
        next.kid == null &&
        typeof next.avatar === "string" &&
        next.avatar.startsWith("/kids/avatars/")
      ) {
        next.avatar = null;
      }
      if (isRemovedBuiltinAvatar(next.avatar)) {
        next.avatar = null;
      }
      return next;
    });

    const activeId = migrated.some((p) => p.id === parsed.activeId)
      ? parsed.activeId
      : (migrated[primaryIndex]?.id ?? null);

    return { profiles: migrated, activeId };
  } catch {
    return { profiles: [], activeId: null };
  }
}

function writeState(state: ProfilesState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    return;
  }
}

function pickColor(existing: Profile[]): ProfileColor {
  const used = new Set(existing.map((p) => p.color));
  const free = PROFILE_COLORS.find((c) => !used.has(c));
  return free ?? PROFILE_COLORS[existing.length % PROFILE_COLORS.length];
}

function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function migrateLegacyStremioAuth(profiles: Profile[]): void {
  try {
    if (localStorage.getItem("harbor.auth.migrated.v1")) return;
    const primary = profiles.find((p) => p.isPrimary) ?? profiles[0];
    const legacy = localStorage.getItem("harbor.auth");
    if (primary && legacy && !localStorage.getItem(`harbor.auth.${primary.id}`)) {
      let valid = false;
      try {
        const parsed = JSON.parse(legacy) as { authKey?: unknown; user?: unknown };
        valid = typeof parsed?.authKey === "string" && parsed.authKey.length > 0 && !!parsed.user;
      } catch {
        valid = false;
      }
      if (valid) localStorage.setItem(`harbor.auth.${primary.id}`, legacy);
    }
    localStorage.setItem("harbor.auth.migrated.v1", "1");
  } catch {
    /* ignore */
  }
}

const Ctx = createContext<ProfilesValue | null>(null);

// Auxiliary player windows follow the selected profile. They must never run the
// application's launch selection, migration or roster persistence a second time.
export function CompanionProfilesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(readState);
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) setState(readState());
    };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  const value = useMemo<ProfilesValue>(() => {
    const mainWindowOnly = (): never => {
      throw new Error("Profile changes must be made in the main Harbor window");
    };
    const isNuvio = isNuvioProviderActive();
    const nuvioState = isNuvio ? loadNuvioState() : null;
    const activeNuvio = nuvioState
      ? (nuvioState.profiles.find((p) => p.profile_index === (nuvioState.activeProfileIndex || 1)) || nuvioState.profiles[0] || null)
      : null;
    const effectiveActiveProfile = isNuvio
      ? (activeNuvio ? nuvioProfileToHarborProfile(activeNuvio) : defaultNuvioHarborProfile(1))
      : (state.profiles.find((p) => p.id === state.activeId) ?? null);
    const effectiveProfiles = isNuvio
      ? (nuvioState && nuvioState.profiles.length > 0
          ? nuvioState.profiles.map(nuvioProfileToHarborProfile)
          : [defaultNuvioHarborProfile(1)])
      : state.profiles;
    const effectiveActiveId = isNuvio
      ? (activeNuvio ? `nuvio-${activeNuvio.profile_index}` : "nuvio-1")
      : state.activeId;

    return {
      ...state,
      profiles: effectiveProfiles,
      activeId: effectiveActiveId,
      activeProfile: effectiveActiveProfile,
      pickerOpen: false,
      pickerView: { kind: "list" },
      sessionUnlockedIds: new Set(),
      openPicker: mainWindowOnly,
      setPickerView: mainWindowOnly,
      closePicker: mainWindowOnly,
      selectProfile: mainWindowOnly,
      createProfile: mainWindowOnly,
      updateProfile: mainWindowOnly,
      deleteProfile: mainWindowOnly,
      setPrimary: mainWindowOnly,
      isCurrentProfileLocked: () => false,
      clearSessionUnlocks: mainWindowOnly,
    };
  }, [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function ProfilesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProfilesState>(() => {
    const loaded = readState();
    if (loaded.profiles.length === 0) {
      const identity = readSettingsIdentity();
      const legacyParental = readLegacyParental();
      const primary: Profile = {
        id: newId(),
        name: defaultPrimaryName(),
        avatar: identity.avatar,
        color: identity.color ?? PROFILE_COLORS[0],
        isPrimary: true,
        shareStremioWith: null,
        passwordHash: null,
        hideContent: null,
        lockedTabs: legacyParental.hiddenTabs,
        kid: null,
        createdAt: Date.now(),
      };
      const initial: ProfilesState = { profiles: [primary], activeId: primary.id };
      writeState(initial);
      migrateLegacyStremioAuth(initial.profiles);
      return initial;
    }
    migrateLegacyStremioAuth(loaded.profiles);
    const def = launchDefault(loaded.profiles);
    const resolved = def ? { ...loaded, activeId: def.id } : loaded;
    writeState(resolved);
    return resolved;
  });

  const [pickerOpen, setPickerOpen] = useState<boolean>(() => {
    let provider = "stremio";
    let defaultProfileId = "";
    let nuvioDefaultId = "";
    try {
      const explicit = localStorage.getItem("harbor.account-provider");
      if (explicit) provider = explicit;
      for (const key of ["harbor.settings.shared", "harbor.settings", "harbor.settings.v1"]) {
        const rawSettings = localStorage.getItem(key);
        if (rawSettings) {
          const s = JSON.parse(rawSettings);
          if (!explicit && s.accountProvider) provider = s.accountProvider;
          if (s.defaultProfileId) defaultProfileId = s.defaultProfileId;
          if (s.nuvioDefaultProfileId) nuvioDefaultId = s.nuvioDefaultProfileId;
        }
      }
    } catch {}

    // Always challenge PIN / open picker on launch if active profile is PIN-locked
    if (provider === "nuvio") {
      const nuvioState = loadNuvioState();
      const slot = nuvioState.activeProfileIndex || 1;
      const target = nuvioState.profiles.find((p) => p.profile_index === slot);
      if (target?.pin_enabled) {
        return true;
      }
    } else {
      const target = state.profiles.find((p) => p.id === state.activeId);
      if (target?.passwordHash) {
        return true;
      }
    }

    const interval = readProfilePromptInterval();
    if (interval === "never") return false;

    if (provider === "nuvio") {
      const nuvioState = loadNuvioState();
      if (nuvioState.profiles.length <= 1) return false;
      const targetDefault = nuvioDefaultId || defaultProfileId;
      if (targetDefault) {
        const num = Number(targetDefault);
        const p = nuvioState.profiles.find((x) => x.profile_index === num);
        if (p && !p.pin_enabled) {
          setActiveNuvioProfile(num);
          return false;
        }
      }
      if (interval === "launch") {
        const wasShown = pickerPromptShownThisRun;
        pickerPromptShownThisRun = true;
        return !wasShown;
      }
      return Date.now() - readLastProfileSelectAt() >= intervalMinutes(interval) * 60000;
    }

    if (state.activeId == null) return true;
    if (state.profiles.length <= 1) return false;
    if (launchDefault(state.profiles)) return false;
    if (interval === "launch") {
      const wasShown = pickerPromptShownThisRun;
      pickerPromptShownThisRun = true;
      return !wasShown;
    }
    return Date.now() - readLastProfileSelectAt() >= intervalMinutes(interval) * 60000;
  });
  const [pickerView, setPickerViewState] = useState<PickerView>({ kind: "list" });

  useEffect(() => {
    writeState(state);
    window.dispatchEvent(new CustomEvent("harbor:profiles-updated"));
  }, [state]);

  const [nuvioState, setNuvioState] = useState(() => loadNuvioState());
  const [isNuvio, setIsNuvio] = useState(() => isNuvioProviderActive());

  useEffect(() => {
    const onProviderChange = () => {
      setIsNuvio(isNuvioProviderActive());
      setNuvioState(loadNuvioState());
    };
    const onNuvioSync = () => {
      setNuvioState(loadNuvioState());
    };
    window.addEventListener("harbor:account-provider-changed", onProviderChange);
    window.addEventListener("harbor:nuvio-state-changed", onNuvioSync);
    window.addEventListener("harbor:nuvio-profile-changed", onNuvioSync);
    window.addEventListener("harbor:nuvio-profiles-updated", onNuvioSync);
    return () => {
      window.removeEventListener("harbor:account-provider-changed", onProviderChange);
      window.removeEventListener("harbor:nuvio-state-changed", onNuvioSync);
      window.removeEventListener("harbor:nuvio-profile-changed", onNuvioSync);
      window.removeEventListener("harbor:nuvio-profiles-updated", onNuvioSync);
    };
  }, []);

  const activeNuvio = useMemo(() => {
    if (!isNuvio) return null;
    const slot = nuvioState.activeProfileIndex || 1;
    return nuvioState.profiles.find((p) => p.profile_index === slot) || nuvioState.profiles[0] || null;
  }, [isNuvio, nuvioState.profiles, nuvioState.activeProfileIndex]);

  const effectiveActiveProfile = useMemo(() => {
    if (isNuvio) {
      return activeNuvio ? nuvioProfileToHarborProfile(activeNuvio) : defaultNuvioHarborProfile(1);
    }
    return state.profiles.find((p) => p.id === state.activeId) ?? null;
  }, [isNuvio, activeNuvio, state.profiles, state.activeId]);

  const effectiveProfiles = useMemo(() => {
    if (isNuvio) {
      return nuvioState.profiles.length > 0
        ? nuvioState.profiles.map(nuvioProfileToHarborProfile)
        : [defaultNuvioHarborProfile(1)];
    }
    return state.profiles;
  }, [isNuvio, nuvioState.profiles, state.profiles]);

  const effectiveActiveId = useMemo(() => {
    if (isNuvio) {
      return activeNuvio ? `nuvio-${activeNuvio.profile_index}` : "nuvio-1";
    }
    return state.activeId;
  }, [isNuvio, activeNuvio, state.activeId]);

  const [sessionUnlockedIds, setSessionUnlockedIds] = useState<Set<string>>(() => new Set());
  // Read through refs so the gate can see current state without giving selectProfile a
  // changing identity, which several consumers put straight into their own dep arrays.
  const profilesRef = useRef(state.profiles);
  profilesRef.current = state.profiles;
  const unlockedRef = useRef(sessionUnlockedIds);
  unlockedRef.current = sessionUnlockedIds;

  const isCurrentProfileLocked = useCallback(() => {
    const isNuvio = isNuvioProviderActive();
    if (isNuvio) {
      const nuvioState = loadNuvioState();
      const slot = nuvioState.activeProfileIndex || 1;
      const target = nuvioState.profiles.find((p) => p.profile_index === slot);
      return Boolean(target?.pin_enabled && !isNuvioProfileUnlocked(slot));
    } else {
      const target = profilesRef.current.find((p) => p.id === state.activeId);
      return Boolean(target?.passwordHash && !unlockedRef.current.has(target.id));
    }
  }, [state.activeId]);

  const clearSessionUnlocks = useCallback(() => {
    setSessionUnlockedIds(new Set());
    clearNuvioSessionUnlocks();
  }, []);

  // When switching account provider mode (Stremio <-> Nuvio), clear unlock state and force "Who's watching?"
  useEffect(() => {
    let timer: number | null = null;
    const onProviderChange = (e: Event) => {
      clearSessionUnlocks();
      setPickerViewState({ kind: "list" });
      const detail = (e as CustomEvent)?.detail;
      if (detail?.skipPicker) return;
      // Slight delay for smooth visual transition so UI switch settles first
      timer = window.setTimeout(() => {
        setPickerOpen(true);
      }, 150);
    };
    window.addEventListener("harbor:account-provider-changed", onProviderChange);
    return () => {
      window.removeEventListener("harbor:account-provider-changed", onProviderChange);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [clearSessionUnlocks]);

  const selectProfile = useCallback((id: string, opts?: { unlocked?: boolean }) => {
    if (isNuvioProviderActive() || id.startsWith("nuvio-")) {
      const match = id.match(/\d+/);
      const slot = match ? parseInt(match[0], 10) : 1;
      setActiveNuvioProfile(slot, opts);
      setPickerOpen(false);
      setPickerViewState({ kind: "list" });
      return true;
    }
    // THE GATE LIVES HERE, not in the UI. It used to be duplicated in picker-modal and
    // use-account-menu, and RemoteOpenBridge has neither: it calls selectProfile(id)
    // straight off a harbor:remote-set-profile event, so a paired phone walked past
    // every profile PIN including a kid profile's parent PIN. Gated callers already
    // pass { unlocked: true } after verifying, so they are unaffected and the remote
    // now fails closed.
    const target = profilesRef.current.find((p) => p.id === id) ?? null;
    if (refuseProfileSelect(target, unlockedRef.current, opts)) return false;
    if (opts?.unlocked) {
      setSessionUnlockedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    }
    markProfileSelectedNow();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ProfilesState;
        parsed.activeId = id;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      }
    } catch {}
    window.dispatchEvent(new CustomEvent("harbor:active-profile-changed", { detail: { id } }));
    setState((s) => ({ ...s, activeId: id }));
    setPickerOpen(false);
    setPickerViewState({ kind: "list" });
    return true;
  }, []);

  useEffect(() => {
    const onFocus = () => {
      if (pickerOpen) return;
      const mins = intervalMinutes(readProfilePromptInterval());
      if (mins <= 0) return;
      let provider = "stremio";
      try {
        const explicit = localStorage.getItem("harbor.account-provider");
        if (explicit) provider = explicit;
        else {
          for (const key of ["harbor.settings.shared", "harbor.settings", "harbor.settings.v1"]) {
            const raw = localStorage.getItem(key);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed.accountProvider) {
                provider = parsed.accountProvider;
                break;
              }
            }
          }
        }
      } catch {}

      if (provider === "nuvio") {
        const nuvioState = loadNuvioState();
        if (nuvioState.profiles.length <= 1) return;
      } else {
        if (state.activeId == null || state.profiles.length <= 1) return;
      }

      if (Date.now() - readLastProfileSelectAt() >= mins * 60000) {
        setPickerViewState({ kind: "list" });
        setPickerOpen(true);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [state.activeId, state.profiles.length, pickerOpen]);

  const openPicker = useCallback((view: PickerView = { kind: "list" }) => {
    setPickerViewState(view);
    setPickerOpen(true);
  }, []);
  const setPickerView = useCallback((view: PickerView) => setPickerViewState(view), []);
  const closePicker = useCallback(() => {
    if (isCurrentProfileLocked()) {
      return;
    }
    setPickerOpen(false);
    setPickerViewState({ kind: "list" });
  }, [isCurrentProfileLocked]);


  const createProfile = useCallback<ProfilesValue["createProfile"]>(
    ({ name, avatar, color, kid }) => {
      const primary = state.profiles.find((p) => p.isPrimary) ?? state.profiles[0];
      const created: Profile = {
        id: newId(),
        name: name.trim().slice(0, 32) || "Profile",
        avatar: avatar ?? null,
        color,
        isPrimary: false,
        shareStremioWith: primary?.id ?? null,
        passwordHash: null,
        hideContent: null,
        lockedTabs: null,
        kid: kid ?? null,
        settingsLinked: true,
        createdAt: Date.now(),
      };
      setState((s) => ({ ...s, profiles: [...s.profiles, created] }));
      return created;
    },
    [state.profiles],
  );

  const updateProfile = useCallback<ProfilesValue["updateProfile"]>((id, patch) => {
    if (isNuvioProviderActive() || id.startsWith("nuvio-")) {
      const match = id.match(/\d+/);
      const slot = match ? parseInt(match[0], 10) : (loadNuvioState().activeProfileIndex || 1);
      const nuvioPatch: any = {};
      if (patch.name !== undefined) nuvioPatch.name = patch.name;
      if (patch.color !== undefined) nuvioPatch.avatarColorHex = patch.color;
      if (patch.avatar !== undefined) nuvioPatch.avatarUrl = patch.avatar;
      if (patch.kid !== undefined) nuvioPatch.is_kids = Boolean(patch.kid);
      if (patch.lockedTabs !== undefined) {
        if (patch.lockedTabs && anyTabLocked(patch.lockedTabs)) {
          localStorage.setItem(`harbor.nuvio.locked-tabs.${slot}`, JSON.stringify(patch.lockedTabs));
        } else {
          localStorage.removeItem(`harbor.nuvio.locked-tabs.${slot}`);
        }
        window.dispatchEvent(new Event("harbor:nuvio-profiles-updated"));
      }
      updateNuvioProfile(slot, nuvioPatch);
      return;
    }
    setState((s) => ({
      ...s,
      profiles: s.profiles.map((p) =>
        p.id === id
          ? {
              ...p,
              ...patch,
              kid: p.isPrimary ? null : (patch.kid !== undefined ? patch.kid : p.kid),
              name: patch.name != null ? patch.name.trim().slice(0, 32) || p.name : p.name,
            }
          : p,
      ),
    }));
  }, []);

  const deleteProfile = useCallback<ProfilesValue["deleteProfile"]>(
    (id) => {
      if (isNuvioProviderActive() || id.startsWith("nuvio-")) {
        const match = id.match(/\d+/);
        if (match) {
          const slot = parseInt(match[0], 10);
          void deleteNuvioProfile(slot);
        }
        return;
      }
      const target = state.profiles.find((p) => p.id === id);
      if (!target || target.isPrimary) return;
      // Before the purge, while the id map still resolves. Without a tombstone the
      // delete never reaches a third device: it still holds the profile, pushes it back
      // up, and it reappears on the two devices that deleted it.
      noteProfileDeleted(id);
      purgeProfileStorage(id);
      void deleteProfileBgImage(id);
      setState((s) => {
        const profiles = s.profiles
          .filter((p) => p.id !== id)
          .map((p) => (p.shareStremioWith === id ? { ...p, shareStremioWith: null } : p));
        const activeId = s.activeId === id ? (profiles[0]?.id ?? null) : s.activeId;
        return { profiles, activeId };
      });
    },
    [state.profiles],
  );

  // The sync roster reads and applies through the provider, never through
  // harbor.profiles.v1 directly: this component persists its own state on every change
  // and never reads that key back, so an external write is clobbered on the next render.
  useEffect(() => {
    configureRosterStore({
      read: () => profilesRef.current,
      apply: (plan) => {
        for (const id of plan.dropLocalIds) purgeProfileStorage(id);
        setState((s) => {
          const byId = new Map(s.profiles.map((p) => [p.id, p]));
          const profiles = plan.replaceWith.map((next) =>
            adoptProfile(next, byId.get(next.id), pickColor(s.profiles)),
          );
          const stillHere = profiles.some((p) => p.id === s.activeId);
          return { profiles, activeId: stillHere ? s.activeId : (profiles[0]?.id ?? null) };
        });
      },
    });
    return () => configureRosterStore(null);
  }, []);

  const setPrimary = useCallback<ProfilesValue["setPrimary"]>((id) => {
    if (isNuvioProviderActive() || id.startsWith("nuvio-")) {
      const match = id.match(/\d+/);
      if (match) {
        const slot = parseInt(match[0], 10);
        void transferPrimaryNuvioProfile(slot);
      }
      return;
    }
    setState((s) => {
      if (!s.profiles.some((p) => p.id === id && !p.isPrimary && !p.kid)) return s;
      const nextProfiles = s.profiles.map((p) =>
        p.id === id
          ? { ...p, isPrimary: true, kid: null, shareStremioWith: null }
          : p.isPrimary
            ? { ...p, isPrimary: false }
            : p,
      );
      const nextState = {
        ...s,
        profiles: nextProfiles,
      };
      writeState(nextState);
      return nextState;
    });
    window.dispatchEvent(new CustomEvent("harbor:profiles-updated"));
    window.dispatchEvent(new CustomEvent("harbor:active-profile-changed"));
    window.dispatchEvent(new CustomEvent("harbor:secondary-privileges-changed"));
  }, []);

  const value = useMemo<ProfilesValue>(
    () => ({
      profiles: effectiveProfiles,
      activeId: effectiveActiveId,
      activeProfile: effectiveActiveProfile,
      pickerOpen,
      pickerView,
      openPicker,
      setPickerView,
      closePicker,
      selectProfile,
      sessionUnlockedIds,
      createProfile,
      updateProfile,
      deleteProfile,
      setPrimary,
      isCurrentProfileLocked,
      clearSessionUnlocks,
    }),
    [
      effectiveProfiles,
      effectiveActiveId,
      effectiveActiveProfile,
      pickerOpen,
      pickerView,
      sessionUnlockedIds,
      openPicker,
      setPickerView,
      closePicker,
      selectProfile,
      createProfile,
      updateProfile,
      deleteProfile,
      setPrimary,
      isCurrentProfileLocked,
      clearSessionUnlocks,
    ],

  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProfiles(): ProfilesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProfiles outside ProfilesProvider");
  return v;
}

function isNuvioProviderActive(): boolean {
  try {
    const explicit = localStorage.getItem("harbor.account-provider");
    if (explicit === "nuvio") return true;
    if (explicit === "stremio") return false;
    for (const key of ["harbor.settings.shared", "harbor.settings", "harbor.settings.v1"]) {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.accountProvider === "nuvio") return true;
        if (parsed.accountProvider === "stremio") return false;
      }
    }
  } catch {}
  return false;
}

export function useActiveKid(): KidConfig | null {
  const { activeProfile } = useProfiles();
  const [nuvioKid, setNuvioKid] = useState<KidConfig | null>(() => {
    try {
      if (isNuvioProviderActive()) {
        const slot = loadNuvioState().activeProfileIndex || 1;
        if (slot === 1) {
          localStorage.removeItem("harbor.nuvio.kid.1");
          return null;
        }
        const raw = localStorage.getItem(`harbor.nuvio.kid.${slot}`);
        return raw ? JSON.parse(raw) : null;
      }
    } catch {}
    return null;
  });

  useEffect(() => {
    const update = () => {
      try {
        if (isNuvioProviderActive()) {
          const slot = loadNuvioState().activeProfileIndex || 1;
          if (slot === 1) {
            localStorage.removeItem("harbor.nuvio.kid.1");
            setNuvioKid(null);
            return;
          }
          const raw = localStorage.getItem(`harbor.nuvio.kid.${slot}`);
          setNuvioKid(raw ? JSON.parse(raw) : null);
          return;
        }
      } catch {}
      setNuvioKid(null);
    };

    window.addEventListener("harbor:nuvio-profile-changed", update);
    window.addEventListener("harbor:nuvio-state-changed", update);
    window.addEventListener("harbor:nuvio-profiles-updated", update);
    window.addEventListener("harbor:account-provider-changed", update);
    window.addEventListener("harbor:settings-changed", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("harbor:nuvio-profile-changed", update);
      window.removeEventListener("harbor:nuvio-state-changed", update);
      window.removeEventListener("harbor:nuvio-profiles-updated", update);
      window.removeEventListener("harbor:account-provider-changed", update);
      window.removeEventListener("harbor:settings-changed", update);
      window.removeEventListener("storage", update);
    };
  }, []);

  if (isNuvioProviderActive()) {
    return nuvioKid;
  }

  if (activeProfile?.isPrimary) {
    return null;
  }

  return activeProfile?.kid ?? null;
}

export function nextProfileColor(existing: Profile[]): ProfileColor {
  return pickColor(existing);
}

export function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function stremioSourceProfileId(active: Profile | null, profiles: Profile[]): string | null {
  if (!active) return null;
  if (!active.shareStremioWith) return active.id;
  const exists = profiles.some((p) => p.id === active.shareStremioWith);
  return exists ? active.shareStremioWith : active.id;
}

export function sharesStremioStorage(
  a: Profile | null | undefined,
  b: Profile | null | undefined,
  profiles: Profile[],
): boolean {
  if (!a || !b) return false;
  return stremioSourceProfileId(a, profiles) === stremioSourceProfileId(b, profiles);
}

export function anyProfileSharesStremioWith(active: Profile | null, profiles: Profile[]): boolean {
  if (!active) return false;
  const source = stremioSourceProfileId(active, profiles);
  if (!source) return false;
  return profiles.some((p) => p.id !== active.id && stremioSourceProfileId(p, profiles) === source);
}
