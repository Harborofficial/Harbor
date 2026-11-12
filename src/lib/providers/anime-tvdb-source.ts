import { splitFranchiseDisplaySeason } from "@/lib/streams/anime-identity-core";

/**
 * A split-franchise child (e.g. a TYBW cour) can resolve to the base show's
 * TVDB id. Those episodes belong to the base entry, not this cour, so they must
 * not replace the cour's own episodes or artwork.
 */
export function isSharedSplitTvdb(
  kitsuId: number,
  tvdbId: number | null,
  rootTvdbId: number | null,
): boolean {
  return (
    splitFranchiseDisplaySeason(kitsuId) != null &&
    tvdbId != null &&
    rootTvdbId != null &&
    tvdbId === rootTvdbId
  );
}
