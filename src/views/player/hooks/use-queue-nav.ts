import { useRef } from "react";
import type { Meta } from "@/lib/cinemeta";
import { queueIndexOf, useQueue } from "@/lib/queue";
import type { PlayEpisode, PlayerSrc } from "@/lib/view";

export function useQueueNav(params: {
  src: PlayerSrc;
  adjacent: { prev: PlayEpisode | null; next: PlayEpisode | null };
  canChangeEpisode: boolean;
  isLiveLike: boolean;
  queueDrivesNav: boolean;
  goToEpisode: (ep: PlayEpisode | null) => void;
  openPicker: (
    meta: Meta,
    episode?: PlayEpisode,
    opts?: { autoPlay?: boolean; attempt?: number; intent?: "play" | "download"; resume?: boolean },
  ) => void;
}) {
  const { src, adjacent, canChangeEpisode, isLiveLike, queueDrivesNav, goToEpisode, openPicker } =
    params;
  const queue = useQueue();
  const queueNav = queueDrivesNav && !isLiveLike;
  const currentQueueIdx = queueNav ? queueIndexOf(src.meta, src.episode) : -1;
  const queueNextItem = !queueNav
    ? null
    : currentQueueIdx >= 0
      ? (queue[currentQueueIdx + 1] ?? null)
      : (queue[0] ?? null);
  const queuePrevItem =
    queueNav && currentQueueIdx > 0 ? (queue[currentQueueIdx - 1] ?? null) : null;

  const hasNextEpisodeNow = queueNav ? !!queueNextItem : canChangeEpisode && !!adjacent.next;
  const hasPrevEpisodeNow = queueNav ? !!queuePrevItem : canChangeEpisode && !!adjacent.prev;

  const playNext = () => {
    if (queueNav) {
      if (queueNextItem) {
        openPicker(queueNextItem.meta, queueNextItem.episode);
      }
      return;
    }

    if (canChangeEpisode && adjacent.next) {
      goToEpisode(adjacent.next);
    }
  };

  const playPrev = () => {
    if (queueNav) {
      if (queuePrevItem) {
        openPicker(queuePrevItem.meta, queuePrevItem.episode);
      }
      return;
    }

    if (canChangeEpisode && adjacent.prev) {
      goToEpisode(adjacent.prev);
    }
  };

  const playNextRef = useRef(playNext);
  playNextRef.current = playNext;
  const playPrevRef = useRef(playPrev);
  playPrevRef.current = playPrev;

  return { hasNextEpisodeNow, hasPrevEpisodeNow, playNext, playPrev, playNextRef, playPrevRef };
}
