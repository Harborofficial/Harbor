import { useEffect, useRef } from "react";
import { isBundledEngineUrl } from "@/lib/stremio-server";
import {
  setTrickplayState,
  trickplaySetUrl,
  trickplaySpawnEager,
  trickplayStop,
  trickplayWarm,
} from "@/lib/trickplay";

import {
  getPlaybackBuffered,
  getPlaybackPosition,
  getSeekHovering,
} from "@/lib/player/playback-clock";

export function useTrickplay({
  url,
  headers,
  enabled,
  isLive,
  playing,
  buffering,
  durationSec,
}: {
  url: string;
  headers?: Record<string, string>;
  enabled: boolean;
  isLive?: boolean;
  playing: boolean;
  buffering: boolean;
  durationSec: number;
}) {
  const playback = useRef({ playing, buffering, durationSec });
  playback.current = { playing, buffering, durationSec };
  useEffect(() => {
    if (!enabled || !url) {
      setTrickplayState({ active: false, bufferedOnly: false });
      return;
    }
    const isTorrent = isBundledEngineUrl(url);
    setTrickplayState({ active: true, bufferedOnly: isTorrent });
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const warm = () => {
      const current = playback.current;
      // Remote previews open a second stream: wait for playback to build headroom.
      const hasHeadroom = !/^https?:/i.test(url) || getPlaybackBuffered() >= 5;
      const allowed = !isLive && !isTorrent && current.playing && !current.buffering && hasHeadroom;
      if (allowed && getSeekHovering()) return;
      void trickplayWarm(getPlaybackPosition(), current.durationSec, allowed);
    };
    void trickplaySetUrl(url, headers).then(() => {
      if (!alive) return;
      if (!isLive) void trickplaySpawnEager();
      warm();
      timer = setInterval(warm, 3000);
    });
    return () => {
      alive = false;
      clearInterval(timer);
      setTrickplayState({ active: false, bufferedOnly: false });
      void trickplayStop();
    };
  }, [url, enabled, isLive]);

  useEffect(() => {
    if (!playing || buffering) void trickplayWarm(getPlaybackPosition(), durationSec, false);
  }, [playing, buffering, durationSec]);
}
