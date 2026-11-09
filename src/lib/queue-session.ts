import type { QueueItem } from "./queue";
import type { PlayerSrc } from "./view";

export function queueSessionIndex(src: PlayerSrc, queue: readonly QueueItem[]): number {
  if (!src.queueItemId) return -1;
  return queue.findIndex(
    (item) =>
      item.id === src.queueItemId &&
      item.meta.id === src.meta.id &&
      item.episode?.season === src.episode?.season &&
      item.episode?.episode === src.episode?.episode,
  );
}
