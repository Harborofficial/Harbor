import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import type { KitsuEpisode } from "@/lib/providers/kitsu";
import { kitsuToTvdb } from "@/lib/providers/anime-mapping";
import { isFranchiseExtra, type FranchiseEntry } from "@/lib/providers/anime-detail";
import { isForeignScriptTitle } from "@/lib/providers/anime-episode-build";
import {
  defaultOrderLabel,
  tvdbLangFromIso1,
  tvdbOrderTypeHasEpisodes,
  tvdbSeasonTypes,
  tvdbSeriesByRemote,
  type TvdbOrderType,
  type TvdbSeasonTypeOption,
} from "@/lib/providers/tvdb";
import { tmdbLanguageIso } from "@/lib/providers/tmdb/tmdb-client";
import { pickPreferredEpisodeOverview, pickPreferredEpisodeTitle } from "@/lib/localized-text";
import { isUpcomingDate } from "@/lib/dates";
import { harborImdbEpisodesCached } from "@/lib/providers/harbor-imdb";
import {
  fetchTvdbOrderBySeriesId,
  waitForTvdbSeasonNames,
  seasonDateRange,
  type TvdbOrder,
} from "@/lib/providers/tvdb-order";
import { foreignAnimeProviderSeasons } from "@/lib/streams/anime-identity";
import { resolveAnimeSlotMatch } from "./anime-slot-match";
import type { PickerItem } from "../series-episodes/season-arc-picker";

export type AnimeTvdbPanel = {
  items: PickerItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  visibleEpisodes: KitsuEpisode[];
  orderTypes: TvdbSeasonTypeOption[];
  activeType: TvdbOrderType;
};

export type AnimeTvdbPanelState = {
  panel: AnimeTvdbPanel | null;
  active: boolean;
};

const normTitle = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

// A TVDB season binds to the franchise entry whose start date falls nearest to
// the season's first aired episode; distant starts are no match at all.
function entryStartingNear(franchise: FranchiseEntry[], from: string): FranchiseEntry | null {
  const t = Date.parse(from);
  if (!Number.isFinite(t)) return null;
  let best: FranchiseEntry | null = null;
  let bestDelta = Infinity;
  for (const f of franchise) {
    if (!f.startDate) continue;
    const st = Date.parse(f.startDate);
    if (!Number.isFinite(st)) continue;
    const d = Math.abs(st - t);
    if (d < bestDelta) {
      bestDelta = d;
      best = f;
    }
  }
  return best != null && bestDelta <= 60 * 86_400_000 ? best : null;
}

export function useAnimeTvdbPanel(
  kitsuId: number | null,
  imdbId: string | null,
  episodes: KitsuEpisode[],
  seasonType: string,
  tvdbKey: string,
  enabled: boolean,
  franchiseEpisodes?: KitsuEpisode[],
  preferredSeasonKey?: string,
  intentSeasonKey?: string,
  franchise?: FranchiseEntry[],
  metaId?: string | null,
): AnimeTvdbPanelState {
  const t = useT();
  const metadataLanguage = tmdbLanguageIso();
  const [seriesId, setSeriesId] = useState<number | null>(null);
  const [ordering, setOrdering] = useState<TvdbOrder | null>(null);
  const [orderTypes, setOrderTypes] = useState<TvdbSeasonTypeOption[]>([]);
  const [activeType, setActiveType] = useState<TvdbOrderType>("aired");
  const [sel, setSel] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [resolved, setResolved] = useState<"pending" | "has" | "none">("pending");

  useEffect(() => {
    setSel(null);
    setTouched(false);
  }, [kitsuId, imdbId]);

  const onSelect = useCallback((key: string) => {
    setSel(key);
    setTouched(true);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setSeriesId(null);
      setResolved("none");
      return;
    }
    setResolved("pending");
    let cancelled = false;
    void (async () => {
      let sid = kitsuId != null ? await kitsuToTvdb(kitsuId).catch(() => null) : null;
      if (sid == null && imdbId?.startsWith("tt")) {
        sid = await tvdbSeriesByRemote(tvdbKey, imdbId).catch(() => null);
      }
      if (cancelled) return;
      setSeriesId(sid);
      if (sid == null) setResolved("none");
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, tvdbKey, kitsuId, imdbId]);

  useEffect(() => {
    if (!enabled || seriesId == null) {
      setOrdering(null);
      setOrderTypes([]);
      return;
    }
    let cancelled = false;
    const lang = tvdbLangFromIso1(tmdbLanguageIso());
    const norm = (seasonType === "official" ? "aired" : seasonType) as TvdbOrderType;
    const started = typeof performance !== "undefined" ? performance.now() : 0;
    const requested = fetchTvdbOrderBySeriesId(tvdbKey, seriesId, norm, lang, true);
    // Discover the other order tabs concurrently; the selected order can render
    // while those optional availability checks are still in flight.
    const available = (async () => {
      const base = await tvdbSeasonTypes(tvdbKey, seriesId);
      const candidates = base.some((c) => c.value === "aired")
        ? base
        : [{ value: "aired" as const, label: "Aired Order" }, ...base];
      const checks = await Promise.all(
        candidates.map((c) => tvdbOrderTypeHasEpisodes(tvdbKey, seriesId, c.value)),
      );
      return candidates.filter((_, i) => checks[i]);
    })().catch(() => []);
    const publish = (type: TvdbOrderType, order: TvdbOrder) => {
      if (cancelled) return;
      if (typeof window !== "undefined")
        window.__harborProfiler?.mark("season-selector:metadata-ready", {
          elapsedMs: Math.round(performance.now() - started),
          seasons: order.seasons.length,
          order: type,
        });
      setActiveType(type);
      setOrdering(order);
      void waitForTvdbSeasonNames(order).then((named) => {
        if (!cancelled && named !== order) setOrdering(named);
      });
    };
    void (async () => {
      const preferred = await requested;
      if (cancelled) return;
      if (preferred) publish(norm, preferred);
      const nonEmpty = await available;
      if (cancelled) return;
      if (preferred) {
        // A failed availability probe must not hide an order already loaded.
        setOrderTypes(
          nonEmpty.some((c) => c.value === norm)
            ? nonEmpty
            : [...nonEmpty, { value: norm, label: defaultOrderLabel(norm) }],
        );
        return;
      }
      setOrderTypes(nonEmpty);
      if (nonEmpty.length === 0) {
        setOrdering(null);
        setResolved("none");
        return;
      }
      const effective = nonEmpty.some((c) => c.value === "aired") ? "aired" : nonEmpty[0].value;
      const fallback = await fetchTvdbOrderBySeriesId(tvdbKey, seriesId, effective, lang, true);
      if (cancelled) return;
      if (fallback) publish(effective, fallback);
      else {
        setOrdering(null);
        setResolved("none");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, tvdbKey, seriesId, seasonType, metadataLanguage]);

  const [foreignSeasons, setForeignSeasons] = useState<Set<number> | null>(null);
  useEffect(() => {
    let cancelled = false;
    // metaId first: tt-opened titles carry no kitsu id here.
    const identitySource = metaId?.trim() || (kitsuId != null ? `kitsu:${kitsuId}` : null);
    if (!identitySource) {
      setForeignSeasons(null);
      return;
    }
    void foreignAnimeProviderSeasons(identitySource, imdbId)
      .then((s) => {
        if (!cancelled) setForeignSeasons(s);
      })
      .catch(() => {
        if (!cancelled) setForeignSeasons(null);
      });
    return () => {
      cancelled = true;
    };
  }, [kitsuId, imdbId, metaId]);

  const extrasLabel = t("Extras");
  const built = useMemo(() => {
    if (!ordering) return null;
    const lang = metadataLanguage;
    const englishTarget = lang === "" || lang === "en";
    const pool = franchiseEpisodes ?? episodes;
    const franchiseWide = franchiseEpisodes != null;
    const byPair = new Map<string, KitsuEpisode>();
    const byAbs = new Map<number, KitsuEpisode>();
    const byTvdbId = new Map<number, KitsuEpisode>();
    const currentByPair = new Map<string, KitsuEpisode>();
    const currentByAbs = new Map<number, KitsuEpisode>();
    const currentByTvdbId = new Map<number, KitsuEpisode>();
    for (const ep of episodes) {
      const abs = ep.absoluteNumber ?? ep.number;
      if (abs != null && !currentByAbs.has(abs)) currentByAbs.set(abs, ep);
      if (ep.tvdbEpisodeId != null && !currentByTvdbId.has(ep.tvdbEpisodeId))
        currentByTvdbId.set(ep.tvdbEpisodeId, ep);
      if (ep.imdbSeason != null && ep.imdbSeason >= 1 && ep.imdbEpisode != null) {
        const key = `${ep.imdbSeason}:${ep.imdbEpisode}`;
        if (!currentByPair.has(key)) currentByPair.set(key, ep);
      }
    }
    for (const ep of pool) {
      const abs = franchiseWide ? ep.absoluteNumber : (ep.absoluteNumber ?? ep.number);
      if (abs != null && !byAbs.has(abs)) byAbs.set(abs, ep);
      if (ep.tvdbEpisodeId != null && !byTvdbId.has(ep.tvdbEpisodeId))
        byTvdbId.set(ep.tvdbEpisodeId, ep);
      if (ep.imdbSeason != null && ep.imdbSeason >= 0 && ep.imdbEpisode != null) {
        const k = `${ep.imdbSeason}:${ep.imdbEpisode}`;
        if (!byPair.has(k)) byPair.set(k, ep);
      }
    }
    const poolByEntryId = new Map<string, Map<number, KitsuEpisode>>();
    for (const p of pool) {
      if (p.number == null) continue;
      const entryId = p.sourceMetaId ?? metaId;
      if (!entryId) continue;
      let map = poolByEntryId.get(entryId);
      if (!map) {
        map = new Map();
        poolByEntryId.set(entryId, map);
      }
      if (!map.has(p.number)) map.set(p.number, p);
    }

    const extraEntries = franchise
      ? franchise.filter(isFranchiseExtra).map((f) => ({
          entry: f,
          norm: f.meta.name ? normTitle(f.meta.name) : "",
          time: f.startDate ? new Date(f.startDate).getTime() : NaN,
        }))
      : [];

    const items: PickerItem[] = [];
    const subset = new Map<string, KitsuEpisode[]>();
    const claimed = new Set<number>();
    const claimedExtras = new Set<string>();
    const imdbMap = imdbId ? harborImdbEpisodesCached(imdbId) : undefined;
    for (const s of ordering.seasons) {
      if (s.seasonNumber < 0) continue;
      if (foreignSeasons?.has(s.seasonNumber)) continue;
      const bucket = ordering.bySeason.get(s.seasonNumber) ?? [];
      if (bucket.length === 0) continue;
      const seenId = new Set<number>();
      const eps: KitsuEpisode[] = [];
      // TVDB rows for the season that is airing right now often lack air dates
      // and can lag the entry's own provider data, which poisons the upcoming
      // badge and the aired checks. Bind the season to the franchise entry
      // that started around the same week and let that entry's episode air
      // dates fill or correct the rows'.
      const seasonEntry =
        franchise && bucket.length > 0
          ? entryStartingNear(franchise, seasonDateRange(bucket).from ?? "")
          : null;
      const entryRowsByNumber = seasonEntry
        ? (poolByEntryId.get(seasonEntry.meta.id) ?? new Map())
        : new Map();
      const now = Date.now();
      const rowAir = bucket.map((e) => {
        const poolDate = entryRowsByNumber.get(e.episodeNumber)?.airdate ?? null;
        if (e.airDate && isUpcomingDate(e.airDate) && poolDate && !isUpcomingDate(poolDate)) {
          return poolDate;
        }
        return e.airDate ?? poolDate ?? null;
      });
      const rowTime = rowAir.map((a) => {
        const t = a ? Date.parse(a) : NaN;
        return Number.isFinite(t) ? t : null;
      });
      let airedFrontier = -1;
      rowTime.forEach((t, i) => {
        if (t != null && t <= now) airedFrontier = i;
      });
      const seasonOngoing = rowTime.some((t) => t != null && t > now);
      // Episodes after the last dated-aired row of an ongoing season have no
      // IMDb rating yet; a hit would be a mis-keyed rating from another
      // episode (TVDB often dates only the first rows of an unaired season).
      const rowUnaired = (i: number) => {
        const t = rowTime[i];
        return t != null ? t > now : seasonOngoing && airedFrontier >= 0 && i > airedFrontier;
      };
      for (const [bi, e] of bucket.entries()) {
        const abs = ordering.absByEpId.get(e.id);
        const img =
          e.stillUrl ?? e.stillPath ?? (abs != null ? ordering.imageByAbs.get(abs) : undefined);
        let match: KitsuEpisode | undefined;
        if (e.seasonNumber > 0) {
          match = resolveAnimeSlotMatch(
            e.seasonNumber,
            e.episodeNumber,
            e.id,
            abs ?? undefined,
            byTvdbId,
            byPair,
            byAbs,
            claimed,
          );
        }
        const currentMatch =
          currentByTvdbId.get(e.id) ??
          currentByPair.get(`${e.seasonNumber}:${e.episodeNumber}`) ??
          (abs != null ? currentByAbs.get(abs) : undefined);
        const title = pickPreferredEpisodeTitle(
          [
            {
              text: englishTarget && isForeignScriptTitle(e.name) ? undefined : e.name,
              language: e.nameLanguage,
            },
            {
              text: englishTarget && isForeignScriptTitle(e.nameEn) ? undefined : e.nameEn,
              language: e.nameEnLanguage,
            },
          ],
          [
            { text: match?.title, language: match?.titleLanguage },
            { text: currentMatch?.title, language: currentMatch?.titleLanguage },
          ],
          lang,
        );
        const synopsis = pickPreferredEpisodeOverview(
          [
            { text: e.overview, language: e.overviewLanguage },
            { text: e.overviewEn, language: e.overviewEnLanguage },
          ],
          [
            { text: match?.synopsis, language: match?.synopsisLanguage },
            { text: currentMatch?.synopsis, language: currentMatch?.synopsisLanguage },
          ],
          lang,
        );

        let streamId: string | undefined;
        if (!match && extraEntries.length > 0) {
          const epNorm = e.name ? normTitle(e.name) : "";
          let extra: FranchiseEntry | undefined;
          if (epNorm.length > 0) {
            const found = extraEntries.find(
              (x) => !claimedExtras.has(x.entry.meta.id) && x.norm === epNorm,
            );
            if (found) extra = found.entry;
          }
          if (!extra && e.airDate) {
            const epTime = new Date(e.airDate).getTime();
            if (!isNaN(epTime)) {
              const found = extraEntries.find(
                (x) =>
                  !claimedExtras.has(x.entry.meta.id) &&
                  !isNaN(x.time) &&
                  Math.abs(x.time - epTime) <= 86400000,
              );
              if (found) extra = found.entry;
            }
          }
          if (extra) {
            streamId = `${extra.meta.id}:1`;
            claimedExtras.add(extra.meta.id);
          }
        }

        const imdbRating = rowUnaired(bi)
          ? undefined
          : (imdbMap?.get(`${e.seasonNumber}:${e.episodeNumber}`) ??
            (abs != null ? imdbMap?.get(`1:${abs}`) : undefined));

        const ep: KitsuEpisode = match
          ? {
              ...match,
              thumbnail: !match.thumbnail && img ? img : match.thumbnail,
              ...(title != null ? { title } : {}),
              ...(synopsis != null ? { synopsis } : {}),
              titleLanguage:
                title === match.title
                  ? match.titleLanguage
                  : currentMatch && title === currentMatch.title
                    ? currentMatch.titleLanguage
                    : title === e.name
                      ? e.nameLanguage
                      : e.nameEnLanguage,
              synopsisLanguage:
                synopsis === match.synopsis
                  ? match.synopsisLanguage
                  : currentMatch && synopsis === currentMatch.synopsis
                    ? currentMatch.synopsisLanguage
                    : synopsis === e.overview
                      ? e.overviewLanguage
                      : e.overviewEnLanguage,
              ...(match.rating == null && imdbRating != null
                ? { rating: imdbRating, ratingIsImdb: true }
                : {}),
            }
          : {
              id: -e.id,
              number: e.episodeNumber,
              seasonNumber: e.seasonNumber,
              title: title ?? e.name,
              synopsis: synopsis ?? "",
              titleLanguage:
                currentMatch && title === currentMatch.title
                  ? currentMatch.titleLanguage
                  : title === e.name
                    ? e.nameLanguage
                    : e.nameEnLanguage,
              synopsisLanguage:
                currentMatch && synopsis === currentMatch.synopsis
                  ? currentMatch.synopsisLanguage
                  : synopsis === e.overview
                    ? e.overviewLanguage
                    : e.overviewEnLanguage,
              thumbnail: img ?? null,
              airdate: rowAir[bi] ?? null,
              length: e.runtime ?? null,
              imdbSeason: e.seasonNumber,
              imdbEpisode: e.episodeNumber,
              absoluteNumber: abs ?? undefined,
              tvdbEpisodeId: e.id > 0 ? e.id : undefined,
              streamId,
              rating: imdbRating,
              ratingIsImdb: imdbRating != null ? true : undefined,
            };
        if (seenId.has(ep.id)) continue;
        seenId.add(ep.id);
        if (match) claimed.add(match.id);
        eps.push(ep);
      }
      const key = String(s.seasonNumber);
      const { from, to } = seasonDateRange(bucket);
      items.push({
        key,
        name: s.name,
        nameLanguage: s.nameLanguage ?? "en",
        overview: s.overview,
        overviewLanguage: s.overviewLanguage,
        count: eps.length,
        year: s.airDate?.slice(0, 4),
        from,
        to,
        extra: s.seasonNumber === 0,
        seasonNumber: s.seasonNumber,
        isGenericName: s.isGenericName,
      });
      subset.set(key, eps);
    }
    const matchedIds = new Set<number>();
    for (const eps of subset.values()) for (const e of eps) matchedIds.add(e.id);
    const leftovers = pool.filter(
      (e) => e.id > 0 && e.sourceMetaId == null && !matchedIds.has(e.id),
    );
    if (leftovers.length > 0) {
      items.push({ key: "specials", name: extrasLabel, count: leftovers.length, extra: true });
      subset.set("specials", leftovers);
    }
    if (items.length === 0) return null;
    return { items, subset, pool };
  }, [
    ordering,
    episodes,
    franchiseEpisodes,
    extrasLabel,
    franchise,
    foreignSeasons,
    imdbId,
    metaId,
    metadataLanguage,
  ]);

  useEffect(() => {
    if (!ordering) return;
    setResolved(built ? "has" : "none");
  }, [ordering, built]);

  const active = enabled && resolved !== "none";
  if (!enabled || !built) return { panel: null, active };
  const activeKey =
    touched && built.items.some((i) => i.key === sel)
      ? (sel as string)
      : intentSeasonKey && built.items.some((i) => i.key === intentSeasonKey)
        ? intentSeasonKey
        : preferredSeasonKey && built.items.some((i) => i.key === preferredSeasonKey)
          ? preferredSeasonKey
          : built.items[0].key;
  return {
    panel: {
      items: built.items,
      activeKey,
      onSelect,
      visibleEpisodes: built.subset.get(activeKey) ?? built.pool,
      orderTypes,
      activeType,
    },
    active,
  };
}
