import type { LibraryItem } from "@/lib/stremio";

type CardCoords = { season?: number; episode?: number };

const MAX = 2000;
const cache = new Map<string, CardCoords>();

function cacheKey(item: LibraryItem): string {
  return [
    item._id,
    item.state?.video_id ?? "",
    item.state?.season ?? "",
    item.state?.episode ?? "",
  ].join("|");
}

/** Remember the season/episode the card actually displays, not its raw state. */
export function rememberCardCoords(item: LibraryItem, coords: CardCoords): boolean {
  if (coords.season == null || coords.episode == null) return false;
  const key = cacheKey(item);
  const previous = cache.get(key);
  if (previous?.season === coords.season && previous.episode === coords.episode) return false;
  if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, coords);
  return true;
}

export function cardCoords(item: LibraryItem): CardCoords | undefined {
  return cache.get(cacheKey(item));
}
