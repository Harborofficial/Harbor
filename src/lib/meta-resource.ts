import { addonBaseUrl, addonResourceUrl } from "@/lib/addon-url";
import { cinemetaEnabled, meta as cinemetaMeta, type Meta } from "./cinemeta";
import { safeFetch as fetch } from "./safe-fetch";
import { addonAccepts, gatherCatalogAddons, userAddons, type Addon } from "./addons";
import { filterEnabled, loadInstalled } from "./addon-store";
import { readActiveStremioAuthKey } from "./auth";
import { lruSet } from "./cache";
import { addonOnlyMetadata } from "./metadata-policy";
import {
  orderedMetadataAddons,
  providesMetadata,
  readMetadataAddonOrder,
  fillMissingMetadata,
  hasNeededMetadata,
  metadataAddonKey,
} from "./metadata-addons";

const ADDON_TIMEOUT_MS = 4000;
const PREFERRED_CACHE_MAX = 500;

export const PREFERRED_TEXT_SCORE = 1000;

export type PreferredVideo = NonNullable<Meta["videos"]>[number];

const preferredCache = new Map<string, Promise<Meta | null>>();
if (typeof window !== "undefined") {
  window.addEventListener("harbor:addons-changed", () => preferredCache.clear());
}

export function preferCustomMeta(): boolean {
  return addonOnlyMetadata();
}

function localAddons(): Addon[] {
  return filterEnabled(loadInstalled())
    .filter((a) => !!a.manifest)
    .map((a) => ({ manifest: a.manifest!, transportUrl: a.transportUrl }));
}

export async function resolveMeta(
  authKey: string | null,
  type: "movie" | "series",
  id: string,
  options: { requireVideos?: boolean; preferAddons?: boolean } = {},
): Promise<Meta | null> {
  const addonOnly = addonOnlyMetadata();
  const normalizedId = /^tmdb:\d+$/.test(id)
    ? id.replace("tmdb:", type === "series" ? "tmdb:tv:" : "tmdb:movie:")
    : id;
  const bareId = normalizedId.replace(/^tmdb:(?:movie|tv):/, "tmdb:");
  const candidateIds = [...new Set([id, normalizedId, bareId])];
  const builtIn = () =>
    addonOnly ? Promise.resolve(null) : cinemetaMeta(type, normalizedId, true).catch(() => null);
  const cinemetaOff = !cinemetaEnabled();

  if (!cinemetaOff && !preferCustomMeta() && !options.preferAddons) {
    const early = await cinemetaMeta(type, normalizedId).catch(() => null);
    if (early?.poster) return early;
  }

  const seen = new Set<string>();
  const candidates: Addon[] = [];
  for (const a of await metadataAddons(authKey)) {
    const key = a.transportUrl || a.manifest.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (candidateIds.some((candidateId) => addonAccepts(a, "meta", type, candidateId)))
      candidates.push(a);
  }

  let result: Meta | null = null;
  for (const addon of candidates) {
    for (const candidateId of candidateIds) {
      if (!addonAccepts(addon, "meta", type, candidateId)) continue;
      const found = await fetchAddonMeta(addon, type, candidateId);
      if (!found) continue;
      const tagged = withOrigin(found, addon);
      result = result ? fillMissingMetadata(result, tagged) : tagged;
      if (hasNeededMetadata(result, options.requireVideos === true)) return result;
      // Alternate IDs address the same title. Only try them when the addon
      // failed to return the episode listing requested by this caller.
      if (!options.requireVideos || found.videos?.length) break;
    }
  }
  const fallback = await builtIn();
  return result && fallback ? fillMissingMetadata(result, fallback) : (result ?? fallback);
}

export async function metadataAddons(
  authKey: string | null,
  order = readMetadataAddonOrder(),
): Promise<Addon[]> {
  return orderedMetadataAddons(await gatherCatalogAddons(authKey), order);
}

/** Fetch a single metadata addon by its saved source key, without built-in fallback. */
export async function resolveAddonMetaSource(
  authKey: string | null,
  type: "movie" | "series",
  id: string,
  sourceKey: string,
): Promise<Meta | null> {
  const normalizedId = /^tmdb:\d+$/.test(id)
    ? id.replace("tmdb:", type === "series" ? "tmdb:tv:" : "tmdb:movie:")
    : id;
  const bareId = normalizedId.replace(/^tmdb:(?:movie|tv):/, "tmdb:");
  const candidateIds = [...new Set([id, normalizedId, bareId])];
  const addon = (await metadataAddons(authKey)).find(
    (candidate) => metadataAddonKey(candidate) === sourceKey,
  );
  if (!addon) return null;
  for (const candidateId of candidateIds) {
    if (!addonAccepts(addon, "meta", type, candidateId)) continue;
    const found = await fetchAddonMeta(addon, type, candidateId);
    if (found) return withOrigin(found, addon);
  }
  return null;
}

export function preferredMeta(type: "movie" | "series", id: string): Promise<Meta | null> {
  if (!preferCustomMeta()) return Promise.resolve(null);

  let authKey: string | null = null;
  try {
    authKey = readActiveStremioAuthKey();
  } catch {
    authKey = null;
  }
  const key = JSON.stringify([authKey, addonOnlyMetadata(), readMetadataAddonOrder(), type, id]);
  const cached = preferredCache.get(key);
  if (cached) return cached;
  const pending = resolveMeta(authKey, type, id)
    .then((full) => (full?.addonOrigin ? full : null))
    .catch(() => null);
  lruSet(preferredCache, key, pending, PREFERRED_CACHE_MAX);
  return pending;
}

export function preferredVideoMap(videos: Meta["videos"]): Map<string, PreferredVideo> {
  const out = new Map<string, PreferredVideo>();
  for (const v of videos ?? []) {
    const season = typeof v.season === "number" ? v.season : null;
    const episode =
      typeof v.episode === "number" ? v.episode : typeof v.number === "number" ? v.number : null;
    if (season == null || episode == null) continue;
    out.set(`${season}:${episode}`, v);
  }
  return out;
}

export function preferredVideoName(v: PreferredVideo | undefined): string {
  return v?.title || v?.name || "";
}

export function preferredVideoOverview(v: PreferredVideo | undefined): string {
  return v?.overview || v?.description || "";
}

function withOrigin(meta: Meta, addon: Addon): Meta {
  if (meta.addonOrigin?.base) return meta;
  const base = addonBaseUrl(addon.transportUrl);
  return {
    ...meta,
    addonOrigin: {
      id: addon.manifest.id,
      name: addon.manifest.name ?? addon.manifest.id,
      logo: addon.manifest.logo,
      base,
    },
  };
}

function isMetaAddon(addon: Addon): boolean {
  return !isCinemeta(addon) && providesMetadata(addon);
}

export function hasCustomMetaAddon(): boolean {
  return localAddons().some(isMetaAddon);
}

export async function hasCustomMetaAddonAsync(authKey: string | null): Promise<boolean> {
  const user = authKey ? await userAddons(authKey).catch(() => [] as Addon[]) : [];
  return [...user, ...localAddons()].some(isMetaAddon);
}

function isCinemeta(addon: Addon): boolean {
  const id = (addon.manifest.id ?? "").toLowerCase();
  const url = (addon.transportUrl ?? "").toLowerCase();
  return id.includes("cinemeta") || url.includes("v3-cinemeta") || url.includes("cinemeta.strem");
}

async function fetchAddonMeta(addon: Addon, type: string, id: string): Promise<Meta | null> {
  const base = addonBaseUrl(addon.transportUrl);
  const url = addonResourceUrl(base, `meta/${type}/${id}.json`);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ADDON_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as { meta?: Meta };
    const value = json.meta;
    return value && typeof value.id === "string" && value.id && typeof value.name === "string"
      ? value
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
