import { useCallback, useSyncExternalStore } from "react";
import { downloadsSnapshot, subscribeDownloads } from "@/lib/download/downloads-store";
import { contextDownloadTask } from "@/lib/download/contextual-preparation";

/** Only the episode whose transfer changed needs to repaint during playback. */
export function useEpisodeDownload(metaId: string, season: number, episode: number) {
  const snapshot = useCallback(
    () => contextDownloadTask(downloadsSnapshot(), metaId, { season, episode }),
    [metaId, season, episode],
  );
  return useSyncExternalStore(subscribeDownloads, snapshot, snapshot);
}
