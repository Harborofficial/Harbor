import { loadStoredSettings } from "./settings/load";

export const DEFAULT_WATCHED_THRESHOLD_PCT = 85;
export const MIN_WATCHED_THRESHOLD_PCT = 70;
export const MAX_WATCHED_THRESHOLD_PCT = 100;

function readStoredPct(): number | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const raw = localStorage.getItem("harbor.settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.watchedThresholdPct === "number") {
        return parsed.watchedThresholdPct;
      }
    }
    const shared = localStorage.getItem("harbor.settings.shared");
    if (shared) {
      const parsed = JSON.parse(shared);
      if (typeof parsed?.watchedThresholdPct === "number") {
        return parsed.watchedThresholdPct;
      }
    }
    const loaded = loadStoredSettings();
    if (typeof loaded?.watchedThresholdPct === "number") {
      return loaded.watchedThresholdPct;
    }
  } catch {}
  return undefined;
}

export function getWatchedThresholdPct(stored?: { watchedThresholdPct?: number }): number {
  const val = stored?.watchedThresholdPct ?? readStoredPct();
  if (typeof val === "number" && Number.isFinite(val)) {
    return Math.min(
      MAX_WATCHED_THRESHOLD_PCT,
      Math.max(MIN_WATCHED_THRESHOLD_PCT, Math.round(val)),
    );
  }
  return DEFAULT_WATCHED_THRESHOLD_PCT;
}

export function getWatchedThresholdRatio(stored?: { watchedThresholdPct?: number }): number {
  return getWatchedThresholdPct(stored) / 100;
}
