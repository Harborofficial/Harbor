/**
 * Nuvio & Stremio Addon Origin Registry
 * Tracks whether an addon URL or ID originates from Stremio, Nuvio, or Both.
 * Persists to localStorage so origin badges display immediately without network latency.
 */

export type AddonOriginTag = "stremio" | "nuvio" | "both" | "custom";

export type AddonDescriptor = {
  url: string;
  id?: string;
};

const STORAGE_KEY_MAP = "harbor.addon_origins.v1";
const STORAGE_KEY_STREMIO = "harbor.addon_origins.stremio.v1";
const STORAGE_KEY_NUVIO = "harbor.addon_origins.nuvio.v1";

const ORIGIN_CACHE = new Map<string, AddonOriginTag>();
let memoryStremioList: AddonDescriptor[] = [];
let memoryNuvioList: AddonDescriptor[] = [];

// Initialize ORIGIN_CACHE from localStorage on module load
try {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY_MAP) : null;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") ORIGIN_CACHE.set(k, v as AddonOriginTag);
      }
    }
  }
} catch {}

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

function saveOriginsToStorage(): void {
  try {
    if (typeof localStorage !== "undefined") {
      const obj: Record<string, string> = {};
      for (const [k, v] of ORIGIN_CACHE.entries()) {
        obj[k] = v;
      }
      localStorage.setItem(STORAGE_KEY_MAP, JSON.stringify(obj));
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("harbor:addon-origins-updated"));
    }
  } catch {}
}

function readDescriptorList(key: string): AddonDescriptor[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (!raw) {
      return key === STORAGE_KEY_STREMIO ? memoryStremioList : memoryNuvioList;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AddonDescriptor[]) : [];
  } catch {
    return key === STORAGE_KEY_STREMIO ? memoryStremioList : memoryNuvioList;
  }
}

function writeDescriptorList(key: string, list: AddonDescriptor[]): void {
  if (key === STORAGE_KEY_STREMIO) memoryStremioList = list;
  else memoryNuvioList = list;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, JSON.stringify(list));
    }
  } catch {}
}

function recomputeOrigins(stremioList: AddonDescriptor[], nuvioList: AddonDescriptor[]): void {
  ORIGIN_CACHE.clear();

  const stremioNormUrls = new Set<string>();
  const stremioIds = new Set<string>();
  for (const item of stremioList) {
    if (item.url) {
      stremioNormUrls.add(normalizeAddonUrl(item.url));
      stremioNormUrls.add(item.url.trim());
    }
    if (item.id) {
      stremioIds.add(item.id.trim().toLowerCase());
    }
  }

  const nuvioNormUrls = new Set<string>();
  const nuvioIds = new Set<string>();
  for (const item of nuvioList) {
    if (item.url) {
      nuvioNormUrls.add(normalizeAddonUrl(item.url));
      nuvioNormUrls.add(item.url.trim());
    }
    if (item.id) {
      nuvioIds.add(item.id.trim().toLowerCase());
    }
  }

  // Populate from Stremio
  for (const item of stremioList) {
    const norm = normalizeAddonUrl(item.url);
    const id = item.id?.trim().toLowerCase();
    const isBoth = nuvioNormUrls.has(norm) || (id ? nuvioIds.has(id) : false);
    const tag: AddonOriginTag = isBoth ? "both" : "stremio";

    if (item.url) {
      ORIGIN_CACHE.set(item.url, tag);
      ORIGIN_CACHE.set(norm, tag);
    }
    if (item.id) {
      ORIGIN_CACHE.set(item.id, tag);
      ORIGIN_CACHE.set(item.id.toLowerCase(), tag);
    }
  }

  // Populate from Nuvio
  for (const item of nuvioList) {
    const norm = normalizeAddonUrl(item.url);
    const id = item.id?.trim().toLowerCase();
    const isBoth = stremioNormUrls.has(norm) || (id ? stremioIds.has(id) : false);
    const tag: AddonOriginTag = isBoth ? "both" : "nuvio";

    if (item.url && !ORIGIN_CACHE.has(item.url)) {
      ORIGIN_CACHE.set(item.url, tag);
      ORIGIN_CACHE.set(norm, tag);
    }
    if (item.id && !ORIGIN_CACHE.has(item.id)) {
      ORIGIN_CACHE.set(item.id, tag);
      ORIGIN_CACHE.set(item.id.toLowerCase(), tag);
    }
  }

  saveOriginsToStorage();
}

export function recordStremioAddons(
  addons: Array<{ transportUrl: string; manifest?: { id?: string } }>,
): void {
  const list: AddonDescriptor[] = addons.map((a) => ({
    url: a.transportUrl,
    id: a.manifest?.id,
  }));
  writeDescriptorList(STORAGE_KEY_STREMIO, list);
  const nuvioList = readDescriptorList(STORAGE_KEY_NUVIO);
  recomputeOrigins(list, nuvioList);
}

export function recordNuvioAddons(
  addons: Array<{ transportUrl: string; manifest?: { id?: string } }>,
): void {
  const list: AddonDescriptor[] = addons.map((a) => ({
    url: a.transportUrl,
    id: a.manifest?.id,
  }));
  writeDescriptorList(STORAGE_KEY_NUVIO, list);
  const stremioList = readDescriptorList(STORAGE_KEY_STREMIO);
  recomputeOrigins(stremioList, list);
}

/**
 * Updates the origin tags map from active Stremio and Nuvio addon lists
 */
export function recordAddonOrigins(
  stremioUrls: string[],
  nuvioUrls: string[],
  stremioIds: string[] = [],
  nuvioIds: string[] = [],
): void {
  const stremioList: AddonDescriptor[] = stremioUrls.map((url, i) => ({
    url,
    id: stremioIds[i],
  }));
  const nuvioList: AddonDescriptor[] = nuvioUrls.map((url, i) => ({
    url,
    id: nuvioIds[i],
  }));
  writeDescriptorList(STORAGE_KEY_STREMIO, stremioList);
  writeDescriptorList(STORAGE_KEY_NUVIO, nuvioList);
  recomputeOrigins(stremioList, nuvioList);
}

/**
 * Resolves the account origin tag for any addon transport URL or addon ID
 */
export function resolveAddonOrigin(identifier?: string | null): AddonOriginTag {
  if (!identifier) return "custom";
  const trimmed = identifier.trim();
  const exact = ORIGIN_CACHE.get(trimmed);
  if (exact) return exact;
  const lower = trimmed.toLowerCase();
  const lowerMatch = ORIGIN_CACHE.get(lower);
  if (lowerMatch) return lowerMatch;
  const norm = normalizeAddonUrl(trimmed);
  return ORIGIN_CACHE.get(norm) ?? "custom";
}
