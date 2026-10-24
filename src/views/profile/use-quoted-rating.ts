import { useEffect, useState } from "react";
import type { RatingQuote } from "@/lib/ratings/quote";
import type { PublicRating } from "@/lib/ratings/types";
import { fetchUserRatings } from "@/lib/social/ratings-api";

const TTL = 60000;
const MAX_PAGES = 3;

const cache = new Map<string, { at: number; list: Promise<PublicRating[]> }>();

// A quoted comment only knows the rater's handle and the title key, so the review itself is read
// back from the rater's published ratings. One lookup per profile serves every quoted comment on
// the page, and a missing rating (deleted after the comment was posted) falls back to the marker.
export function loadRatings(handle: string): Promise<PublicRating[]> {
  const hit = cache.get(handle);
  if (hit && Date.now() - hit.at < TTL) return hit.list;
  const entry = { at: Date.now(), list: Promise.resolve<PublicRating[]>([]) };
  entry.list = (async () => {
    const items: PublicRating[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const rated = await fetchUserRatings(handle, { cursor });
      items.push(...rated.items);
      cursor = rated.nextCursor;
      if (!cursor) break;
    }
    return items;
  })().catch(() => {
    cache.delete(handle);
    return [] as PublicRating[];
  });
  cache.set(handle, entry);
  return entry.list;
}

export type QuotedRatingLookup = { state: "loading" | "ready" | "missing"; rating?: PublicRating };

export function useQuotedRating(quote: RatingQuote | null): QuotedRatingLookup {
  const handle = quote?.authorHandle ?? "";
  const itemKey = quote?.itemKey ?? "";
  const [lookup, setLookup] = useState<QuotedRatingLookup>({ state: "loading" });

  useEffect(() => {
    if (!handle || !itemKey) {
      setLookup({ state: "missing" });
      return;
    }
    let live = true;
    setLookup({ state: "loading" });
    void loadRatings(handle).then((items) => {
      if (!live) return;
      const rating = items.find((item) => item.itemKey === itemKey);
      setLookup(rating ? { state: "ready", rating } : { state: "missing" });
    });
    return () => {
      live = false;
    };
  }, [handle, itemKey]);

  return lookup;
}
