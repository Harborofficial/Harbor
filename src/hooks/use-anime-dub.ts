import { useEffect, useSyncExternalStore } from "react";
import {
  animeHasDub,
  dubSetSnapshot,
  ensureDubForAnimeId,
  subscribeDubSet,
} from "@/lib/providers/anime-dub-sub";

/** Shared DUB lookup for poster cards, TV cards, and Big Picture metadata. */
export function useAnimeDub(metaId: string | undefined, enabled: boolean): boolean {
  const snapshot = useSyncExternalStore(subscribeDubSet, dubSetSnapshot);
  useEffect(() => {
    if (enabled) ensureDubForAnimeId(metaId);
  }, [enabled, metaId]);
  return enabled && snapshot.ready && animeHasDub(metaId);
}
