import { useRef } from "react";
import type { QueueItem } from "@/lib/queue";
import { queueSessionIndex } from "@/lib/queue-session";
import type { PlayerSrc } from "@/lib/view";
import type { PlayerSnapshot } from "@/lib/player/bridge";

export function useQueuePlayback({
  src,
  queue,
  enabled,
  status,
}: {
  src: PlayerSrc;
  queue: readonly QueueItem[];
  enabled: boolean;
  status: PlayerSnapshot["status"];
}): boolean {
  const completedSource = useRef<string | null>(null);
  const sourceKey = JSON.stringify([src.url, src.queueItemId, src.meta.id, src.episode]);
  if (completedSource.current !== sourceKey || status !== "ended" || !enabled) {
    completedSource.current = null;
  }
  const active = enabled && queueSessionIndex(src, queue) >= 0;
  // Removing a completed item must not re-arm normal autoplay for the same EOF.
  if (active && status === "ended") completedSource.current = sourceKey;
  return active || completedSource.current === sourceKey;
}
