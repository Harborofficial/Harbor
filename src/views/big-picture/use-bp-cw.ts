import { useSettings } from "@/lib/settings";
import type { LibraryItem } from "@/lib/stremio";
import { useCwAdvance } from "@/views/home/hooks/use-cw-advance";
import { useBpAnimeWatched } from "./use-bp-anime-watched";

// Big Picture home and shows used to read the raw library row, so a finished
// episode stayed on the card with no Up Next and no countdown, and the timer
// setting never applied. Run the same advance pipeline the desktop home uses.
export function useBpCwAdvance(items: LibraryItem[]): LibraryItem[] {
  const { settings } = useSettings();
  const watched = useBpAnimeWatched(items.map((i) => i._id));
  return useCwAdvance(
    items,
    settings.tmdbKey,
    settings.cwAdvanceNext,
    undefined,
    "all",
    0,
    undefined,
    watched.simklWatched,
    watched.anilistWatched,
    watched.simklStatus,
    0,
    settings.episodeHiding,
    settings.animeCwEnd,
  );
}
