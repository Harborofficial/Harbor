import type { Settings } from "./types";

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => sameValue(value, b[index]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return false;
}

/**
 * Settings the user actually changed while the disk read was in flight. Comparing
 * values, not object identity, keeps a rewritten-but-equal object from looking like
 * an edit. The background image is deliberately left out; it lives in its own store.
 */
function changedSettingKeys(current: Settings, initial: Settings): Set<keyof Settings> {
  const changed = new Set<keyof Settings>();
  for (const key of Object.keys(current) as Array<keyof Settings>) {
    if (!sameValue(current[key], initial[key])) changed.add(key);
  }
  return changed;
}

function changedThemeFields(
  current: Settings["theme"],
  initial: Settings["theme"],
): Partial<Settings["theme"]> {
  const changed: Partial<Settings["theme"]> = {};
  for (const key of Object.keys(current) as Array<keyof Settings["theme"]>) {
    if (key === "backgroundImage") continue;
    if (!sameValue(current[key], initial[key])) {
      (changed as Record<string, unknown>)[key] = current[key];
    }
  }
  return changed;
}

export function mergeRecoveredSettings(
  recovered: Settings,
  current: Settings,
  initial: Settings,
): Settings {
  const merged = { ...recovered };
  for (const key of changedSettingKeys(current, initial)) {
    if (key === "theme") continue;
    (merged as Record<string, unknown>)[key] = current[key];
  }
  // The disk copy never contains the background image. Keep the image that was
  // loaded, or edited, while the disk read was running, and merge only the rest of
  // the theme from the recovered copy.
  merged.theme = {
    ...recovered.theme,
    ...changedThemeFields(current.theme, initial.theme),
    backgroundImage: current.theme.backgroundImage,
  };
  return merged;
}

export function recoveryMatchesSource(
  started: { profileId: string; linked: boolean },
  current: { profileId: string; linked: boolean },
): boolean {
  return started.profileId === current.profileId && started.linked === current.linked;
}
