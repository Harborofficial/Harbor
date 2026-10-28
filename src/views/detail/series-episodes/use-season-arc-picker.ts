import { useMemo } from "react";
import type { Season } from "@/lib/providers/tmdb";
import { setViewedSeason } from "@/lib/season-view-pref";
import {
  isGenericTvdbSeasonName,
  seasonDateRange,
  type TvdbOrder,
} from "@/lib/providers/tvdb-order";
import { isNewSeason } from "../helpers";
import { isGenericSeasonName } from "@/lib/season-name";
import type { ArcGroupsState } from "./use-arc-groups";
import type { PickerItem } from "./season-arc-picker";

export function useSeasonArcPicker({
  source,
  arc,
  ordering,
  orderSeasonEff,
  seasons,
  active,
  lastEpisodeAir,
  metaId,
  setActive,
  setOrderSeason,
  userPickedRef,
  tmdbSeasonNameFallback,
  seasonPosters,
}: {
  source: "arcs" | "order" | "default";
  arc: ArcGroupsState;
  ordering: TvdbOrder | null;
  orderSeasonEff: number;
  seasons: Season[];
  active: number;
  lastEpisodeAir?: { seasonNumber: number; airDate: string | null };
  metaId: string;
  setActive: (n: number) => void;
  setOrderSeason: (n: number) => void;
  userPickedRef: React.MutableRefObject<boolean>;
  /**
   * When true, aired-order views may borrow TMDB season names, posters, and
   * synopses for the same number. Only enable for aired/official views, where
   * TVDB and TMDB season numbering align.
   */
  tmdbSeasonNameFallback?: boolean;
  /** TMDB poster URLs used when no TVDB key is configured. */
  seasonPosters?: Record<number, string>;
}): { items: PickerItem[]; activeKey: string; onSelect: (key: string) => void } {
  return useMemo(() => {
    if (source === "arcs") {
      return {
        items: arc.arcs.map((a) => ({ key: a.id, name: a.name, count: a.episodes.length })),
        activeKey: arc.activeArcId ?? arc.arcs[0]?.id ?? "",
        onSelect: arc.setActiveArcId,
      };
    }
    if (source === "order" && ordering) {
      const tmdbByNumber = new Map(seasons.map((s) => [s.seasonNumber, s] as const));
      return {
        items: ordering.seasons.map((s) => {
          const { from, to } = seasonDateRange(ordering.bySeason.get(s.seasonNumber) ?? []);
          let name = s.name;
          let nameLanguage = s.nameLanguage;
          const tmdbSeason = tmdbByNumber.get(s.seasonNumber);
          const tmdbName = tmdbSeason?.name.trim();
          if (
            tmdbSeasonNameFallback &&
            tmdbName &&
            isGenericTvdbSeasonName(name, s.seasonNumber) &&
            !isGenericSeasonName(tmdbName, s.seasonNumber)
          ) {
            name = tmdbName;
            nameLanguage = tmdbSeason?.nameLanguage;
          }
          return {
            key: String(s.seasonNumber),
            name,
            nameLanguage: nameLanguage ?? "en",
            count: s.episodeCount,
            year: s.airDate?.slice(0, 4),
            from,
            to,
            extra: s.seasonNumber <= 0,
            seasonNumber: s.seasonNumber,
            isGenericName: name === s.name ? s.isGenericName : false,
            // TMDB numbers other order types differently; only aired-style
            // views may use its name, poster, and synopsis for this season.
            overview: tmdbSeasonNameFallback ? tmdbSeason?.overview || s.overview : s.overview,
            overviewLanguage:
              tmdbSeasonNameFallback && tmdbSeason?.overview
                ? tmdbSeason.overviewLanguage
                : s.overviewLanguage,
            poster: tmdbSeasonNameFallback ? seasonPosters?.[s.seasonNumber] : undefined,
          };
        }),
        activeKey: String(orderSeasonEff),
        onSelect: (k: string) => {
          setViewedSeason(metaId, Number(k));
          setOrderSeason(Number(k));
        },
      };
    }
    return {
      items: seasons.map((s) => ({
        key: String(s.seasonNumber),
        name: s.name,
        nameLanguage: s.nameLanguage,
        count: s.episodeCount,
        year: s.airDate?.slice(0, 4),
        isNew: isNewSeason(s, lastEpisodeAir),
        seasonNumber: s.seasonNumber,
        isGenericName: s.isGenericName,
        overview: s.overview,
        overviewLanguage: s.overviewLanguage,
        poster: seasonPosters?.[s.seasonNumber],
      })),
      activeKey: String(active),
      onSelect: (k: string) => {
        userPickedRef.current = true;
        setViewedSeason(metaId, Number(k));
        setActive(Number(k));
      },
    };
  }, [
    source,
    arc.arcs,
    arc.activeArcId,
    arc.setActiveArcId,
    ordering,
    orderSeasonEff,
    seasons,
    active,
    lastEpisodeAir,
    metaId,
    setActive,
    setOrderSeason,
    userPickedRef,
    tmdbSeasonNameFallback,
    seasonPosters,
  ]);
}
