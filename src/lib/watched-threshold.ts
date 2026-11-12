export const DEFAULT_WATCHED_THRESHOLD_PCT = 85;
export const MIN_WATCHED_THRESHOLD_PCT = 70;
export const MAX_WATCHED_THRESHOLD_PCT = 100;

export function clampWatchedThresholdPct(val: unknown): number {
  if (typeof val === "number" && Number.isFinite(val)) {
    return Math.min(
      MAX_WATCHED_THRESHOLD_PCT,
      Math.max(MIN_WATCHED_THRESHOLD_PCT, Math.round(val)),
    );
  }
  return DEFAULT_WATCHED_THRESHOLD_PCT;
}

let cachedThresholdPct: number | null = null;

function readStoredPct(): number {
  if (cachedThresholdPct !== null) return cachedThresholdPct;
  try {
    if (typeof localStorage === "undefined") {
      cachedThresholdPct = DEFAULT_WATCHED_THRESHOLD_PCT;
      return cachedThresholdPct;
    }
    const raw = localStorage.getItem("harbor.settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.watchedThresholdPct === "number") {
        cachedThresholdPct = clampWatchedThresholdPct(parsed.watchedThresholdPct);
        return cachedThresholdPct;
      }
    }
    const shared = localStorage.getItem("harbor.settings.shared");
    if (shared) {
      const parsed = JSON.parse(shared);
      if (typeof parsed?.watchedThresholdPct === "number") {
        cachedThresholdPct = clampWatchedThresholdPct(parsed.watchedThresholdPct);
        return cachedThresholdPct;
      }
    }
  } catch {}
  cachedThresholdPct = DEFAULT_WATCHED_THRESHOLD_PCT;
  return cachedThresholdPct;
}

export function invalidateWatchedThresholdCache(): void {
  cachedThresholdPct = null;
}

export function setCachedWatchedThreshold(pct: number | null): void {
  cachedThresholdPct = pct != null ? clampWatchedThresholdPct(pct) : null;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (!e.key || e.key.startsWith("harbor.settings")) {
      cachedThresholdPct = null;
    }
  });
  window.addEventListener("harbor:settings-changed", () => {
    cachedThresholdPct = null;
  });
}

export function getWatchedThresholdPct(stored?: { watchedThresholdPct?: number }): number {
  if (stored?.watchedThresholdPct != null) {
    return clampWatchedThresholdPct(stored.watchedThresholdPct);
  }
  return readStoredPct();
}

export function getWatchedThresholdRatio(stored?: { watchedThresholdPct?: number }): number {
  return getWatchedThresholdPct(stored) / 100;
}
