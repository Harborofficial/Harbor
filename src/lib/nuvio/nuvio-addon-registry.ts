/**
 * Nuvio & Stremio Addon Origin Registry
 * Tracks whether an addon URL originates from Stremio, Nuvio, or Both.
 */

export type AddonOriginTag = "stremio" | "nuvio" | "both" | "custom";

const ORIGIN_CACHE = new Map<string, AddonOriginTag>();

/**
 * Normalizes a transport URL for identity matching
 */
export function normalizeAddonUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/manifest\.json$/i, "").replace(/\/+$/, "")}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Updates the origin tags map from active Stremio and Nuvio addon lists
 */
export function recordAddonOrigins(
  stremioUrls: string[],
  nuvioUrls: string[],
): void {
  ORIGIN_CACHE.clear();
  const stremioSet = new Set(stremioUrls.map(normalizeAddonUrl));
  const nuvioSet = new Set(nuvioUrls.map(normalizeAddonUrl));

  for (const url of stremioUrls) {
    const norm = normalizeAddonUrl(url);
    if (nuvioSet.has(norm)) {
      ORIGIN_CACHE.set(url, "both");
      ORIGIN_CACHE.set(norm, "both");
    } else {
      ORIGIN_CACHE.set(url, "stremio");
      ORIGIN_CACHE.set(norm, "stremio");
    }
  }

  for (const url of nuvioUrls) {
    const norm = normalizeAddonUrl(url);
    if (!ORIGIN_CACHE.has(url)) {
      if (stremioSet.has(norm)) {
        ORIGIN_CACHE.set(url, "both");
        ORIGIN_CACHE.set(norm, "both");
      } else {
        ORIGIN_CACHE.set(url, "nuvio");
        ORIGIN_CACHE.set(norm, "nuvio");
      }
    }
  }
}

/**
 * Resolves the account origin tag for any addon transport URL
 */
export function resolveAddonOrigin(transportUrl?: string | null): AddonOriginTag {
  if (!transportUrl) return "custom";
  const exact = ORIGIN_CACHE.get(transportUrl);
  if (exact) return exact;
  const norm = normalizeAddonUrl(transportUrl);
  return ORIGIN_CACHE.get(norm) ?? "custom";
}
