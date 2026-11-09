import { useCallback } from "react";
import type { Meta } from "@/lib/cinemeta";
import { useSettings } from "@/lib/settings";
import { useTogether } from "@/lib/together/provider";
import { usePlayerNavigation, type PlayEpisode } from "@/lib/view";

export function useCastModalPlay() {
  const { exitPlayer, openPicker } = usePlayerNavigation();
  const { settings, update } = useSettings();
  const { snapshot, claimHost } = useTogether();
  return useCallback(
    (m: Meta, ep?: PlayEpisode, queueItemId?: string) => {
      const inSession = snapshot.state === "joined" && snapshot.participants.length >= 2;
      if (inSession) claimHost(true);
      exitPlayer();
      if (queueItemId) update({ queueDrivesNav: true });
      openPicker(m, ep, { autoPlay: settings.instantPlay, resume: true, queueItemId });
    },
    [
      exitPlayer,
      openPicker,
      settings.instantPlay,
      snapshot.state,
      snapshot.participants.length,
      claimHost,
      update,
    ],
  );
}
