import { useEffect, useState } from "react";
import type { GameDownloadBundle } from "@/lib/games/download-game-groups";
import {
  featuredStatusSignature,
  featuredStorageKey,
  reconcileFeaturedSlots,
  restoreFeaturedSlots,
  sameFeaturedState,
  serializeFeaturedSlots,
  type FeaturedState,
} from "@/lib/games/download-featured";

function load(profile: string): FeaturedState {
  try {
    return restoreFeaturedSlots(localStorage.getItem(featuredStorageKey(profile)));
  } catch {
    return restoreFeaturedSlots(null);
  }
}

/** Keep the two featured *positions* stable across events and remounts.
 * Never use progress-event updatedAt to decide their order. */
export function useGameFeaturedDownloads(
  profile: string,
  groups: readonly GameDownloadBundle[],
  ready: boolean,
): readonly string[] {
  const [selection, setSelection] = useState(() => ({ profile, state: load(profile) }));
  const signature = featuredStatusSignature(groups);
  const base = selection.profile === profile ? selection.state : load(profile);
  const visible = ready ? reconcileFeaturedSlots(base, groups) : base;
  useEffect(() => {
    if (!ready) return;
    setSelection((previous) => {
      const state = previous.profile === profile ? previous.state : load(profile);
      const next = reconcileFeaturedSlots(state, groups);
      if (previous.profile === profile && sameFeaturedState(state, next)) return previous;
      return { profile, state: next };
    });
    // Status and creation signatures change only on group start/stop, not
    // on every byte progress update.
  }, [profile, signature, ready]);
  useEffect(() => {
    if (selection.profile !== profile || !selection.state.initialized) return;
    try {
      localStorage.setItem(featuredStorageKey(profile), serializeFeaturedSlots(selection.state));
    } catch {
      /* In-memory pinning still works with disabled browser storage. */
    }
  }, [profile, selection]);
  return visible.slots.filter((pin): pin is NonNullable<typeof pin> => !!pin).map((pin) => pin.key);
}
