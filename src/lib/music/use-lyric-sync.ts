import { useCallback, useEffect, useRef, useState } from "react";
import type { SyncPoint } from "@/lib/subtitles/text-sync";
import { lyricOffsetKey } from "./lyric-offset";
import { getLyricSync, setLyricSync, subscribeLyricSync } from "./lyric-sync";
import type { MusicTrack } from "./types";

export function useLyricSync(
  track: MusicTrack | null | undefined,
): readonly [SyncPoint[], (points: SyncPoint[]) => void] {
  const key = lyricOffsetKey(track);
  const trackRef = useRef(track);
  trackRef.current = track;
  const [points, setPointsState] = useState<SyncPoint[]>(() => getLyricSync(track));
  useEffect(() => {
    setPointsState(getLyricSync(trackRef.current));
    return subscribeLyricSync(() => setPointsState(getLyricSync(trackRef.current)));
  }, [key]);
  const setPoints = useCallback(
    (next: SyncPoint[]) => {
      setPointsState(setLyricSync(track, next));
    },
    [track],
  );
  return [points, setPoints] as const;
}
