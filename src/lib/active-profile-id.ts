const KEY = "harbor.profiles.v1";

type MinimalProfile = { id: string; isPrimary?: boolean };
type MinimalState = { profiles?: MinimalProfile[]; activeId?: string | null };

function readState(): MinimalState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MinimalState;
  } catch {
    return null;
  }
}

export function isNuvioProviderActive(): boolean {
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

export function getNuvioActiveSlot(): number {
  try {
    const raw = localStorage.getItem("harbor.nuvio.state.v1") || localStorage.getItem("harbor.nuvio.state");
    if (raw) {
      const parsed = JSON.parse(raw);
      return typeof parsed.activeProfileIndex === "number" ? parsed.activeProfileIndex : 1;
    }
  } catch {}
  return 1;
}

export function activeScopedProfileId(): string {
  if (isNuvioProviderActive()) {
    return `nuvio-${getNuvioActiveSlot()}`;
  }
  return activeProfileId();
}

export function activeProfileId(): string {
  const s = readState();
  return s?.activeId || "default";
}

export function isStremioActivePrimary(
  activeProfile?: { id?: string; isPrimary?: boolean } | null,
  profilesList?: Array<{ id: string; isPrimary?: boolean }>,
): boolean {
  if (profilesList && profilesList.length > 0) {
    if (profilesList.length === 1) return true;
    if (!activeProfile) return false;
    const primary = profilesList.find((p) => p.isPrimary) ?? profilesList[0];
    return activeProfile.id === primary.id || activeProfile.isPrimary === true;
  }
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
