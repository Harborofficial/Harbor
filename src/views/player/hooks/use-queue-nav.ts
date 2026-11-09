import { useRef } from "react";
import type { Meta } from "@/lib/cinemeta";
import { useQueue } from "@/lib/queue";
import { queueSessionIndex } from "@/lib/queue-session";
import type { PickerOptions, PlayEpisode, PlayerSrc } from "@/lib/view";

export function useQueueNav(params: {
  src: PlayerSrc;
  adjacent: { prev: PlayEpisode | null; next: PlayEpisode | null };
  canChangeEpisode: boolean;
  isLiveLike: boolean;
  queueDrivesNav: boolean;
  instantPlay?: boolean;
  goToEpisode: (ep: PlayEpisode | null) => void;
  openPicker: (meta: Meta, episode?: PlayEpisode, opts?: PickerOptions) => void;
}) {
  const {
    src,
    adjacent,
    canChangeEpisode,
    isLiveLike,
    queueDrivesNav,
    instantPlay = false,
    goToEpisode,
    openPicker,
  } = params;
  const queue = useQueue();
  const currentQueueIdx = queueSessionIndex(src, queue);
  const queueNav = queueDrivesNav && !isLiveLike && currentQueueIdx >= 0;
  const queueNextItem = queueNav ? (queue[currentQueueIdx + 1] ?? null) : null;
  const queuePrevItem =
    queueNav && currentQueueIdx > 0 ? (queue[currentQueueIdx - 1] ?? null) : null;

  const hasNextEpisodeNow = queueNav ? !!queueNextItem : canChangeEpisode && !!adjacent.next;
  const hasPrevEpisodeNow = queueNav ? !!queuePrevItem : canChangeEpisode && !!adjacent.prev;

  const playNext = () => {
    if (queueNav) {
      if (queueNextItem) {
        openPicker(queueNextItem.meta, queueNextItem.episode, {
          queueItemId: queueNextItem.id,
          autoPlay: instantPlay,
          resume: true,
        });
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
        openPicker(queuePrevItem.meta, queuePrevItem.episode, {
          queueItemId: queuePrevItem.id,
          autoPlay: instantPlay,
          resume: true,
        });
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
