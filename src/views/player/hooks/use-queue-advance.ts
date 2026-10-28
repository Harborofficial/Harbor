import { useEffect, useRef, type RefObject } from "react";
import type { PlayerSnapshot } from "@/lib/player/bridge";
import { getPlaybackPosition } from "@/lib/player/playback-clock";
import { isNaturalEnd } from "@/lib/player/playback-end";
import type { Meta } from "@/lib/cinemeta";
import type { PlayEpisode, PlayerSrc } from "@/lib/view";
import {
  getSleepAtEnd,
  queueIndexOf,
  queueRemove,
  setSleepAtEnd,
  type QueueItem,
} from "@/lib/queue";

const STUB_MAX_SEC = 150;

export function useQueueAdvance(params: {
  src: PlayerSrc;
  snap: PlayerSnapshot;
  queue: QueueItem[];
  isLive: boolean;
  roomGuest: boolean;
  queueDrivesNav: boolean;
  instantPlay: boolean;
  startedNearEndRef: RefObject<boolean>;
  openPicker: (
    meta: Meta,
    episode?: PlayEpisode,
    opts?: {
      autoPlay?: boolean;
      attempt?: number;
      intent?: "play" | "download";
      resume?: boolean;
    },
  ) => void;
  closePlayer: () => void | Promise<void>;
}) {
  const {
    src,
    snap,
    queue,
    isLive,
    roomGuest,
    queueDrivesNav,
    instantPlay,
    startedNearEndRef,
    openPicker,
    closePlayer,
  } = params;
  const firedForRef = useRef<string | null>(null);

  useEffect(() => {
    firedForRef.current = null;
  }, [src.url]);

  useEffect(() => {
    if (isLive || roomGuest) return;

    const currentIndex = queueIndexOf(src.meta, src.episode);
    const currentItem = currentIndex >= 0 ? queue[currentIndex] : undefined;
    const sleepAtEnd = getSleepAtEnd();

    if (!queueDrivesNav && !sleepAtEnd && !currentItem) return;
    if (snap.durationSec <= STUB_MAX_SEC) return;
    if (startedNearEndRef.current) return;
    if (!isNaturalEnd(snap, getPlaybackPosition())) return;
    if (firedForRef.current === src.url) return;

    firedForRef.current = src.url;

    // Capture the successor before removing the completed item.
    const nextItem = currentIndex >= 0 ? queue[currentIndex + 1] : queue[0];

    if (currentItem) queueRemove(currentItem.id);

    if (queueDrivesNav) {
      if (nextItem) {
        openPicker(nextItem.meta, nextItem.episode, {
          autoPlay: instantPlay,
          resume: true,
        });
        return;
      }

      if (sleepAtEnd) setSleepAtEnd(false);
      void closePlayer();
      return;
    }

    if (sleepAtEnd) {
      setSleepAtEnd(false);
      void closePlayer();
    }
  }, [
    src,
    snap,
    queue,
    isLive,
    roomGuest,
    queueDrivesNav,
    instantPlay,
    startedNearEndRef,
    openPicker,
    closePlayer,
  ]);
}
