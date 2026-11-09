import type { Meta } from "@/lib/cinemeta";
import { episodeReviewsTarget } from "@/lib/episode-reviews";
import type { KitsuEpisode } from "@/lib/providers/kitsu";
import { EpisodeReviewsButton } from "../episode-reviews-dialog";

/**
 * Reviews for an anime episode, when it maps onto an IMDb season and episode. `meta` is the
 * series, not the cour or franchise entry, so the dialog is titled after the show.
 */
export function AnimeReviewsButton({
  meta,
  ep,
  compact = true,
}: {
  meta: Meta;
  ep: KitsuEpisode;
  compact?: boolean;
}) {
  const target = episodeReviewsTarget(ep.imdbId, ep.imdbSeason, ep.imdbEpisode);
  if (!target) return null;
  return (
    <EpisodeReviewsButton
      meta={meta}
      seriesImdbId={target.imdbId}
      season={target.season}
      episode={target.episode}
      episodeTitle={ep.title || undefined}
      compact={compact}
    />
  );
}
