import { useEffect, useState } from "react";
import { tmdbBackdropAtSize } from "./tmdb-backdrop-size";

export function useStableAsset(
  candidates: Array<string | undefined | null>,
  resetKey: string,
): string | undefined {
  const [locked, setLocked] = useState<string | undefined>();
  const [prevKey, setPrevKey] = useState(resetKey);
  if (prevKey !== resetKey) {
    setPrevKey(resetKey);
    setLocked(undefined);
  }
  const firstReal = candidates.find((c): c is string => !!c);
  useEffect(() => {
    if (!locked && firstReal) setLocked(firstReal);
  }, [locked, firstReal]);
  return locked ?? firstReal;
}

export function toHiResBackdrop(url: string | undefined, fullQuality = false): string | undefined {
  if (!url) return url;
  return tmdbBackdropAtSize(url, fullQuality ? "original" : "w1280");
}
