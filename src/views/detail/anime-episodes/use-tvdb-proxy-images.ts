import { useEffect, useState } from "react";
import { fetchTvdbProxyImages, type TvdbImageMap } from "@/lib/providers/tvdb-proxy";

export function useTvdbProxyImages(
  kitsuId: number | null,
  imdbId: string | null,
  episodeCount: number,
  seasonType: string,
): TvdbImageMap {
  const scope = JSON.stringify([kitsuId, imdbId, seasonType]);
  const [result, setResult] = useState<{ scope: string; map: TvdbImageMap } | null>(null);
  const enabled = episodeCount > 0 && (kitsuId != null || !!imdbId);
  useEffect(() => {
    if (!enabled) return;
    let cancel = false;
    void fetchTvdbProxyImages({ kitsuId, imdb: imdbId, type: seasonType }).then((m) => {
      if (!cancel) setResult({ scope, map: m });
    });
    return () => {
      cancel = true;
    };
  }, [kitsuId, imdbId, seasonType, enabled, scope]);
  return enabled && result?.scope === scope ? result.map : {};
}
