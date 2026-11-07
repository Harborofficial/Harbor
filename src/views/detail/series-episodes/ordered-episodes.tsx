import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Meta } from "@/lib/cinemeta";
import { getEpisodeProgress } from "@/lib/episode-progress";
import { manualWatchedVersion, subscribeManualWatched } from "@/lib/manual-watched";
import type { Episode } from "@/lib/providers/tmdb";
import { useSettings } from "@/lib/settings";
import { spoilerMaskFor } from "@/lib/spoilers";
import { EpisodeGridSkeleton } from "../episode-grid-skeleton";
import { EpisodeRow } from "../series-episode-row";
import { EpisodeStrip } from "../episode-strip";

export function OrderedEpisodes({
  meta,
  episodes,
  loading,
  traktKey,
  traktWatched,
  stremioWatched,
  simklWatched,
  pmdbWatched,
  cinemetaVideos,
  seriesImdbId,
  onContextMenu,
  onSeasonVisible,
}: {
  meta: Meta;
  episodes: Episode[];
  loading: boolean;
  traktKey: string;
  traktWatched: Set<string>;
  stremioWatched?: Set<string>;
  simklWatched: Set<string>;
  pmdbWatched?: Set<string>;
  cinemetaVideos?: NonNullable<Meta["videos"]>;
  seriesImdbId?: string | null;
  onContextMenu: (e: React.MouseEvent, season: number, episode: number, watched: boolean) => void;
  onSeasonVisible?: (season: number) => void;
}) {
  const { settings } = useSettings();
  const mwVersion = useSyncExternalStore(subscribeManualWatched, manualWatchedVersion);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !onSeasonVisible || typeof IntersectionObserver === "undefined") return;
    // One observer follows the currently rendered cards. The grid renders only
    // one page at a time; watch newly mounted cards as pagination changes.
    const watched = new WeakSet<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const season = Number((entry.target as HTMLElement).dataset.omdbSeason);
          if (Number.isInteger(season) && season > 0) onSeasonVisible(season);
        }
      },
      { rootMargin: "300px" },
    );
    const attach = (node: Node) => {
      if (!(node instanceof Element)) return;
      const observe = (el: Element) => {
        if (watched.has(el)) return;
        watched.add(el);
        observer.observe(el);
      };
      if (node.matches("[data-omdb-season]")) observe(node);
      node.querySelectorAll("[data-omdb-season]").forEach(observe);
    };
    attach(root);
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) attach(node);
      }
    });
    mutations.observe(root, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, [onSeasonVisible, episodes.length, settings.episodeLayout]);

  const progressByKey = useMemo(() => {
    const m = new Map<string, { ratio: number; watched: boolean; startedAt: number }>();
    for (const ep of episodes) {
      m.set(
        `${ep.seasonNumber}:${ep.episodeNumber}`,
        getEpisodeProgress(
          meta.id,
          ep.seasonNumber,
          ep.episodeNumber,
          ep.runtime,
          traktKey,
          traktWatched,
          stremioWatched,
          undefined,
          simklWatched,
          undefined,
          undefined,
          undefined,
          pmdbWatched,
        ),
      );
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    episodes,
    meta.id,
    traktKey,
    traktWatched,
    stremioWatched,
    simklWatched,
    pmdbWatched,
    mwVersion,
  ]);

  const nextUpKey = useMemo(() => {
    for (const ep of episodes) {
      const k = `${ep.seasonNumber}:${ep.episodeNumber}`;
      if (!progressByKey.get(k)?.watched) return k;
    }
    return null;
  }, [episodes, progressByKey]);

  if (loading && episodes.length === 0) return <EpisodeGridSkeleton />;

  if (settings.episodeLayout !== "list") {
    return (
      <div ref={rootRef}>
        <EpisodeStrip
          meta={meta}
          episodes={episodes}
          layout={settings.episodeLayout === "grid" ? "grid" : "strip"}
          progressFor={(ep) => progressByKey.get(`${ep.seasonNumber}:${ep.episodeNumber}`)!}
          thumbnailFor={(ep) =>
            cinemetaVideos?.find(
              (v) => v.season === ep.seasonNumber && v.episode === ep.episodeNumber,
            )?.thumbnail
          }
          spoilerFor={(ep) => {
            const k = `${ep.seasonNumber}:${ep.episodeNumber}`;
            return spoilerMaskFor(settings, {
              watched: progressByKey.get(k)?.watched ?? false,
              isNextUp: k === nextUpKey,
            });
          }}
          onContextMenu={onContextMenu}
          seriesImdbId={seriesImdbId}
          cinemetaVideos={cinemetaVideos}
          markRatingSeasons={!!onSeasonVisible}
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-1">
      {episodes.map((ep) => {
        const key = `${ep.seasonNumber}:${ep.episodeNumber}`;
        const progress = progressByKey.get(key)!;
        return (
          <div key={ep.id} data-omdb-season={onSeasonVisible ? ep.seasonNumber : undefined}>
            <EpisodeRow
              meta={meta}
              ep={ep}
              cinemetaThumbnail={
                cinemetaVideos?.find(
                  (v) => v.season === ep.seasonNumber && v.episode === ep.episodeNumber,
                )?.thumbnail
              }
              cinemetaVideos={cinemetaVideos}
              seriesImdbId={seriesImdbId}
              progress={progress}
              spoiler={spoilerMaskFor(settings, {
                watched: progress.watched,
                isNextUp: key === nextUpKey,
              })}
              onContextMenu={onContextMenu}
            />
          </div>
        );
      })}
    </div>
  );
}
