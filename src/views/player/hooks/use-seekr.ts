import { useEffect } from "react";
import { seekrStart, seekrStop, useSeekrState } from "@/lib/seekr";

export function useSeekr({
  apiKey,
  metaId,
  imdbId,
  type,
  season,
  episode,
  durationSec,
  enabled,
  isLive,
}: {
  apiKey: string;
  metaId: string;
  imdbId?: string | null;
  type?: string;
  season?: number | null;
  episode?: number | null;
  durationSec: number;
  enabled: boolean;
  isLive: boolean;
}) {
  const state = useSeekrState();

  useEffect(() => {
    if (!enabled || isLive || !apiKey.trim() || durationSec <= 0) {
      seekrStop();
      return;
    }
    const timer = window.setTimeout(() => {
      void seekrStart({ apiKey, metaId, imdbId, type, season, episode, durationSec });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [apiKey, metaId, imdbId, type, season, episode, durationSec, enabled, isLive]);

  useEffect(() => () => seekrStop(), []);

  return state;
}
