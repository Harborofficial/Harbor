import { useEffect, useState } from "react";
import { kitsuToTvdb } from "@/lib/providers/anime-mapping";
import { parseKitsuId } from "@/lib/providers/kitsu";
import { tmdbLanguageIso } from "@/lib/providers/tmdb/tmdb-client";
import { tvdbLangFromIso1 } from "@/lib/providers/tvdb";
import {
  fetchTvdbOrder,
  fetchTvdbOrderBySeriesId,
  waitForTvdbSeasonNames,
  type TvdbOrder,
} from "@/lib/providers/tvdb-order";

export function useEpisodeOrder(
  imdbId: string | null,
  metaId: string,
  provider: "default" | "tmdb" | "tvdb",
  seasonType: string,
  tvdbKey: string,
  enabled = true,
  allowProxy = false,
): TvdbOrder | null {
  const [order, setOrder] = useState<TvdbOrder | null>(null);
  const metadataLanguage = tmdbLanguageIso();
  const remoteId =
    imdbId && imdbId.startsWith("tt")
      ? imdbId
      : metaId.startsWith("tmdb:tv:")
        ? metaId.slice(8)
        : null;
  const kitsuId = /^(kitsu|mal|anilist|anidb):/.test(metaId) ? parseKitsuId(metaId) : null;
  const active =
    enabled &&
    provider === "tvdb" &&
    seasonType !== "tmdb" &&
    (!!tvdbKey.trim() || allowProxy) &&
    (!!remoteId || kitsuId != null);

  useEffect(() => {
    if (!active) {
      setOrder(null);
      return;
    }
    let cancelled = false;
    const lang = tvdbLangFromIso1(metadataLanguage);
    void (async () => {
      let o: TvdbOrder | null = null;
      if (kitsuId != null) {
        const sid = await kitsuToTvdb(kitsuId).catch(() => null);
        if (sid != null)
          o = await fetchTvdbOrderBySeriesId(tvdbKey, sid, seasonType, lang, allowProxy).catch(
            () => null,
          );
      }
      if (!o && remoteId)
        o = await fetchTvdbOrder(tvdbKey, remoteId, seasonType, lang, allowProxy).catch(() => null);
      if (cancelled) return;
      setOrder(o);
      if (o) {
        const named = await waitForTvdbSeasonNames(o);
        if (!cancelled && named !== o) setOrder(named);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, remoteId, kitsuId, tvdbKey, seasonType, metadataLanguage, allowProxy]);

  return active ? order : null;
}
