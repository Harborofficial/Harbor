import { useEffect, useState } from "react";
import { fetchTvdbProxyImages, type TvdbImageMap } from "@/lib/providers/tvdb-proxy";

const LONG_SEASON_MIN = 60;

export function useSeriesTvdbStills(
  imdbId: string | null,
  seasonEpisodeCount: number,
  type: string,
  allowProxy = false,
  hasKey = false,
): TvdbImageMap {
  const [map, setMap] = useState<TvdbImageMap>({});
  const isLong = seasonEpisodeCount > LONG_SEASON_MIN;
  useEffect(() => {
    if (!isLong || !imdbId || (!hasKey && !allowProxy)) {
      setMap({});
      return;
    }
    let cancel = false;
    void fetchTvdbProxyImages({ imdb: imdbId, type }).then((m) => {
      if (!cancel) setMap(m);
    });
    return () => {
      cancel = true;
    };
  }, [imdbId, type, isLong, allowProxy, hasKey]);
  return map;
}
