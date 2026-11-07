import { useEffect, useSyncExternalStore } from "react";
import {
  animeHasDub,
  dubSetReady,
  ensureDubForAnimeId,
  subscribeDubSet,
} from "@/lib/providers/anime-dub-sub";

/** Shared DUB lookup for poster cards, TV cards, and Big Picture metadata. */
export function useAnimeDub(metaId: string | undefined, enabled: boolean): boolean {
  const ready = useSyncExternalStore(subscribeDubSet, dubSetReady);
  useEffect(() => {
    if (enabled) ensureDubForAnimeId(metaId);
  }, [enabled, metaId]);
  return enabled && ready && animeHasDub(metaId);
}
