import type { DownloadItem } from "@/lib/download/downloads-store";

/** A currently active transfer takes precedence over stale failed/canceled copies. */
export function episodeDownloadAction(
  status?: DownloadItem["status"] | null,
): "choose" | "cancel" | "saved" {
  if (status === "done") return "saved";
  if (status === "downloading" || status === "paused") return "cancel";
  return "choose";
}

/** Never reselect the active P2P torrent to prepare another file during playback. */
export function sharedPlaybackTorrentRisk(
  playingHash: string | null,
  candidateHash: string | null | undefined,
  usesTorrentEngine: boolean,
): boolean {
  return (
    !!playingHash &&
    !!candidateHash &&
    usesTorrentEngine &&
    playingHash.toLowerCase() === candidateHash.toLowerCase()
  );
}
