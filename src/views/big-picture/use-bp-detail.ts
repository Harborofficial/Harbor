import { useEffect, useMemo, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import {
  useMetadataSourceValues,
  type MetadataSourceValues,
} from "@/hooks/use-metadata-source-values";
import { peekBpEnrich } from "./use-bp-enrich";
import { resolveMeta } from "@/lib/meta-resource";
import { tmdbDetails, type TmdbDetail } from "@/lib/providers/tmdb/tmdb-details";
import { cinemetaDetails } from "@/lib/providers/cinemeta-details";
import { tmdbCollection } from "@/lib/providers/tmdb/tmdb-collection";
import { tmdbWatchProviders, type WatchProvider } from "@/lib/providers/tmdb/tmdb-watch";
import { readBpMeta } from "./bp-focus-meta";
import { parseBpMetaId as parseId } from "./bp-logic";

export { parseBpMetaId } from "./bp-logic";

const NO_PROVIDERS: WatchProvider[] = [];

function sourceOnlyDetail(meta: Meta): TmdbDetail {
  const imdbId = meta.id.startsWith("tt") ? meta.id.split(":")[0] : null;
  return {
    kind: meta.type === "series" || meta.type === "anime" ? "tv" : "movie",
    id: 0,
    imdbId,
    title: meta.name,
    originalTitle: meta.name,
    tagline: "",
    overview: meta.description ?? "",
    poster: meta.poster,
    backdrop: meta.background,
    logo: meta.logo,
    year: meta.releaseInfo,
    voteCount: 0,
    status: "",
    genres: meta.genres ?? [],
    originalLanguage: meta.originalLanguage ?? "",
    spokenLanguages: [],
    productionCountries: [],
    productionCompanies: [],
    networks: [],
    productionCompaniesRich: [],
    productionCountriesRich: [],
    spokenLanguagesRich: [],
    networksRich: [],
    trailerYtId: null,
    trailerCandidates: [],
    extraVideos: [],
    gallery: { backdrops: [], posters: [], logos: [] },
    cast: [],
    crew: [],
    directors: [],
    writers: [],
    creators: [],
    producers: [],
    composer: [],
    cinematography: [],
    editor: [],
    recommendations: [],
    similar: [],
    seasons: [],
    numberOfSeasons: 0,
    numberOfEpisodes: 0,
    keywords: [],
  };
}

export type BpDetailData = {
  meta: Meta | null;
  detail: TmdbDetail | null;
  collection: { name: string; parts: Meta[] } | null;
  providers: WatchProvider[];
  loading: boolean;
  chains?: MetadataSourceValues["chains"];
  sourceRatings?: MetadataSourceValues["sourceRatings"];
};

export function useBpDetail(metaId: string): BpDetailData {
  const { authKey } = useAuth();
  const { settings } = useSettings();
  const prioritizeAddons = settings.addonOnlyMetadata || settings.preferCustomMetaAddon;
  const { type, id } = parseId(metaId);
  const seed = readBpMeta();
  const [meta, setMeta] = useState<Meta | null>(seed?.id === id ? seed : null);
  // Seeded from the dwell prefetch the spotlight already ran for this card, so
  // the page opens with its cast, ratings and tagline on it rather than filling
  // them in once the duplicate request comes back. A miss is null, which is
  // exactly what this used to start as.
  const [detail, setDetail] = useState<TmdbDetail | null>(() =>
    prioritizeAddons ? null : peekBpEnrich(id),
  );
  const [collection, setCollection] = useState<{ name: string; parts: Meta[] } | null>(null);
  const [providers, setProviders] = useState<WatchProvider[]>(NO_PROVIDERS);
  const [loading, setLoading] = useState(true);
  const sourceMeta = meta ?? { id, type, name: "" };
  const sourceValues = useMetadataSourceValues({
    authKey,
    meta: sourceMeta,
    detail,
    settings,
  });
  const displayDetail = useMemo(() => {
    const hasSource =
      !!sourceValues.title ||
      !!sourceValues.description ||
      !!sourceValues.poster ||
      !!sourceValues.backdrop ||
      !!sourceValues.logo ||
      !!sourceValues.cast?.length ||
      !!sourceValues.trailerCandidates?.length ||
      !!sourceValues.seasonPosters;
    if (!detail && !hasSource) return null;
    const base = detail ?? sourceOnlyDetail(sourceMeta);
    return {
      ...base,
      title: sourceValues.title ?? base.title,
      overview: sourceValues.description ?? base.overview,
      poster: sourceValues.poster ?? base.poster,
      backdrop: sourceValues.backdrop ?? base.backdrop,
      logo: sourceValues.logo ?? base.logo,
      seasonPosters: sourceValues.seasonPosters ?? base.seasonPosters,
      cast: sourceValues.cast ?? base.cast,
      trailerCandidates: sourceValues.trailerCandidates ?? base.trailerCandidates,
      trailerYtId: sourceValues.trailerCandidates?.[0] ?? base.trailerYtId,
    };
  }, [detail, sourceMeta, sourceValues]);
  const displayMeta = useMemo(
    () =>
      meta ??
      (displayDetail
        ? {
            id: displayDetail.imdbId ?? id,
            type,
            name: displayDetail.title,
            description: displayDetail.overview,
            poster: displayDetail.poster,
            background: displayDetail.backdrop,
            logo: displayDetail.logo,
            releaseInfo: displayDetail.year,
            imdbRating: displayDetail.rating,
            genres: displayDetail.genres,
          }
        : null),
    [meta, displayDetail, id, type],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setDetail(prioritizeAddons ? null : peekBpEnrich(id));
    setCollection(null);
    setProviders(NO_PROVIDERS);

    const base = readBpMeta();
    const start: Meta = base?.id === id ? base : { id, type, name: "" };
    if (base?.id === id) setMeta(base);

    (async () => {
      const fullP = resolveMeta(authKey, type, id, {
        preferAddons: prioritizeAddons,
        requireVideos: type === "series",
      }).catch(() => null);
      const richP = (
        prioritizeAddons ? cinemetaDetails(start) : tmdbDetails(settings.tmdbKey, start)
      ).catch(() => null);
      void fullP.then((m) => {
        if (alive && m) setMeta((prev) => ({ ...(prev ?? start), ...m }));
      });
      void richP.then((d) => {
        if (alive && d) setDetail(d);
      });
      const [full, rich] = await Promise.all([fullP, richP]);
      if (!alive) return;
      setLoading(false);

      // Availability needs the TMDB numeric id, so it cannot join the pair
      // above. It is never awaited either: art beats text on arrival and a
      // provider list must not sit in front of the episode backfill.
      if (rich && !prioritizeAddons) {
        void tmdbWatchProviders(settings.tmdbKey, rich.kind, rich.id, settings.region)
          .then((list) => {
            if (alive && list.length > 0) setProviders(list);
          })
          .catch(() => {});
      }

      const needsEpisodes = type === "series" && (full?.videos?.length ?? 0) === 0;
      const imdbId = rich?.imdbId;
      if (needsEpisodes && imdbId && imdbId !== id) {
        const viaImdb = await resolveMeta(authKey, type, imdbId).catch(() => null);
        if (!alive) return;
        if (viaImdb?.videos?.length) {
          setMeta((prev) => ({ ...(prev ?? start), videos: viaImdb.videos }));
        }
      }

      const collectionId = rich?.collection?.id;
      if (!collectionId) return;
      const franchise = await tmdbCollection(settings.tmdbKey, collectionId).catch(() => null);
      if (!alive || !franchise || franchise.parts.length < 2) return;
      setCollection({ name: franchise.name, parts: franchise.parts });
    })();

    return () => {
      alive = false;
    };
  }, [
    metaId,
    authKey,
    settings.tmdbKey,
    settings.region,
    prioritizeAddons,
    settings.metadataAddonOrder,
    settings.metadataSources,
  ]);

  return {
    meta: displayMeta,
    detail: displayDetail,
    collection,
    providers,
    loading,
    chains: sourceValues.chains,
    sourceRatings: sourceValues.sourceRatings,
  };
}
