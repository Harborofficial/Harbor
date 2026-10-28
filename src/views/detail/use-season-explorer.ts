import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { kitsuToTvdb } from "@/lib/providers/anime-mapping";
import { parseKitsuId } from "@/lib/providers/kitsu";
import { isGenericSeasonName } from "@/lib/season-name";
import { episodeLanguageBase } from "@/lib/episode-text-language";
import {
  fetchTmdbSeasonSynopsis,
  selectSeasonSynopsis,
  type SeasonSynopsis,
} from "@/lib/providers/season-synopsis";
import {
  fetchTmdbSeasonPoster,
  resolveSeasonArtworkTmdbId,
} from "@/lib/providers/tmdb-season-artwork";
import type { PickerItem } from "./series-episodes/season-arc-picker";
import {
  isDisplayableName,
  tvdbSeasonNames,
  tvdbSeasons,
  tvdbSeriesByRemote,
  tvdbLangFromIso1,
  type TvdbSeasonInfo,
} from "@/lib/providers/tvdb";
import {
  createSeasonArtworkLoader,
  fetchTvdbSeasonDetails,
  type TvdbSeasonArtwork,
  type TvdbSeasonDetails,
} from "@/lib/providers/tvdb-season-details";

const EMPTY_SEASONS = new Map<number, TvdbSeasonInfo>();
const EMPTY_NAMES = new Map<number, string>();
const EMPTY_DETAILS = new Map<number, TvdbSeasonDetails>();
const EMPTY_ARTWORK = new Map<number, TvdbSeasonArtwork>();
const EMPTY_VISIBLE: number[] = [];

export type SeasonExplorerOptions = {
  metaId: string;
  imdbId?: string | null;
  tvdbKey: string;
  tmdbKey?: string;
  tmdbTvId?: number | null;
  seasonPosters?: Record<number, string>;
  titlePoster?: string;
  seasonType: string;
  lang: string;
  activeSeason?: number;
  fallbackSynopsis?: SeasonSynopsis;
  enabled?: boolean;
  /** Harbor's proxy is only allowed for anime. Regular titles need their own key. */
  allowProxy?: boolean;
};

export type SeasonExplorerArtworkConfig = SeasonExplorerOptions & {
  scope: string;
  seasons: Map<number, TvdbSeasonInfo>;
  catalogReady: boolean;
  catalogAllowed: boolean;
  resolveTmdbId: () => Promise<number | null>;
};

export function useSeasonExplorer({
  metaId,
  imdbId,
  tvdbKey,
  tmdbKey = "",
  tmdbTvId,
  seasonPosters,
  titlePoster,
  seasonType,
  lang,
  activeSeason,
  fallbackSynopsis,
  enabled = true,
  allowProxy = false,
}: SeasonExplorerOptions) {
  const scope = JSON.stringify([metaId, imdbId, tvdbKey, seasonType, lang, enabled, allowProxy]);
  const textScope = JSON.stringify([scope, tmdbKey, tmdbTvId]);
  const fallbackKey = JSON.stringify([
    fallbackSynopsis?.overview,
    fallbackSynopsis?.overviewLanguage,
  ]);
  const tvdbLang = tvdbLangFromIso1(episodeLanguageBase(lang));
  const resolveTmdbId = useMemo(() => {
    let request: Promise<number | null> | undefined;
    let expires = 0;
    return () => {
      if (!request || expires <= Date.now()) {
        expires = Date.now() + 60_000;
        request = resolveSeasonArtworkTmdbId(tmdbKey, metaId, imdbId, tmdbTvId)
          .catch(() => null)
          .then((id) => {
            expires = Date.now() + (id == null ? 60_000 : 10 * 60_000);
            return id;
          });
      }
      return request;
    };
  }, [tmdbKey, metaId, imdbId, tmdbTvId]);
  // TVDB catalogs and season text may use the proxy only where allowed. TMDB
  // artwork and synopses are independent: a personal TMDB key can supply them
  // even when no TVDB key is configured.
  const catalogAllowed = enabled && (!!tvdbKey.trim() || allowProxy);
  const [catalog, setCatalog] = useState<{
    scope: string;
    seasons: Map<number, TvdbSeasonInfo>;
    names: Map<number, string>;
  }>();
  const [enriched, setEnriched] = useState<{
    scope: string;
    details: Map<number, TvdbSeasonDetails>;
    expires: Map<number, number>;
    inputs: Map<number, string>;
  }>();
  const [pending, setPending] = useState<{ scope: string; season: number } | null>(null);
  const seasons = catalog?.scope === scope ? catalog.seasons : EMPTY_SEASONS;
  const names = catalog?.scope === scope ? catalog.names : EMPTY_NAMES;
  const details = enriched?.scope === textScope ? enriched.details : EMPTY_DETAILS;
  const catalogReady = catalog?.scope === scope;

  useEffect(() => {
    if (!catalogAllowed) return;
    let cancelled = false;
    void (async () => {
      const kitsuId = parseKitsuId(metaId);
      let seriesId = Number(/^tvdb:(\d+)$/.exec(metaId)?.[1]) || null;
      if (seriesId == null && kitsuId != null)
        seriesId = await kitsuToTvdb(kitsuId).catch(() => null);
      const remoteId = imdbId?.startsWith("tt")
        ? imdbId
        : metaId.startsWith("tt")
          ? metaId
          : /^tmdb:tv:(\d+)$/.exec(metaId)?.[1];
      if (seriesId == null && remoteId)
        seriesId = await tvdbSeriesByRemote(tvdbKey, remoteId).catch(() => null);
      if (cancelled) return;
      const infos =
        seriesId == null
          ? EMPTY_SEASONS
          : await tvdbSeasons(tvdbKey, seriesId, seasonType, tvdbLang).catch(() => EMPTY_SEASONS);
      if (cancelled) return;
      setCatalog({ scope, seasons: infos, names: EMPTY_NAMES });
      const englishNames =
        seriesId == null
          ? EMPTY_NAMES
          : await tvdbSeasonNames(tvdbKey, seriesId, seasonType, tvdbLang).catch(() => EMPTY_NAMES);
      if (!cancelled) setCatalog({ scope, seasons: infos, names: englishNames });
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, metaId, imdbId, tvdbKey, seasonType, tvdbLang, catalogAllowed]);

  useEffect(() => {
    const season = activeSeason == null ? undefined : seasons.get(activeSeason);
    if (!enabled || activeSeason == null || activeSeason < 0 || (catalogAllowed && !catalogReady))
      return;
    if (
      details.has(activeSeason) &&
      enriched?.inputs.get(activeSeason) === fallbackKey &&
      (enriched.expires.get(activeSeason) ?? 0) > Date.now()
    )
      return;
    let cancelled = false;
    const number = activeSeason;
    const tmdbAllowed = !!tmdbKey.trim() && (seasonType === "official" || seasonType === "aired");
    if (!season && !tmdbAllowed && !fallbackSynopsis?.overview) return;
    setPending({ scope: textScope, season: number });
    void (async () => {
      const tvdb =
        season && catalogAllowed
          ? await fetchTvdbSeasonDetails(tvdbKey, season, lang).catch(() => null)
          : undefined;
      if (cancelled) return;
      let tmdb: SeasonSynopsis | null | undefined;
      if (tmdbAllowed && !(tvdb?.overview && tvdb.overviewLanguage === episodeLanguageBase(lang))) {
        const id = await resolveTmdbId();
        if (cancelled) return;
        tmdb = id == null ? null : await fetchTmdbSeasonSynopsis(tmdbKey, id, number, lang);
      }
      const synopsis = selectSeasonSynopsis(lang, tvdb, tmdb, fallbackSynopsis);
      const failed = tvdb === null || tmdb === null;
      const detail =
        failed && !synopsis.overview && !tvdb?.name ? null : { name: tvdb?.name, ...synopsis };
      return { detail, failed };
    })()
      .catch(() => ({ detail: null, failed: true }))
      .then((result) => {
        if (cancelled || !result) return;
        const { detail, failed } = result;
        if (detail) {
          setEnriched((previous) => {
            const next = new Map(previous?.scope === textScope ? previous.details : EMPTY_DETAILS);
            const expires = new Map(previous?.scope === textScope ? previous.expires : []);
            const inputs = new Map(previous?.scope === textScope ? previous.inputs : []);
            next.set(number, detail);
            inputs.set(number, fallbackKey);
            expires.set(number, Date.now() + (failed ? 60_000 : 10 * 60_000));
            return { scope: textScope, details: next, expires, inputs };
          });
        }
        setPending(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    textScope,
    seasons,
    activeSeason,
    tvdbKey,
    tmdbKey,
    tmdbTvId,
    metaId,
    imdbId,
    seasonType,
    lang,
    enabled,
    catalogAllowed,
    catalogReady,
    details,
    enriched,
    resolveTmdbId,
    fallbackKey,
  ]);

  const artworkConfig = useMemo<SeasonExplorerArtworkConfig>(
    () => ({
      scope,
      seasons,
      catalogReady,
      catalogAllowed,
      metaId,
      imdbId,
      tvdbKey,
      tmdbKey,
      tmdbTvId,
      seasonPosters,
      titlePoster,
      seasonType,
      lang,
      activeSeason,
      enabled,
      resolveTmdbId,
    }),
    [
      scope,
      seasons,
      catalogReady,
      catalogAllowed,
      metaId,
      imdbId,
      tvdbKey,
      tmdbKey,
      tmdbTvId,
      seasonPosters,
      titlePoster,
      seasonType,
      lang,
      activeSeason,
      enabled,
      resolveTmdbId,
    ],
  );
  return {
    seasons,
    names,
    details,
    artworkConfig,
    loading: pending?.scope === textScope && pending.season === activeSeason,
  };
}

/** Artwork and rail visibility belong to the explorer, never the episode page. */
export function useSeasonExplorerArtwork({
  artworkConfig,
}: {
  artworkConfig: SeasonExplorerArtworkConfig;
}) {
  const {
    scope,
    seasons,
    catalogReady,
    catalogAllowed,
    metaId,
    imdbId,
    tvdbKey,
    tmdbKey = "",
    tmdbTvId,
    seasonPosters,
    titlePoster,
    seasonType,
    lang,
    activeSeason,
    enabled = true,
    resolveTmdbId,
  } = artworkConfig;
  const artworkAllowed = enabled && (catalogAllowed || !!tmdbKey.trim());
  // Without a catalog source there is nothing to wait for; TMDB numbers are
  // the only mapping available.
  const artworkWithoutCatalog = artworkAllowed && !catalogAllowed;
  const posterKey = JSON.stringify(seasonPosters ?? {});
  const artworkScope = JSON.stringify([
    scope,
    tmdbKey,
    tmdbTvId,
    posterKey,
    titlePoster,
    artworkAllowed,
  ]);
  const [artworkState, setArtworkState] = useState<{
    scope: string;
    artwork: Map<number, TvdbSeasonArtwork>;
  }>();
  const [visible, setVisible] = useState<{ scope: string; seasons: number[] }>();
  const artworkLoader = useRef<{
    scope: string;
    loader: ReturnType<typeof createSeasonArtworkLoader>;
  } | null>(null);
  const artwork = artworkState?.scope === artworkScope ? artworkState.artwork : EMPTY_ARTWORK;
  const onPosterError = useCallback(
    (number: number, url: string) => {
      const current = artworkLoader.current;
      if (current?.scope === artworkScope) current.loader.reject(number, url);
    },
    [artworkScope],
  );
  const setVisibleSeasons = useCallback(
    (numbers: number[]) => {
      const next = [...new Set(numbers.filter((n) => n >= 0))].sort((a, b) => a - b);
      setVisible((previous) =>
        previous?.scope === scope &&
        previous.seasons.length === next.length &&
        previous.seasons.every((n, i) => n === next[i])
          ? previous
          : { scope, seasons: next },
      );
    },
    [scope],
  );
  useEffect(() => {
    if (!artworkAllowed) return;
    const posters = JSON.parse(posterKey) as Record<number, string>;
    let tmdbIdRequest: Promise<number | null> | undefined;
    const loader = createSeasonArtworkLoader(
      tvdbKey,
      lang,
      (number, value) => {
        setArtworkState((previous) => {
          const next = new Map(previous?.scope === artworkScope ? previous.artwork : EMPTY_ARTWORK);
          next.set(number, value);
          return { scope: artworkScope, artwork: next };
        });
      },
      {
        titlePoster,
        loadFallback: async (number, rejected, signal) => {
          // Other order types need an explicit season mapping before borrowing TMDB art.
          if (seasonType !== "official" && seasonType !== "aired") return undefined;
          const cached = posters[number];
          if (cached && !rejected.has(cached)) return cached;
          if (!tmdbKey) return undefined;
          tmdbIdRequest ??= resolveTmdbId();
          const id = await tmdbIdRequest;
          if (signal.aborted) return undefined;
          return id == null
            ? undefined
            : fetchTmdbSeasonPoster(tmdbKey, id, number, lang, rejected);
        },
      },
    );
    artworkLoader.current = { scope: artworkScope, loader };
    return () => {
      loader.dispose();
      artworkLoader.current = null;
    };
  }, [
    artworkScope,
    seasons,
    tvdbKey,
    tmdbKey,
    tmdbTvId,
    posterKey,
    titlePoster,
    metaId,
    imdbId,
    seasonType,
    lang,
    artworkAllowed,
    resolveTmdbId,
  ]);

  useEffect(() => {
    // A keyed/proxy catalog must settle first; only the TMDB-only path has no
    // catalog to wait for.
    if (!catalogReady && !artworkWithoutCatalog) return;
    const numbers = new Set(visible?.scope === scope ? visible.seasons : []);
    if (activeSeason != null && activeSeason >= 0) numbers.add(activeSeason);
    const requested = [...numbers].map(
      (n): TvdbSeasonInfo => seasons.get(n) ?? { id: null, number: n, name: `Season ${n}` },
    );
    artworkLoader.current?.loader.request(requested, activeSeason);
  }, [scope, artworkScope, catalogReady, artworkWithoutCatalog, seasons, visible, activeSeason]);

  return {
    artwork,
    setVisibleSeasons,
    onPosterError,
    visibleSeasons: visible?.scope === scope ? visible.seasons : EMPTY_VISIBLE,
  };
}

export function englishSeasonItems(
  items: PickerItem[],
  names: ReadonlyMap<number, string>,
  details: ReadonlyMap<number, TvdbSeasonDetails>,
): PickerItem[] {
  return items.map((item) => {
    const n = item.seasonNumber;
    if (n == null || n < 0) return item;
    const sourceName = item.nameLanguage === "en" ? item.name.trim() : undefined;
    const candidates = [item.fallbackName, details.get(n)?.name, names.get(n), sourceName].filter(
      (candidate): candidate is string => !!candidate && isDisplayableName(candidate),
    );
    // A provider's generic English fallback ("Season 4") must not replace a
    // real English title from TMDB or the order data.
    const preferred = candidates.find((candidate) => !isGenericSeasonName(candidate, n));
    const name = preferred ?? candidates[0] ?? (n === 0 ? "Specials" : `Season ${n}`);
    return {
      ...item,
      name,
      nameLanguage: "en",
      isGenericName: n === 0 ? name === "Specials" : isGenericSeasonName(name, n),
    };
  });
}

export function useSeasonExplorerView({
  items,
  activeKey,
  ...options
}: Omit<Parameters<typeof useSeasonExplorer>[0], "activeSeason" | "lang"> & {
  items: PickerItem[];
  activeKey: string;
  lang: string;
}) {
  const data = useSeasonExplorer({
    ...options,
    activeSeason: items.find((item) => item.key === activeKey)?.seasonNumber,
    fallbackSynopsis: items.find((item) => item.key === activeKey),
  });
  const displayItems = useMemo(
    () => (options.enabled === false ? items : englishSeasonItems(items, data.names, data.details)),
    [items, data.names, data.details, options.enabled],
  );
  return { ...data, items: displayItems };
}
