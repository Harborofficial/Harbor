import { cinemetaEnabled, meta as cinemetaMeta, type Meta } from "./cinemeta";
import { safeFetch as fetch } from "./safe-fetch";
import { addonAccepts, userAddons, type Addon } from "./addons";
import { filterEnabled, loadInstalled } from "./addon-store";
import { readActiveStremioAuthKey } from "./auth";
import { lruSet } from "./cache";

const ADDON_TIMEOUT_MS = 4000;
const PREFERRED_CACHE_MAX = 500;

export const PREFERRED_TEXT_SCORE = 1000;

export type PreferredVideo = NonNullable<Meta["videos"]>[number];

const preferredCache = new Map<string, Promise<Meta | null>>();

export function preferCustomMeta(): boolean {
  try {
    const raw = localStorage.getItem("harbor.settings");
    return raw ? JSON.parse(raw).preferCustomMetaAddon === true : false;
  } catch {
    return false;
  }
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
  const normalizedId = /^tmdb:\d+$/.test(id)
    ? id.replace("tmdb:", type === "series" ? "tmdb:tv:" : "tmdb:movie:")
    : id;
  const bareId = normalizedId.replace(/^tmdb:(?:movie|tv):/, "tmdb:");
  const candidateIds = [...new Set([id, normalizedId, bareId])];
  const cinemetaPromise = cinemetaMeta(type, normalizedId).catch(() => null);
  const cinemetaOff = !cinemetaEnabled();

  if (!cinemetaOff && !preferCustomMeta() && !options.preferAddons) {
    const early = await cinemetaPromise;
    if (early?.poster) return early;
  }

  const user = authKey ? await userAddons(authKey).catch(() => [] as Addon[]) : [];
  const seen = new Set<string>();
  const candidates: Addon[] = [];
  for (const a of [...user, ...localAddons()]) {
    const key = a.transportUrl || a.manifest.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isCinemeta(a) && candidateIds.some((candidateId) => addonAccepts(a, "meta", type, candidateId))) candidates.push(a);
  }

  if (candidates.length === 0) {
    return cinemetaOff ? cinemetaMeta(type, normalizedId, true).catch(() => null) : cinemetaPromise;
  }

  const addonRaces = candidates.map((a) => ({ a, p: (async () => {
    let first: Meta | null = null;
    for (const candidateId of candidateIds) {
      if (!addonAccepts(a, "meta", type, candidateId)) continue;
      const found = await fetchAddonMeta(a, type, candidateId);
      if (!found) continue;
      if (!first) first = found;
      if (!options.requireVideos || found.videos?.length) return found;
    }
    return first;
  })() }));

  if (options.preferAddons) {
    let first: Meta | null = null;
    for (const { a, p } of addonRaces) {
      const result = await p;
      if (!result) continue;
      const fromAddon = withOrigin(result, a);
      if (!first) first = fromAddon;
      if (!options.requireVideos) return fromAddon;
      // Honour the first metadata addon's title/artwork overrides, while
      // obtaining episodes from whichever compatible addon supplies them.
      if (result.videos?.length) return first === fromAddon ? fromAddon : { ...fromAddon, ...first, videos: result.videos };
    }
    const fallback = await cinemetaPromise;
    if (first && fallback?.videos?.length) return { ...fallback, ...first, videos: fallback.videos };
    return first ?? fallback;
  }

  if (cinemetaOff) {
    let firstAny: Meta | null = null;
    let firstAddon: Addon | null = null;
    for (const { a, p } of addonRaces) {
      const result = await p;
      if (!result) continue;
      if (result.poster) return withOrigin(result, a);
      if (!firstAny) {
        firstAny = result;
        firstAddon = a;
      }
    }
    if (firstAny && firstAddon) return withOrigin(firstAny, firstAddon);
    return cinemetaMeta(type, normalizedId, true).catch(() => null);
  }

  if (preferCustomMeta()) {
    let firstAny: Meta | null = null;
    let firstAddon: Addon | null = null;
    for (const { a, p } of addonRaces) {
      const result = await p;
      if (!result) continue;
      if (result.poster) return withOrigin(result, a);
      if (!firstAny) {
        firstAny = result;
        firstAddon = a;
      }
    }
    if (firstAny && firstAddon) {
      return fillArtwork(withOrigin(firstAny, firstAddon), cinemetaPromise);
    }
    return (await cinemetaPromise) ?? null;
  }

  const cinemeta = await cinemetaPromise;
  if (cinemeta && cinemeta.poster) return cinemeta;

  for (const { a, p } of addonRaces) {
    const result = await p;
    if (result && result.poster) return withOrigin(result, a);
  }

  return cinemeta ?? null;
}

async function fillArtwork(preferred: Meta, fallback: Promise<Meta | null>): Promise<Meta> {
  const base = await fallback;
  if (!base) return preferred;
  return {
    ...preferred,
    poster: preferred.poster || base.poster,
    background: preferred.background || base.background,
    logo: preferred.logo || base.logo,
  };
}

export function preferredMeta(type: "movie" | "series", id: string): Promise<Meta | null> {
  if (!preferCustomMeta()) return Promise.resolve(null);
  const key = `${type}:${id}`;
  const cached = preferredCache.get(key);
  if (cached) return cached;
  let authKey: string | null = null;
  try {
    authKey = readActiveStremioAuthKey();
  } catch {
    authKey = null;
  }
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
  const base = addon.transportUrl.replace(/\/manifest\.json$/, "");
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
  return (
    !isCinemeta(addon) &&
    (addonAccepts(addon, "meta", "movie", "tt0000000") ||
      addonAccepts(addon, "meta", "series", "tt0000000"))
  );
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
  const base = addon.transportUrl.replace(/\/manifest\.json$/, "");
  const url = `${base}/meta/${type}/${id}.json`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ADDON_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as { meta?: Meta };
    return json.meta ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
