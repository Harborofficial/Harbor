import { franchiseDedupKey } from "@/lib/providers/jikan";

export type AnimeTitleCheckpoint = {
  videoId?: string | null;
  season?: number;
  episode?: number;
  imdbId?: string | null;
};

const MAX = 2000;
const cache = new Map<string, Set<string>>();

function cacheKey(id: string, checkpoint?: AnimeTitleCheckpoint): string {
  return [
    id,
    checkpoint?.videoId ?? "",
    checkpoint?.season ?? "",
    checkpoint?.episode ?? "",
    checkpoint?.imdbId ?? "",
  ].join("|");
}

/** Franchise-normalized titles resolved for this exact card checkpoint. */
export function animeTitleKeys(id: string, checkpoint?: AnimeTitleCheckpoint): string[] {
  return [...(cache.get(cacheKey(id, checkpoint)) ?? [])];
}

/** Returns true only when a new alias was recorded, so callers can notify once. */
export function rememberAnimeTitle(
  id: string,
  title: string | null | undefined,
  checkpoint?: AnimeTitleCheckpoint,
): boolean {
  const key = title ? franchiseDedupKey(title) : "";
  if (!key) return false;
  const idKey = cacheKey(id, checkpoint);
  let keys = cache.get(idKey);
  if (!keys) {
    if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
    keys = new Set();
    cache.set(idKey, keys);
  }
  if (keys.has(key)) return false;
  keys.add(key);
  return true;
}
