import { loadStoredSettings, parseStoredSettings } from "./load";
import { setItemWithRecovery, setItemWithRecoveryDetailed } from "@/lib/storage-recovery";
import type { Settings } from "./types";

export const MIRROR_KEY = "harbor.settings";
export const SHARED_KEY = "harbor.settings.shared";
export const PROFILES_KEY = "harbor.profiles.v1";
let lastSavedAt = 0;

export function profileKey(id: string): string {
  return `harbor.settings.${id}`;
}

export function sourceKeyFor(profileId: string, linked: boolean): string {
  return linked ? SHARED_KEY : profileKey(profileId);
}

export function serializeSettings(settings: Settings): string {
  const { backgroundImage: _drop, ...themeRest } = settings.theme;
  void _drop;
  return JSON.stringify({ ...settings, theme: themeRest });
}

export function seedSharedFromLegacy(): void {
  try {
    if (localStorage.getItem(SHARED_KEY)) return;
    const legacy = localStorage.getItem(MIRROR_KEY);
    if (legacy) localStorage.setItem(SHARED_KEY, legacy);
  } catch {
    return;
  }
}

export function loadEffective(profileId: string, linked: boolean): Settings {
  const key = sourceKeyFor(profileId, linked);
  if (localStorage.getItem(key) != null) return loadStoredSettings(key);
  if (localStorage.getItem(SHARED_KEY) != null) return loadStoredSettings(SHARED_KEY);
  if (localStorage.getItem(MIRROR_KEY) != null) return loadStoredSettings(MIRROR_KEY);
  return loadStoredSettings(key);
}

export function recoverableLegacyBlob(): string | null {
  return localStorage.getItem(SHARED_KEY) ?? localStorage.getItem(MIRROR_KEY);
}

export function readActiveSource(): { profileId: string; linked: boolean } {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return { profileId: "default", linked: true };
    const s = JSON.parse(raw) as {
      profiles?: Array<{ id: string; settingsLinked?: boolean }>;
      activeId?: string | null;
    };
    const id = s.activeId || "default";
    const p = s.profiles?.find((x) => x.id === id);
    return { profileId: id, linked: p?.settingsLinked !== false };
  } catch {
    return { profileId: "default", linked: true };
  }
}

export function applyLegacyToActive(): boolean {
  const blob = recoverableLegacyBlob();
  if (blob == null) return false;
  const { profileId, linked } = readActiveSource();
  const ok = setItemWithRecovery(sourceKeyFor(profileId, linked), blob);
  setItemWithRecovery(MIRROR_KEY, blob);
  return ok;
}

export function persistEffective(settings: Settings, profileId: string, linked: boolean): string {
  const source = sourceKeyFor(profileId, linked);
  lastSavedAt = Math.max(Date.now(), lastSavedAt + 1);
  const json = JSON.stringify({
    ...JSON.parse(serializeSettings(settings)),
    _savedAt: lastSavedAt,
    _savedSource: source,
  });
  const ok = setItemWithRecoveryDetailed(source, json).ok;
  setItemWithRecoveryDetailed(MIRROR_KEY, json);
  if (!ok) {
    console.error(
      `[settings] blob of ${json.length} chars did not persist in browser storage; disk backup required`,
    );
  }
  return json;
}

/** A failed browser write must not hide a newer disk copy on the next launch. */
export function recoverSettingsFile(
  raw: string | null,
  profileId: string,
  linked: boolean,
): Settings | null {
  if (!raw) return null;
  try {
    const disk = JSON.parse(raw);
    if (!disk || typeof disk !== "object" || Array.isArray(disk)) return null;
    const source = sourceKeyFor(profileId, linked);
    if (disk._savedSource && disk._savedSource !== source) return null;
    const existing = localStorage.getItem(source) ?? localStorage.getItem(MIRROR_KEY);
    if (existing) {
      const local = JSON.parse(existing);
      // Legacy files have no ordering information: keep the browser copy.
      if (!(typeof disk._savedAt === "number" && disk._savedAt > (local?._savedAt ?? 0)))
        return null;
    }
    const { settings } = parseStoredSettings(raw);
    setItemWithRecoveryDetailed(source, raw);
    setItemWithRecoveryDetailed(MIRROR_KEY, raw);
    // Hydrate directly even if browser storage is still full.
    return settings;
  } catch {
    return null;
  }
}

export function forkToProfile(profileId: string): void {
  const shared = localStorage.getItem(SHARED_KEY) ?? localStorage.getItem(MIRROR_KEY);
  if (shared != null) setItemWithRecovery(profileKey(profileId), shared);
}

export function dropProfileBlob(profileId: string): void {
  try {
    localStorage.removeItem(profileKey(profileId));
  } catch {
    return;
  }
}
