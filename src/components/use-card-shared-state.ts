import { useMemo } from "react";
import type { Meta } from "@/lib/cinemeta";
import type { Settings } from "@/lib/settings/types";
import { isTop10, useTop10Version } from "@/lib/top10-set";
import { isInCinema, isRerun, deriveBadge } from "@/lib/card-badges";
import { useAnimeDub } from "@/hooks/use-anime-dub";
import { useMetaWatched } from "@/lib/watched-flag";
import { useInWatchlist } from "@/lib/watchlist";
import { useInLocalLibrary } from "@/lib/local-library";
import { isCardAnimeId } from "@/lib/card-anime";

export type CardSharedState = {
  showTop10: boolean;
  inCinema: boolean;
  rerun: boolean;
  newBadge: ReturnType<typeof deriveBadge>;
  hasDub: boolean;
  watched: boolean;
  inWatchlist: boolean;
  inLocalLibrary: boolean;
};

export function useCardSharedState({
  meta,
  settings,
  imdbId,
  flagRerun = false,
}: {
  meta: Meta;
  settings: Settings;
  imdbId?: string | null;
  flagRerun?: boolean;
}): CardSharedState {
  const isAnime = isCardAnimeId(meta.id);
  useTop10Version();
  const hasDub = useAnimeDub(meta.id, settings.showDubBadge && isAnime);

  const alternateIds = useMemo(() => [imdbId], [imdbId]);
  const watched = useMetaWatched(meta.id, meta.type, imdbId);
  const inWatchlist = useInWatchlist(meta.id, alternateIds);
  const inLocalLibrary = useInLocalLibrary(meta.id, alternateIds);
  const inCinema = isInCinema(meta);
  const rerun = (inCinema || flagRerun) && isRerun(meta);

  return {
    showTop10: settings.top10Ribbon && isTop10(meta.id, meta.name),
    inCinema,
    rerun,
    newBadge: !inCinema && !rerun ? deriveBadge(meta) : null,
    hasDub,
    watched,
    inWatchlist,
    inLocalLibrary,
  };
}
