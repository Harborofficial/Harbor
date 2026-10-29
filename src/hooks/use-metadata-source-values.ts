import { useEffect, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import { metadataAddons, resolveAddonMetaSource } from "@/lib/meta-resource";
import {
  addonKeyFromSource,
  normalizeMetadataSourceChain,
  type MetadataSourceSection,
} from "@/lib/metadata-sources";
import type { CastEntry, TmdbDetail } from "@/lib/providers/tmdb";
import { tmdbDetails } from "@/lib/providers/tmdb";
import { fanartMovie, fanartTv } from "@/lib/providers/fanart";
import { rpdbBackdrop, rpdbPoster } from "@/lib/providers/rpdb";
import type { Settings } from "@/lib/settings";

export type MetadataSourceValueName =
  | "title"
  | "description"
  | "poster"
  | "backdrop"
  | "logo"
  | "seasonPosters"
  | "cast"
  | "trailers";

export type SeasonOverviewSource = {
  sourceName?: string;
  overviews: Record<number, string>;
};

export type MetadataSourceValues = {
  title?: string;
  description?: string;
  poster?: string;
  backdrop?: string;
  logo?: string;
  seasonPosters?: Record<number, string>;
  seasonOverviewsBySource?: Record<string, SeasonOverviewSource>;
  cast?: CastEntry[];
  trailerCandidates?: string[];
  sourceRatings?: Record<string, string>;
  sourceNames?: Partial<Record<MetadataSourceValueName, string>>;
  /** Normalized chains, including defaults, for consumers outside this hook. */
  chains?: Partial<Record<MetadataSourceSection, string[]>>;
};

type Loaded = MetadataSourceValues & {
  sourceName?: string;
  rating?: string;
  seasonOverviews?: Record<number, string>;
};

type ScopedValues = { key: string; values: MetadataSourceValues };

function addonSeasonPosters(meta: Meta | null): Record<number, string> | undefined {
  if (!meta) return undefined;
  const out: Record<number, string> = {};
  const addMap = (map: Record<string | number, string> | undefined) => {
    for (const [key, value] of Object.entries(map ?? {})) {
      const number = Number(key);
      if (Number.isInteger(number) && number >= 0 && value.trim() && out[number] == null) {
        out[number] = value;
      }
    }
  };
  addMap(meta.seasonPosters);
  addMap(meta.app_extras?.seasonPosters);
  for (const season of meta.seasons ?? []) {
    const number = season.season ?? season.number ?? season.seasonNumber;
    const poster = season.poster ?? season.image;
    if (typeof number === "number" && Number.isInteger(number) && number >= 0 && poster?.trim()) {
      if (out[number] == null) out[number] = poster;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function addonCast(meta: Meta): CastEntry[] | undefined {
  const cast = meta.cast ?? [];
  return cast.length > 0
    ? cast.map((name, index) => ({
        id: -(index + 1),
        name,
        character: "",
        profilePath: null,
        order: index,
      }))
    : undefined;
}

function addonSeasonOverviews(meta: Meta | null): Record<number, string> | undefined {
  if (!meta) return undefined;
  const out: Record<number, string> = {};
  const addMap = (map: Record<string | number, string> | undefined) => {
    for (const [key, value] of Object.entries(map ?? {})) {
      const number = Number(key);
      if (Number.isInteger(number) && number >= 0 && value.trim() && out[number] == null) {
        out[number] = value;
      }
    }
  };
  addMap(meta.seasonOverviews);
  addMap(meta.app_extras?.seasonOverviews);
  for (const season of meta.seasons ?? []) {
    const number = season.season ?? season.number ?? season.seasonNumber;
    const overview = season.overview ?? season.description;
    if (typeof number === "number" && Number.isInteger(number) && number >= 0 && overview?.trim()) {
      if (out[number] == null) out[number] = overview;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function expectedSeasonNumbers(meta: Meta, detail: TmdbDetail | null): Set<number> {
  const out = new Set<number>();
  const add = (value: unknown) => {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) out.add(value);
  };
  for (const season of detail?.seasons ?? []) add(season.seasonNumber);
  for (const season of meta.seasons ?? []) {
    add(season.season ?? season.number ?? season.seasonNumber);
  }
  for (const video of meta.videos ?? []) add(video.season);
  return out;
}

export function useMetadataSourceValues({
  authKey,
  meta,
  detail,
  settings,
}: {
  authKey: string | null;
  meta: Meta;
  detail: TmdbDetail | null;
  settings: Settings;
}): MetadataSourceValues {
  const identityKey = JSON.stringify([
    authKey,
    meta.id,
    meta.type,
    meta.name,
    detail?.id,
    detail?.kind,
    detail?.tmdbTvId,
    detail?.tvdbTvId,
    settings.addonOnlyMetadata,
    settings.fanartKey,
    settings.mdblistKey,
    settings.metadataSources,
    settings.omdbKey,
    settings.posterBaseUrl,
    settings.rpdbKey,
    settings.tmdbKey,
    settings.tvdbKey,
  ]);
  const [state, setState] = useState<ScopedValues>({ key: "", values: {} });
  const values = state.key === identityKey ? state.values : {};

  useEffect(() => {
    const key = identityKey;
    setState({ key, values: {} });
    if (!settings.addonOnlyMetadata) return;
    let cancelled = false;
    let current: MetadataSourceValues = {};
    const publish = (patch: MetadataSourceValues) => {
      if (cancelled) return;
      current = {
        ...current,
        ...patch,
        sourceNames: { ...current.sourceNames, ...patch.sourceNames },
      };
      setState({ key, values: current });
    };

    void (async () => {
      const addonList = await metadataAddons(authKey, []).catch(() => []);
      const chain = (section: MetadataSourceSection) =>
        normalizeMetadataSourceChain(
          section,
          settings.metadataSources?.[section],
          addonList,
          settings,
        );
      const chains: Partial<Record<MetadataSourceSection, string[]>> = {
        title: chain("title"),
        description: chain("description"),
        poster: chain("poster"),
        seasonPoster: chain("seasonPoster"),
        backdrop: chain("backdrop"),
        logo: chain("logo"),
        seasonSynopsis: chain("seasonSynopsis"),
        cast: chain("cast"),
        trailers: chain("trailers"),
        ratings: chain("ratings"),
        episodes: chain("episodes"),
      };
      publish({ chains });
      const titleChain = chains.title ?? [];
      const descriptionChain = chains.description ?? [];
      const posterChain = chains.poster ?? [];
      const seasonPosterChain = chains.seasonPoster ?? [];
      const backdropChain = chains.backdrop ?? [];
      const logoChain = chains.logo ?? [];
      const seasonSynopsisChain = chains.seasonSynopsis ?? [];
      const castChain = chains.cast ?? [];
      const trailerChain = chains.trailers ?? [];
      const ratingChain = chains.ratings ?? [];
      const ids = [
        ...new Set([
          ...titleChain,
          ...descriptionChain,
          ...posterChain,
          ...seasonPosterChain,
          ...backdropChain,
          ...logoChain,
          ...seasonSynopsisChain,
          ...castChain,
          ...trailerChain,
          ...(chains.ratings ?? []),
        ]),
      ];
      if (cancelled) return;
      if (ids.length === 0) return;

      const baseMeta = { id: meta.id, type: meta.type, name: meta.name };
      const tmdbLookup =
        detail?.kind === "tv" && detail.tmdbTvId
          ? { ...baseMeta, id: `tmdb:tv:${detail.tmdbTvId}` }
          : detail?.kind === "movie" && detail.id > 0
            ? { ...baseMeta, id: `tmdb:movie:${detail.id}` }
            : baseMeta;
      const load = async (id: string): Promise<Loaded> => {
        const addonKey = addonKeyFromSource(id);
        if (addonKey) {
          const found = await resolveAddonMetaSource(
            authKey,
            meta.type === "movie" ? "movie" : "series",
            meta.id,
            addonKey,
          ).catch(() => null);
          return {
            title: found?.name,
            description: found?.description,
            poster: found?.poster,
            backdrop: found?.background,
            logo: found?.logo,
            seasonPosters: addonSeasonPosters(found),
            seasonOverviews: addonSeasonOverviews(found),
            cast: found ? addonCast(found) : undefined,
            trailerCandidates: found?.trailerStreams
              ?.map((trailer) => trailer.ytId)
              .filter((id): id is string => !!id),
            rating: found?.imdbRating,
            sourceName: found?.addonOrigin?.name ?? "Addon",
          };
        }
        if (id === "tmdb" && settings.tmdbKey) {
          const found = await tmdbDetails(settings.tmdbKey, tmdbLookup).catch(() => null);
          return {
            title: found?.title,
            description: found?.overview,
            poster: found?.poster,
            backdrop: found?.backdrop,
            logo: found?.logo,
            seasonPosters: found?.seasonPosters,
            cast: found?.cast,
            trailerCandidates: found?.trailerCandidates,
            rating: found?.rating,
            sourceName: "TMDB",
          };
        }
        if (id === "fanart" && settings.fanartKey) {
          const art =
            detail?.kind === "movie" && detail.id > 0
              ? await fanartMovie(settings.fanartKey, detail.id).catch(() => null)
              : detail?.tvdbTvId
                ? await fanartTv(settings.fanartKey, detail.tvdbTvId).catch(() => null)
                : null;
          return {
            poster: art?.poster,
            backdrop: art?.backdrop,
            logo: art?.logo,
            seasonPosters: art?.seasonPosters,
            sourceName: "Fanart.tv",
          };
        }
        return {};
      };

      const byId = new Map<string, Loaded>();
      const loadOnce = async (id: string): Promise<Loaded> => {
        const hit = byId.get(id);
        if (hit) return hit;
        const value = await load(id);
        if (cancelled) return {};
        byId.set(id, value);
        return value;
      };
      const firstEntry = async (sourceChain: string[], field: keyof Loaded) => {
        for (let index = 0; index < sourceChain.length; index += 1) {
          const source = await loadOnce(sourceChain[index]);
          if (cancelled) return undefined;
          const value = source[field];
          if (typeof value === "string" && value.trim()) {
            return { value, index, sourceName: source.sourceName };
          }
        }
        return undefined;
      };
      const mediaType = meta.type === "movie" ? "movie" : "series";
      const altId = detail?.id
        ? `tmdb:${detail.kind === "tv" ? "tv:" : "movie:"}${detail.id}`
        : undefined;
      const firstTransform = (sourceChain: string[]) =>
        sourceChain.findIndex((id) => id === "rpdb" || id === "posterService");

      const posterEntry = await firstEntry(posterChain, "poster");
      let poster = posterEntry?.value;
      const posterTransform = firstTransform(posterChain);
      if (poster && posterEntry && posterTransform >= 0 && posterTransform < posterEntry.index) {
        poster = rpdbPoster(
          settings.rpdbKey,
          meta.id,
          poster,
          altId,
          settings.posterBaseUrl,
          mediaType,
        );
      }
      publish({
        poster,
        sourceNames: { poster: posterEntry?.sourceName },
      });

      const backdropEntry = await firstEntry(backdropChain, "backdrop");
      let backdrop = backdropEntry?.value;
      const backdropTransform = firstTransform(backdropChain);
      if (
        backdrop &&
        backdropEntry &&
        backdropTransform >= 0 &&
        backdropTransform < backdropEntry.index
      ) {
        backdrop = rpdbBackdrop(
          settings.rpdbKey,
          meta.id,
          backdrop,
          altId,
          settings.posterBaseUrl,
          mediaType,
        );
      }
      publish({
        backdrop,
        sourceNames: { backdrop: backdropEntry?.sourceName },
      });

      const titleEntry = await firstEntry(titleChain, "title");
      publish({ title: titleEntry?.value, sourceNames: { title: titleEntry?.sourceName } });

      const descriptionEntry = await firstEntry(descriptionChain, "description");
      publish({
        description: descriptionEntry?.value,
        sourceNames: { description: descriptionEntry?.sourceName },
      });

      const logoEntry = await firstEntry(logoChain, "logo");
      publish({ logo: logoEntry?.value, sourceNames: { logo: logoEntry?.sourceName } });

      const firstArray = async <T>(sourceChain: string[], field: "cast" | "trailerCandidates") => {
        for (const id of sourceChain) {
          const source = await loadOnce(id);
          if (cancelled) return undefined;
          const value = source[field] as T[] | undefined;
          if (Array.isArray(value) && value.length > 0) {
            return { value, sourceName: source.sourceName };
          }
        }
        return undefined;
      };
      const castEntry = await firstArray<CastEntry>(castChain, "cast");
      publish({ cast: castEntry?.value, sourceNames: { cast: castEntry?.sourceName } });

      const trailerEntry = await firstArray<string>(trailerChain, "trailerCandidates");
      publish({
        trailerCandidates: trailerEntry?.value,
        sourceNames: { trailers: trailerEntry?.sourceName },
      });

      const sourceRatings: Record<string, string> = {};
      for (const id of ratingChain) {
        const source = await loadOnce(id);
        if (cancelled) return;
        if (source.rating?.trim()) sourceRatings[id] = source.rating;
      }
      publish({
        sourceRatings: Object.keys(sourceRatings).length > 0 ? sourceRatings : undefined,
      });

      const expectedSeasons = expectedSeasonNumbers(meta, detail);
      const seasonPosters: Record<number, string> = {};
      const seasonPosterNames = new Set<string>();
      for (const id of seasonPosterChain) {
        const source = await loadOnce(id);
        if (cancelled) return;
        for (const [season, url] of Object.entries(source.seasonPosters ?? {})) {
          const number = Number(season);
          if (Number.isInteger(number) && seasonPosters[number] == null) {
            seasonPosters[number] = url;
            if (source.sourceName) seasonPosterNames.add(source.sourceName);
          }
        }
        publish({
          seasonPosters: Object.keys(seasonPosters).length > 0 ? { ...seasonPosters } : undefined,
          sourceNames: {
            seasonPosters:
              seasonPosterNames.size > 0 ? [...seasonPosterNames].join(" + ") : undefined,
          },
        });
        if (
          expectedSeasons.size > 0 &&
          [...expectedSeasons].every((season) => seasonPosters[season] != null)
        ) {
          break;
        }
      }

      const seasonOverviewsBySource: Record<string, SeasonOverviewSource> = {};
      for (const id of seasonSynopsisChain) {
        if (!id.startsWith("addon:")) continue;
        const source = await loadOnce(id);
        if (cancelled) return;
        if (source.seasonOverviews) {
          seasonOverviewsBySource[id] = {
            sourceName: source.sourceName,
            overviews: source.seasonOverviews,
          };
          publish({ seasonOverviewsBySource: { ...seasonOverviewsBySource } });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    detail?.id,
    detail?.kind,
    detail?.tmdbTvId,
    detail?.tvdbTvId,
    authKey,
    identityKey,
    meta.id,
    meta.name,
    meta.type,
    settings.addonOnlyMetadata,
    settings.fanartKey,
    settings.mdblistKey,
    settings.metadataSources,
    settings.omdbKey,
    settings.posterBaseUrl,
    settings.rpdbKey,
    settings.tmdbKey,
    settings.tvdbKey,
  ]);

  return values;
}
