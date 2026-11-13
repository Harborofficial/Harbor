import { useEffect, useMemo, useRef, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import {
  animeSeriesFromStreamId,
  fetchSeasonEpisodes,
  fetchSeasonList,
  isAnimeId,
} from "@/lib/series-episodes";
import { useSettings } from "@/lib/settings";
import { harborImdbEpisodes } from "@/lib/providers/harbor-imdb";
import {
  applyTmdbEpisodeNames,
  needsTmdbEpisodeDetails,
  tmdbEpisodeNames,
} from "@/lib/providers/tmdb";
import type { PlayEpisode } from "@/lib/view";

export function useSeasonBrowser(
  meta: Meta,
  current: PlayEpisode | undefined,
  open: boolean,
  overrideMeta?: Meta | null,
): {
  seasons: number[];
  season: number;
  setSeason: (n: number) => void;
  episodes: PlayEpisode[];
  loading: boolean;
  imdbRatings: Map<string, number>;
} {
  const { settings } = useSettings();
  const effMeta = useMemo<Meta>(() => {
    if (overrideMeta) return overrideMeta;
    if (!isAnimeId(meta.id)) return meta;
    const base = animeSeriesFromStreamId(current?.kitsuStreamId);
    return base && base !== meta.id ? { ...meta, id: base } : meta;
  }, [meta, current?.kitsuStreamId, overrideMeta]);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeason] = useState<number>(current?.imdbSeason ?? current?.season ?? 1);
  const [episodes, setEpisodes] = useState<PlayEpisode[]>([]);
  const [loading, setLoading] = useState(false);
  const [imdbRatings, setImdbRatings] = useState<Map<string, number>>(new Map());
  const loadedSeasonMetaRef = useRef<string | null>(null);
  const loadedEpisodeKeyRef = useRef("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setImdbRatings(new Map());
    void harborImdbEpisodes(effMeta.id).then((map) => {
      if (!cancelled && map.size > 0) setImdbRatings(map);
    });
    return () => {
      cancelled = true;
    };
  }, [open, effMeta.id]);

  useEffect(() => {
    if (!open || overrideMeta) return;
    setSeason(current?.imdbSeason ?? current?.season ?? 1);
  }, [open, meta.id, current?.imdbSeason, current?.season, overrideMeta]);

  useEffect(() => {
    if (overrideMeta) setSeason(1);
  }, [overrideMeta?.id]);

  useEffect(() => {
    if (!open || (effMeta.type !== "series" && !isAnimeId(effMeta.id))) {
      setSeasons([]);
      return;
    }
    let cancelled = false;
    // A new entry or provider must not keep the previous list while loading.
    // The same entry can be re-read when its full metadata lands; keep the list
    // then so the panel does not flash between two identical fetches.
    if (loadedSeasonMetaRef.current !== effMeta.id) {
      loadedSeasonMetaRef.current = effMeta.id;
      setSeasons([]);
    }
    fetchSeasonList(effMeta, {
      tmdbKey: settings.tmdbKey,
      episodeSources: settings.metadataSources?.episodes,
      tvdbKey: settings.tvdbKey,
      tvdbSeasonType: settings.tvdbSeasonType,
    })
      .then((s) => {
        if (cancelled) return;
        setSeasons(s);
        setSeason((previous) => (s.length > 0 && !s.includes(previous) ? s[0] : previous));
      })
      .catch(() => {
        if (!cancelled) setSeasons([]);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    effMeta,
    settings.tmdbKey,
    settings.tvdbKey,
    settings.tvdbSeasonType,
    settings.metadataSources?.episodes,
  ]);

  useEffect(() => {
    if (!open || (effMeta.type !== "series" && !isAnimeId(effMeta.id))) {
      setEpisodes([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const episodeKey = `${effMeta.id}|${season}`;
    if (loadedEpisodeKeyRef.current !== episodeKey) {
      loadedEpisodeKeyRef.current = episodeKey;
      setEpisodes([]);
    }
    const overlayTmdbNames = (eps: PlayEpisode[]) => {
      if (!settings.tmdbKey || effMeta.id.startsWith("tmdb:tv:")) return;
      if (!needsTmdbEpisodeDetails(eps)) return;
      void tmdbEpisodeNames(settings.tmdbKey, effMeta.id, season)
        .then((names) => {
          if (cancelled || names.size === 0) return;
          setEpisodes((prev) => (prev === eps ? applyTmdbEpisodeNames(eps, names) : prev));
        })
        .catch(() => {});
    };
    fetchSeasonEpisodes(effMeta, season, {
      tmdbKey: settings.tmdbKey,
      episodeSources: settings.metadataSources?.episodes,
      tvdbKey: settings.tvdbKey,
      tvdbSeasonType: settings.tvdbSeasonType,
    })
      .then((eps) => {
        if (cancelled) return;
        setEpisodes(eps);
        overlayTmdbNames(eps);
      })
      .catch(() => {
        if (!cancelled) setEpisodes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    effMeta,
    season,
    settings.tmdbKey,
    settings.tvdbKey,
    settings.tvdbSeasonType,
    settings.metadataSources?.episodes,
  ]);

  return { seasons, season, setSeason, episodes, loading, imdbRatings };
}
