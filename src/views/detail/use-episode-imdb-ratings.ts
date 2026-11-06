import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  harborImdbEpisodes,
  harborImdbEpisodesCached,
  subscribeHarborImdbEpisodes,
} from "@/lib/providers/harbor-imdb";
import { omdbSeasonRatings } from "@/lib/providers/omdb";
import { createOmdbSeasonQueue } from "@/lib/omdb-season-queue";

const NO_RATINGS = new Map<string, number>();

export function useHarborEpisodeRatings(imdbId: string | null): ReadonlyMap<string, number> {
  const id = imdbId && /^tt\d+$/.test(imdbId) ? imdbId : null;
  const subscribe = useCallback(
    (listener: () => void) => (id ? subscribeHarborImdbEpisodes(id, listener) : () => {}),
    [id],
  );
  const snapshot = useCallback(
    () => (id ? harborImdbEpisodesCached(id) : undefined) ?? NO_RATINGS,
    [id],
  );
  const ratings = useSyncExternalStore(subscribe, snapshot, () => NO_RATINGS);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    void harborImdbEpisodes(id)
      .then((map) => {
        if (cancelled || map.size > 0) return;
        // Retry once after the negative cache expires; unmounting or changing
        // titles cancels the retry rather than polling in the background.
        retry = setTimeout(() => {
          if (!cancelled) void harborImdbEpisodes(id).catch(() => {});
        }, 60_000);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [id]);

  return ratings;
}

export function useEpisodeImdbRatings(
  imdbId: string | null,
  seasons: number | readonly number[],
  omdbKey: string,
) {
  const requestedSeasons = [...new Set(typeof seasons === "number" ? [seasons] : seasons)];
  const seasonsKey = JSON.stringify(requestedSeasons);
  // Keep already loaded seasons visible as a user scrolls through an all-episode order.
  const key = JSON.stringify([imdbId, omdbKey]);
  const [result, setResult] = useState({
    key: "",
    harbor: new Map<string, number>(),
    omdb: new Map<string, number>(),
  });
  const queueRef = useRef<{
    key: string;
    enqueue: (seasons: readonly number[]) => void;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The two sources answer in whatever order the network gives them, so keep them apart and rank
    // them when read, Harbor first, matching src/lib/imdb-rating.ts. Merging in arrival order would
    // make the badge depend on which request happened to finish last.
    const publish = (source: "harbor" | "omdb", ratings: Map<string, number>) => {
      const valid = new Map<string, number>();
      for (const [coordinate, rating] of ratings) {
        if (Number.isFinite(rating) && rating > 0 && rating <= 10) valid.set(coordinate, rating);
      }
      if (cancelled || valid.size === 0) return;
      setResult((previous) => {
        const held = previous.key === key ? previous : null;
        return {
          key,
          harbor: source === "harbor" ? valid : (held?.harbor ?? new Map<string, number>()),
          omdb:
            source === "omdb"
              ? new Map([...(held?.omdb ?? new Map<string, number>()), ...valid])
              : (held?.omdb ?? new Map<string, number>()),
        };
      });
    };
    if (imdbId?.match(/^tt\d+$/)) {
      // Independent requests: a retired Harbor server must not hold up OMDb.
      void harborImdbEpisodes(imdbId)
        .then((ratings) => publish("harbor", ratings))
        .catch(() => {});
      if (omdbKey) {
        const queue = createOmdbSeasonQueue(
          (season: number) => omdbSeasonRatings(omdbKey, imdbId, season),
          (season, ratings) =>
            publish(
              "omdb",
              new Map([...ratings].map(([ep, rating]) => [`${season}:${ep}`, rating])),
            ),
        );
        queueRef.current = { key, enqueue: queue.enqueue };
        return () => {
          cancelled = true;
          queue.dispose();
          if (queueRef.current?.key === key) queueRef.current = null;
        };
      }
    }
    return () => {
      cancelled = true;
      queueRef.current = null;
    };
  }, [key, imdbId, omdbKey]);

  useEffect(() => {
    // Do not restart existing requests when scrolling exposes another season.
    // The queue retains attempted seasons until this title/API-key scope ends.
    if (queueRef.current?.key === key) queueRef.current.enqueue(requestedSeasons);
  }, [key, seasonsKey]);
  return useMemo(() => {
    if (result.key !== key) return new Map<string, number>();
    return new Map([...result.omdb, ...result.harbor]);
  }, [result, key]);
}
