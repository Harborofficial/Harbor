import { parseKitsuId } from "@/lib/providers/kitsu";
import {
  isScopedSplitFranchiseRoot,
  splitFranchiseDisplaySeason,
} from "@/lib/streams/anime-identity-core";

/**
 * A split-franchise cour (e.g. TYBW) renders standalone. The base show's
 * franchise pool and TVDB panel must not take over its episode grid.
 *
 * The split part is known synchronously from the opened Kitsu id, so this must
 * not wait for the async franchise root: that first render pools the whole
 * franchise and briefly shows the 2004 seasons.
 */
export function isSoloSplitEntry(metaId: string, rootEntryId: string | null): boolean {
  if (!/^(kitsu|mal|anilist|anidb):/.test(metaId)) return false;
  const opened = parseKitsuId(metaId);
  if (splitFranchiseDisplaySeason(opened) != null) return true;
  if (rootEntryId == null) return false;
  const root = parseKitsuId(rootEntryId);
  return root != null && root !== opened && isScopedSplitFranchiseRoot(root);
}
