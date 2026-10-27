const KEY = "harbor.profiles.v1";

type MinimalProfile = { id: string; isPrimary?: boolean; shareStremioWith?: string | null };
type MinimalState = { profiles?: MinimalProfile[]; activeId?: string | null };

let cachedProfileRaw: string | null = null;
let cachedActiveProfileId = "default";
let cachedStremioProfileId = "";
let cachedPrimaryProfileId = "";
let cachedState: MinimalState | null = null;

function syncProfiles(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === cachedProfileRaw) return;
    cachedProfileRaw = raw;
    if (!raw) {
      cachedState = null;
      cachedActiveProfileId = "default";
      cachedStremioProfileId = "";
      cachedPrimaryProfileId = "";
      return;
    }
    const parsed = JSON.parse(raw) as {
      activeId?: string | null;
      profiles?: Array<{ id?: string; isPrimary?: boolean; shareStremioWith?: string | null }>;
    };
    const validProfiles: MinimalProfile[] = Array.isArray(parsed.profiles)
      ? parsed.profiles.filter(
          (p): p is MinimalProfile => typeof p?.id === "string" && p.id.length > 0,
        )
      : [];
    cachedState = {
      activeId: parsed.activeId,
      profiles: validProfiles,
    };
    const active = validProfiles.find((p) => p.id === parsed.activeId) ?? null;
    let own = active?.id ?? validProfiles.find((p) => p.isPrimary)?.id ?? "";
    if (active && typeof active.shareStremioWith === "string" && active.shareStremioWith) {
      const shared = validProfiles.find((p) => p.id === active.shareStremioWith);
      if (shared?.id) own = shared.id;
    }
    const primary = validProfiles.find((p) => p.isPrimary);
    cachedActiveProfileId = parsed.activeId || "default";
    cachedStremioProfileId = own;
    cachedPrimaryProfileId = primary?.id || own;
  } catch {
    cachedProfileRaw = null;
    cachedState = null;
    cachedActiveProfileId = "default";
    cachedStremioProfileId = "";
    cachedPrimaryProfileId = "";
  }
}

function readState(): MinimalState | null {
  syncProfiles();
  return cachedState;
}

const cachedSettings = new Map<string, { raw: string; provider: unknown }>();

export function isNuvioProviderActive(): boolean {
  try {
    const explicit =
      typeof localStorage !== "undefined" ? localStorage.getItem("harbor.account-provider") : null;
    if (explicit === "nuvio") return true;
    if (explicit === "stremio") return false;
    for (const key of ["harbor.settings.shared", "harbor.settings", "harbor.settings.v1"]) {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
      if (raw) {
        let cached = cachedSettings.get(key);
        if (cached?.raw !== raw) {
          let provider: unknown;
          try {
            provider = JSON.parse(raw).accountProvider;
          } catch {
            provider = /"accountProvider"\s*:\s*"nuvio"/.test(raw)
              ? "nuvio"
              : /"accountProvider"\s*:\s*"stremio"/.test(raw)
                ? "stremio"
                : undefined;
          }
          cached = { raw, provider };
          cachedSettings.set(key, cached);
        }
        if (cached.provider === "nuvio") return true;
        if (cached.provider === "stremio") return false;
      }
    }
  } catch {}
  return false;
}

let cachedNuvioSlotRaw: string | null = null;
let cachedNuvioSlot = 1;

export function getNuvioActiveSlot(): number {
  try {
    const raw =
      localStorage.getItem("harbor.nuvio.state.v1") || localStorage.getItem("harbor.nuvio.state");
    if (raw === cachedNuvioSlotRaw) return cachedNuvioSlot;
    cachedNuvioSlotRaw = raw;
    if (raw) {
      const parsed = JSON.parse(raw);
      cachedNuvioSlot =
        Number.isInteger(parsed.activeProfileIndex) &&
        parsed.activeProfileIndex >= 1 &&
        parsed.activeProfileIndex <= 6
          ? parsed.activeProfileIndex
          : 1;
      return cachedNuvioSlot;
    }
  } catch {}
  cachedNuvioSlot = 1;
  return 1;
}

export function activeScopedProfileId(): string {
  if (isNuvioProviderActive()) {
    return `nuvio-${getNuvioActiveSlot()}`;
  }
  return activeProfileId();
}

export function activeProfileId(): string {
  syncProfiles();
  return cachedActiveProfileId;
}

export function primaryProfileId(): string {
  syncProfiles();
  return cachedPrimaryProfileId;
}

/** Watched state follows the shared Stremio account, not the selected profile. */
export function stremioProfileId(): string {
  syncProfiles();
  return cachedStremioProfileId;
}

export function isStremioActivePrimary(
  activeProfile?: { id?: string; isPrimary?: boolean } | null,
  profilesList?: Array<{ id: string; isPrimary?: boolean }>,
): boolean {
  if (profilesList && profilesList.length > 0) {
    if (profilesList.length === 1) return true;
    const primary = profilesList.find((p) => p.isPrimary) ?? profilesList[0];
    if (activeProfile) {
      return activeProfile.id === primary.id || activeProfile.isPrimary === true;
    }
    const s = readState();
    const diskPrimary = s?.profiles?.find((p) => p.isPrimary) ?? s?.profiles?.[0];
    const activeId = s?.activeId || diskPrimary?.id;
    return activeId === diskPrimary?.id;
  }
  if (activeProfile?.isPrimary === true) return true;
  const s = readState();
  if (!s || !Array.isArray(s.profiles) || s.profiles.length === 0) return true;
  if (s.profiles.length === 1) return true;
  const primary = s.profiles.find((p) => p.isPrimary) ?? s.profiles[0];
  const activeId = s.activeId || primary.id;
  return activeId === primary.id;
}

export function activeProfileIsPrimary(): boolean {
  if (isNuvioProviderActive()) {
    return getNuvioActiveSlot() === 1;
  }
  return isStremioActivePrimary();
}

/**
 * Profile ids whose stored copies a shared session may be adopted from: the active
 * profile first, then the main profile, then the rest.
 */
export function profilesForSessionAdoption(): string[] {
  const s = readState();
  const list = Array.isArray(s?.profiles) ? s.profiles : [];
  const active = s?.activeId || "default";
  const primary = list.filter((p) => p.isPrimary).map((p) => p.id);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [active, ...primary, ...list.map((p) => p.id)]) {
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

let cachedWatchedOwnerRaw: string | null = null;
let cachedWatchedOwner: string | undefined;

/** Watched history belongs to a Nuvio account and slot, including while offline. */
export function nuvioWatchedScope(slot = getNuvioActiveSlot(), accountId?: string): string {
  let id = accountId;
  if (id === undefined) {
    try {
      const raw = localStorage.getItem("harbor.nuvio.state.v1");
      if (raw !== cachedWatchedOwnerRaw) {
        cachedWatchedOwnerRaw = raw;
        cachedWatchedOwner = undefined;
        cachedWatchedOwner = raw ? JSON.parse(raw).session?.user?.id : undefined;
      }
      id = cachedWatchedOwner;
    } catch {
      /* An unknown owner must never adopt legacy history. */
    }
  }
  return typeof id === "string" && id.length > 0
    ? `nuvio.v2.${encodeURIComponent(id)}.slot.${slot}`
    : "nuvio.v2.unowned";
}

export function canPersistWatched(): boolean {
  return !isNuvioProviderActive() || nuvioWatchedScope() !== "nuvio.v2.unowned";
}
