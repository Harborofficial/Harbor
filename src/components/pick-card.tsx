import { ScoreStack } from "./card-score-stack";
import { Bookmark, Check } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopTenRibbon } from "@/components/top-ten-ribbon";
import { meta as fetchMeta, narrowMediaType, type Meta } from "@/lib/cinemeta";
import { useContextMenu, type MembershipContext } from "@/lib/context-menu";
import { useT } from "@/lib/i18n";
import { preferredMeta } from "@/lib/meta-resource";
import {
  hoverPreviewBlur,
  hoverPreviewEnter,
  hoverPreviewFocus,
  hoverPreviewLeave,
} from "@/lib/hover-preview/store";
import { animeKitsuMeta } from "@/lib/providers/anime-kitsu-addon";
import { useCardScoreState } from "@/components/use-card-score-state";
import { needsImdbForPoster, needsTmdbForPoster, rpdbPoster } from "@/lib/providers/rpdb";
import { useTitlePoster } from "@/lib/title-poster";
import { externalToKitsu, kitsuToImdb, kitsuToTvdb } from "@/lib/providers/anime-mapping";
import { useTmdbIdFromImdb, useTmdbImdbId } from "@/lib/providers/tmdb";
import { useSettings } from "@/lib/settings";
import { simklTitleDetail } from "@/lib/simkl/title-detail";
import { getLocalCache } from "@/lib/simkl/activities";
import { aniZipByKitsu, aniZipByMal } from "@/lib/providers/anizip";
import { useViewActions } from "@/lib/view";
import { TvCard } from "@/components/tv-card";
import { useTilt } from "@/lib/use-tilt";
import { observe } from "@/lib/visibility";
import { LocalDot } from "@/components/local-badge";
import { Poster, useLocalizedPoster } from "./poster";
import { useProfiledEffect } from "./profiled";
import { ListingBadgeStrip } from "./listing-badge-strip";
import {
  CardHoverOverlay,
  cardHoverPosterClass,
  type CardHoverStyle,
} from "./pick-card/card-hover";
import { CustomHoverOverlay, customHoverPosterProps } from "./pick-card/custom-hover";
import { ExpandingCardArtwork, useExpandingCard } from "./pick-card/use-expanding-card";
import { getCustomHover } from "@/lib/custom-hover";
import {
  ClassicAwardBadge,
  ClassicAwardTab,
  useClassicAwardWin,
  AnimeAwardBadge,
  AnimeAwardTab,
} from "./card-award";
import { useCardSharedState } from "@/components/use-card-shared-state";
import {
  CinemaBadge,
  RerunBadge,
  StatusBadge,
  KidsStarBadge,
  stackTop,
} from "@/components/card-status-badges";
import { findTopAward, parseAwardYear } from "@/lib/anime-awards";
import { isCardAnimeId } from "@/lib/card-anime";

const WATCHLIST_POS: Record<string, string> = {
  topStart: "top-1.5 start-1.5",
  topEnd: "top-1.5 end-1.5",
  bottomStart: "bottom-1.5 start-1.5",
  bottomEnd: "bottom-1.5 end-1.5",
};

function circleTop(slots: number): string {
  return stackTop(slots, false, "poster", true);
}

function getTitleFromAniZip(
  titles: Record<string, string>,
  lang: "english" | "romaji" | "native",
): string | null {
  if (lang === "english") return titles.en || titles.ja || null;
  // AniZip's `x-jat` is AniDB's abbreviated short title ("OP TV", "Bleach3"),
  // so romaji never comes from here — Kitsu's `en_jp` does.
  if (lang === "romaji") return titles.en || null;
  if (lang === "native") return titles.ja || titles.en || null;
  return null;
}

function getTitleFromKitsu(
  titles: { en?: string; en_jp?: string; ja_jp?: string },
  lang: "english" | "romaji" | "native",
): string | null {
  if (lang === "english") return titles.en || titles.en_jp || titles.ja_jp || null;
  if (lang === "romaji") return titles.en_jp || titles.en || titles.ja_jp || null;
  if (lang === "native") return titles.ja_jp || titles.en_jp || titles.en || null;
  return null;
}

const PosterCard = memo(function PosterCard({
  meta,
  flagRerun = false,
  awardLookupName,
  kids = false,
  reason,
  reasonDetail,
  onOpenManga,
  membership,
}: {
  meta: Meta;
  flagRerun?: boolean;
  awardLookupName?: string;
  kids?: boolean;
  reason?: string;
  reasonDetail?: string;
  onOpenManga?: (meta: Meta) => void;
  membership?: MembershipContext;
}) {
  const { openMeta, openPicker, openManga } = useViewActions();
  // Saved list items may carry a stale id; let the caller resolve it first.
  const openMangaTarget = (m: Meta) => (onOpenManga ? onOpenManga(m) : openManga(m.id));
  const { open: openContextMenu } = useContextMenu();
  const { settings } = useSettings();
  const ref = useRef<HTMLButtonElement>(null);
  const expandingCard = useExpandingCard({
    cardRef: ref,
    meta,
    tmdbKey: settings.tmdbKey,
    focusEnabled: settings.posterFocusedCard,
  });
  const cardStyle: CardHoverStyle =
    kids || !settings.hoverPreviewEnabled ? "none" : settings.cardHoverStyle;
  const activeCustom = cardStyle === "custom" ? getCustomHover(settings.customHoverId) : null;
  const inCardHover: CardHoverStyle =
    cardStyle === "default" || cardStyle === "custom" || cardStyle === "marquee"
      ? "none"
      : cardStyle;
  const customProps = activeCustom ? customHoverPosterProps(activeCustom) : null;
  const badgeFade =
    inCardHover !== "none" || activeCustom
      ? "transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"
      : "";
  const t = useT();
  const isAnimeCardId = isCardAnimeId(meta.id);
  const resolvedImdb = useTmdbImdbId(meta.id);
  const imdbId = resolvedImdb ?? undefined;
  const sharedCardState = useCardSharedState({ meta, settings, imdbId, flagRerun });
  const { hasDub, showTop10, inCinema, rerun, newBadge, watched, inWatchlist, inLocalLibrary } =
    sharedCardState;
  const showCinema = inCinema && !rerun;
  const hasStatusBadge = settings.showCardBadges && (rerun || showCinema || !!newBadge);
  const topLeftBadges = (hasDub ? 1 : 0) + (hasStatusBadge ? 1 : 0);
  const ribbonLeft = showTop10 && settings.top10RibbonSide === "left";
  const ribbonRight = showTop10 && settings.top10RibbonSide === "right";
  const awardYear = parseAwardYear(meta.releaseInfo);
  const awardImdb = !isAnimeCardId && settings.cardAwardDisplay !== "none" ? imdbId : undefined;
  const classicWin = useClassicAwardWin(meta, awardImdb);
  const animeAwardWin =
    settings.cardAwardDisplay !== "none" && isAnimeCardId
      ? (findTopAward(awardLookupName ?? meta.name, awardYear) ??
        findTopAward(meta.name, awardYear))
      : null;
  const hasAwardWin = !!animeAwardWin || !!classicWin;
  const awardTabTop = hasAwardWin && settings.awardTabPosition === "top";
  const awardBelow = hasAwardWin && settings.awardTabPosition === "below";
  const awardTabTopClass =
    awardTabTop && (hasDub || hasStatusBadge)
      ? stackTop((hasDub ? 1 : 0) + (hasStatusBadge ? 1 : 0), ribbonLeft)
      : undefined;
  const leftAwardBadge =
    settings.cardAwardDisplay === "badge" && (isAnimeCardId ? !!animeAwardWin : !!classicWin);
  const leftTopSlots = topLeftBadges + (leftAwardBadge ? 1 : 0) + (ribbonLeft ? 1 : 0);
  const watchlistPos =
    settings.watchlistBadge === "topEnd"
      ? `end-1.5 ${circleTop(ribbonRight ? 1 : 0)}`
      : settings.watchlistBadge === "topStart" && leftTopSlots > 0
        ? `start-1.5 ${circleTop(leftTopSlots)}`
        : WATCHLIST_POS[settings.watchlistBadge];
  const wantTmdbPoster = needsTmdbForPoster(settings.rpdbKey, meta.id, settings.posterBaseUrl);
  const posterNeedsImdb = needsImdbForPoster(settings.rpdbKey, meta.id, settings.posterBaseUrl);
  const [animeImdb, setAnimeImdb] = useState<string | undefined>();
  const [animeTvdb, setAnimeTvdb] = useState<string | undefined>();
  const animeWantsImdb = isAnimeCardId && settings.animeCardRating === "imdb";
  const animeRating = isAnimeCardId
    ? settings.showMalBadge
      ? meta.imdbRating
      : undefined
    : undefined;
  const { cardRating, cardBadges } = useCardScoreState({
    meta,
    settings,
    imdbId,
    animeImdbId: animeImdb,
    animeRating,
    cardRef: ref,
    prefetchPosterIds: true,
  });
  const tilt = useTilt<HTMLDivElement>();
  const tiltable = !activeCustom;
  const bookmarkTopEnd = inWatchlist && settings.watchlistBadge === "topEnd";
  const watchedPos =
    settings.badgePlacement === "top"
      ? "bottom-1.5 end-1.5"
      : `end-1.5 ${circleTop((ribbonRight ? 1 : 0) + (bookmarkTopEnd ? 1 : 0))}`;

  const [imgIdx, setImgIdx] = useState(0);
  const advancePoster = useCallback(() => setImgIdx((i) => i + 1), []);
  const [hydratedPoster, setHydratedPoster] = useState<string | undefined>();
  const { url: localizedPoster, localizing: posterLocalizing } = useLocalizedPoster(meta.id);
  const resolvedTmdb = useTmdbIdFromImdb(wantTmdbPoster ? meta.id : undefined);
  const animeTmdb = useTmdbIdFromImdb(animeImdb) ?? undefined;
  const posterAltId = posterNeedsImdb
    ? imdbId
    : wantTmdbPoster
      ? (resolvedTmdb ?? undefined)
      : undefined;
  const posterPending =
    !!settings.tmdbKey &&
    ((posterNeedsImdb && resolvedImdb === undefined) ||
      (wantTmdbPoster && resolvedTmdb === undefined));
  const pinnedPoster = useTitlePoster(meta.id);
  const posterCandidates = useMemo(() => {
    if (posterPending && !pinnedPoster) return [];
    if (posterLocalizing) return pinnedPoster ? [pinnedPoster] : [];
    const base = localizedPoster ?? meta.poster;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of [
      pinnedPoster,
      animeImdb
        ? rpdbPoster(
            settings.rpdbKey,
            animeImdb,
            base,
            animeTmdb,
            settings.posterBaseUrl,
            meta.type === "series" ? "series" : "movie",
          )
        : undefined,
      animeTvdb
        ? rpdbPoster(
            settings.rpdbKey,
            `tvdb:${animeTvdb}`,
            base,
            undefined,
            settings.posterBaseUrl,
            "series",
          )
        : undefined,
      rpdbPoster(
        settings.rpdbKey,
        meta.id,
        base,
        posterAltId,
        settings.posterBaseUrl,
        meta.type === "series" ? "series" : "movie",
      ),
      localizedPoster,
      meta.poster,
      hydratedPoster,
    ]) {
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  }, [
    settings.rpdbKey,
    settings.posterBaseUrl,
    meta.type,
    meta.id,
    posterAltId,
    meta.poster,
    meta.background,
    hydratedPoster,
    animeImdb,
    animeTvdb,
    animeTmdb,
    localizedPoster,
    posterLocalizing,
    posterPending,
    pinnedPoster,
  ]);
  const posterSrc = posterCandidates[imgIdx];

  useEffect(() => {
    setImgIdx(0);
  }, [posterCandidates]);

  useEffect(() => {
    setHydratedPoster(undefined);
    setAnimeImdb(undefined);
    setAnimeTvdb(undefined);
  }, [meta.id]);

  useProfiledEffect(
    "card.anime-poster-ids",
    () => {
      if (!isAnimeCardId || (!settings.rpdbKey && !settings.posterBaseUrl && !animeWantsImdb))
        return;
      const m = meta.id.match(/^(kitsu|mal|anilist|anidb):(\d+)/);
      if (!m) return;
      const source = m[1];
      const idNum = Number(m[2]);
      if (!Number.isFinite(idNum)) return;
      let cancelled = false;
      (async () => {
        let kitsuId: number | null = source === "kitsu" ? idNum : null;
        if (kitsuId == null) {
          const armSource = source === "mal" ? "myanimelist" : source;
          kitsuId = await externalToKitsu(armSource, idNum).catch(() => null);
        }
        if (cancelled || kitsuId == null) return;
        const [tt, tv] = await Promise.all([
          kitsuToImdb(kitsuId).catch(() => null),
          kitsuToTvdb(kitsuId).catch(() => null),
        ]);
        if (cancelled) return;
        if (tt) setAnimeImdb(tt);
        if (tv) setAnimeTvdb(String(tv));
      })();
      return () => {
        cancelled = true;
      };
    },
    [meta.id, isAnimeCardId, settings.rpdbKey, settings.posterBaseUrl, animeWantsImdb],
  );

  useProfiledEffect(
    "card.poster-hydration",
    () => {
      if (posterSrc !== undefined || hydratedPoster || posterPending) return;
      let cancelled = false;
      const isAnimeId =
        meta.id.startsWith("kitsu:") ||
        meta.id.startsWith("mal:") ||
        meta.id.startsWith("anilist:") ||
        meta.id.startsWith("anidb:");
      const isSimklId = meta.id.startsWith("simkl:");
      const hydrator = isSimklId
        ? (async () => {
            const simklId = meta.id.slice(5);
            const detail = await simklTitleDetail(simklId).catch(() => null);
            return detail?.poster
              ? { poster: `https://simkl.in/posters/${detail.poster}_m.jpg` }
              : null;
          })()
        : isAnimeId
          ? animeKitsuMeta(meta.id).then((m) => (m ? { poster: m.poster } : null))
          : fetchMeta(narrowMediaType(meta.type), meta.id).then((full) =>
              full ? { poster: full.poster } : null,
            );
      hydrator
        .then((res) => {
          if (cancelled || !res?.poster) return;
          setHydratedPoster(res.poster);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    },
    [posterSrc, hydratedPoster, meta.type, meta.id, posterPending],
  );

  const [preferredTitle, setPreferredTitle] = useState<string | null>(null);

  useProfiledEffect(
    "card.preferred-title",
    () => {
      setPreferredTitle(null);
      if (!settings.addonOnlyMetadata || isAnimeCardId) return;
      if (meta.type !== "movie" && meta.type !== "series") return;
      const el = ref.current;
      if (!el) return;
      let cancelled = false;
      let off: (() => void) | null = null;
      off = observe(el, (visible) => {
        if (!visible) return;
        off?.();
        off = null;
        void preferredMeta(narrowMediaType(meta.type), meta.id).then((full) => {
          if (cancelled || !full?.name) return;
          setPreferredTitle(full.name);
        });
      });
      return () => {
        cancelled = true;
        off?.();
      };
    },
    [meta.id, meta.type, isAnimeCardId, settings.addonOnlyMetadata],
  );

  const [translatedTitle, setTranslatedTitle] = useState<string | null>(null);

  useProfiledEffect(
    "card.anime-title",
    () => {
      setTranslatedTitle(null);
      if (!isAnimeCardId) return;
      const el = ref.current;
      if (!el) return;

      let cancelled = false;
      const cache = getLocalCache();
      let kitsuId: number | null = null;
      let malId: number | null = null;

      if (cache) {
        const parts = meta.id.split(":");
        const type = parts[0];
        const idVal = parts[1];

        if (type === "kitsu") {
          kitsuId = Number(idVal);
        } else if (type === "mal") {
          malId = Number(idVal);
        }

        let simklId: number | null = null;
        if (type === "simkl") {
          simklId = Number(idVal);
        } else if (type === "kitsu" && kitsuId) {
          simklId = cache.kitsuToSimkl[String(kitsuId)] ?? null;
        } else if (type === "mal" && malId) {
          simklId = cache.malToSimkl[String(malId)] ?? null;
        }

        if (simklId) {
          if (!kitsuId) {
            const kStr = Object.keys(cache.kitsuToSimkl).find(
              (k) => cache.kitsuToSimkl[k] === simklId,
            );
            if (kStr) kitsuId = Number(kStr);
          }
          if (!malId) {
            const mStr = Object.keys(cache.malToSimkl).find((k) => cache.malToSimkl[k] === simklId);
            if (mStr) malId = Number(mStr);
          }
        }
      }

      const preferred = settings.animeTitleLanguage;

      const fetchTitles = async () => {
        // Romaji series titles only exist in Kitsu's own map; AniZip carries an
        // abbreviated AniDB short title in `x-jat` instead.
        if (preferred !== "romaji" && malId) {
          const map = await aniZipByMal(malId).catch(() => null);
          if (cancelled) return;
          if (map?.titles) {
            const title = getTitleFromAniZip(map.titles, preferred);
            if (title) {
              setTranslatedTitle(title);
              return;
            }
          }
        }

        if (preferred !== "romaji" && kitsuId) {
          const map = await aniZipByKitsu(kitsuId).catch(() => null);
          if (cancelled) return;
          if (map?.titles) {
            const title = getTitleFromAniZip(map.titles, preferred);
            if (title) {
              setTranslatedTitle(title);
              return;
            }
          }
        }

        if (kitsuId) {
          try {
            const res = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}`, {
              headers: { Accept: "application/vnd.api+json" },
            });
            if (res.ok) {
              const j = await res.json();
              const attr = j?.data?.attributes;
              if (attr?.titles) {
                const title = getTitleFromKitsu(attr.titles, preferred) || attr.canonicalTitle;
                if (cancelled) return;
                if (title) {
                  setTranslatedTitle(title);
                  return;
                }
              }
            }
          } catch {
            /* ignore */
          }
        }
      };

      let started = false;
      const off = observe(el, (visible) => {
        if (visible && !started && !cancelled) {
          started = true;
          fetchTitles().catch(() => {});
        }
      });

      return () => {
        cancelled = true;
        off?.();
      };
    },
    [meta.id, isAnimeCardId, settings.animeTitleLanguage],
  );

  const posterOverlays = useMemo(
    () => (
      <>
        <ExpandingCardArtwork
          src={expandingCard.artwork}
          onReady={expandingCard.onArtworkReady}
          onError={expandingCard.onArtworkError}
        />
        <ListingBadgeStrip meta={meta} />
      </>
    ),
    [meta, expandingCard.artwork, expandingCard.onArtworkReady, expandingCard.onArtworkError],
  );

  return (
    <button
      ref={ref}
      onClick={() =>
        meta.type === "manga"
          ? openMangaTarget(meta)
          : openMeta(meta, isAnimeCardId ? { exact: true } : undefined)
      }
      onContextMenu={(e) => openContextMenu(e, { kind: "meta", meta, membership })}
      onFocus={(e) => {
        expandingCard.onFocus();
        if (!expandingCard.enabled) hoverPreviewFocus(meta, e.currentTarget);
      }}
      onBlur={(e) => {
        expandingCard.onBlur();
        hoverPreviewBlur(e.currentTarget);
      }}
      data-media-card
      data-expanding-card={expandingCard.enabled ? "" : undefined}
      data-row-card-expanded={expandingCard.expanded ? "true" : undefined}
      data-focused-card={expandingCard.focusEnabled ? "" : undefined}
      data-no-card-ring={inCardHover !== "none" || activeCustom ? "" : undefined}
      className="group relative z-0 flex w-full min-w-0 flex-col gap-2.5 text-start hover:z-[2]"
    >
      <div
        data-preview-anchor
        ref={tiltable ? tilt.ref : undefined}
        onPointerEnter={(e) => {
          hoverPreviewEnter(meta, e.currentTarget, e.buttons);
          if (tiltable) tilt.onPointerEnter();
        }}
        onPointerMove={tiltable ? tilt.onPointerMove : undefined}
        onPointerLeave={(e) => {
          hoverPreviewLeave(e.currentTarget);
          if (tiltable) tilt.onPointerLeave();
        }}
        style={customProps?.style}
        className={`relative w-full ${
          tiltable
            ? ""
            : "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0.24,1)] motion-safe:group-hover:[transform:translate3d(0,-0.5rem,0)_scale(1.03)] motion-safe:group-hover:will-change-transform"
        } ${expandingCard.enabled ? "expanding-card-poster-frame" : ""} ${
          expandingCard.focusEnabled
            ? "group-focus:[-webkit-transform:translate3d(0,-0.5rem,0)] group-focus:[transform:translate3d(0,-0.5rem,0)]"
            : ""
        }`}
      >
        <Poster
          src={posterSrc}
          seed={meta.id}
          lowResImdb={imdbId}
          ratio="portrait"
          lazy="release"
          onError={advancePoster}
          className={`harbor-card-ring rounded-[var(--poster-radius,12px)] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)] transition-[box-shadow] duration-300 group-hover:shadow-[0_24px_48px_-14px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.08)] ${
            customProps ? customProps.className : cardHoverPosterClass(inCardHover)
          }`}
        >
          {posterOverlays}
        </Poster>
        {settings.cardHoverShine && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[var(--poster-radius,12px)] opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 motion-reduce:transition-none"
            style={{
              background:
                "linear-gradient(105deg, transparent 44%, rgba(255,255,255,0.12) 50%, transparent 56%)",
            }}
          />
        )}
        {activeCustom ? (
          <CustomHoverOverlay
            config={activeCustom}
            meta={meta}
            onPlay={() => {
              if (meta.isCollection) openMeta(meta);
              else if (meta.type === "manga") openMangaTarget(meta);
              else if (meta.type === "movie")
                openPicker(meta, undefined, { autoPlay: true, resume: true });
              else openMeta(meta);
            }}
          />
        ) : inCardHover !== "none" ? (
          <CardHoverOverlay
            meta={meta}
            style={inCardHover}
            onPlay={() => {
              if (meta.isCollection) openMeta(meta);
              else if (meta.type === "manga") openMangaTarget(meta);
              else if (meta.type === "movie")
                openPicker(meta, undefined, { autoPlay: true, resume: true });
              else openMeta(meta);
            }}
          />
        ) : null}
        <div className={badgeFade}>
          {showTop10 && <TopTenRibbon side={settings.top10RibbonSide} />}
          {hasDub && (
            <span
              className={`pointer-events-none absolute start-2 ${stackTop(0, ribbonLeft)} z-10 rounded-md bg-accent/90 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-canvas ring-1 ring-black/10`}
            >
              DUB
            </span>
          )}
          {settings.showCardBadges && (
            <>
              {rerun && (
                <RerunBadge year={meta.releaseInfo} dubShift={hasDub} ribbonShift={ribbonLeft} />
              )}
              {showCinema && <CinemaBadge dubShift={hasDub} ribbonShift={ribbonLeft} />}
              {newBadge && (
                <StatusBadge
                  label={t(newBadge.label)}
                  tone={newBadge.tone}
                  kids={kids}
                  dubShift={hasDub}
                  ribbonShift={ribbonLeft}
                />
              )}
            </>
          )}
          {leftAwardBadge &&
            (isAnimeCardId ? (
              <AnimeAwardBadge
                win={animeAwardWin!}
                stacked={hasStatusBadge}
                dubShift={hasDub}
                ribbonShift={ribbonLeft}
              />
            ) : (
              <ClassicAwardBadge
                win={classicWin}
                stacked={hasStatusBadge}
                dubShift={hasDub}
                ribbonShift={ribbonLeft}
              />
            ))}
          {settings.cardAwardDisplay === "tabs" && isAnimeCardId && (
            <AnimeAwardTab
              name={awardLookupName ?? meta.name}
              fallbackName={meta.name}
              year={parseAwardYear(meta.releaseInfo)}
              below={awardBelow}
              top={awardTabTop}
              topClass={awardTabTopClass}
            />
          )}
          {settings.cardAwardDisplay === "tabs" && classicWin && !isAnimeCardId && (
            <ClassicAwardTab
              win={classicWin}
              below={awardBelow}
              top={awardTabTop}
              topClass={awardTabTopClass}
            />
          )}
          {inWatchlist && settings.watchlistBadge !== "off" && (
            <span
              className={`pointer-events-none absolute flex h-6 w-6 items-center justify-center rounded-full bg-canvas/95 text-ink ring-1 ring-edge-soft/70 ${watchlistPos}`}
              title={t("In your watchlist")}
              aria-label={t("In watchlist")}
            >
              <Bookmark size={11} strokeWidth={2.6} fill="currentColor" />
            </span>
          )}
          {settings.showWatchedBadge && watched && (
            <span
              className={`pointer-events-none absolute flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white ring-1 ring-emerald-300/40 ${watchedPos}`}
              title={t("Watched")}
              aria-label={t("Watched")}
            >
              <Check size={12} strokeWidth={3} />
            </span>
          )}
          {settings.showLocalLibraryBadge && inLocalLibrary && (
            <LocalDot
              title={t("In your local library")}
              className={`bottom-1.5 ${settings.watchlistBadge === "bottomStart" ? "start-9" : "start-1.5"}`}
            />
          )}
          {kids ? (
            cardRating && <KidsStarBadge value={cardRating} placement={settings.badgePlacement} />
          ) : (
            <ScoreStack
              badges={cardBadges}
              limit={settings.cardBadgeLimit}
              placement={settings.badgePlacement}
              raised={awardBelow}
            />
          )}
        </div>
      </div>
      {!settings.hidePosterTitles && (
        <div className="min-h-9">
          <p
            style={{ fontSize: `${(kids ? 15 : 13) * settings.cardTitleScale}px` }}
            className={
              kids
                ? "line-clamp-2 text-[15px] font-bold leading-snug text-[#0e3a43]"
                : `${reason && !kids ? "line-clamp-1" : "line-clamp-2"} text-[13px] font-medium leading-snug text-ink`
            }
          >
            {preferredTitle || translatedTitle || meta.name}
          </p>
          {reason && !kids && (
            <p
              className="line-clamp-1 text-[11px] leading-tight text-ink-subtle"
              title={reasonDetail}
            >
              {reason}
            </p>
          )}
        </div>
      )}
    </button>
  );
});

export const PickCard = Object.assign(
  memo(function PickCard(props: {
    meta: Meta;
    curatedBadgeAtTopStart?: boolean;
    flagRerun?: boolean;
    awardLookupName?: string;
    kids?: boolean;
    membership?: MembershipContext;
    reason?: string;
    reasonDetail?: string;
    onOpenManga?: (meta: Meta) => void;
  }) {
    const { settings } = useSettings();
    if (settings.rowCardStyle === "tv" && !props.kids && props.meta.type !== "manga") {
      return (
        <TvCard
          meta={props.meta}
          curatedBadgeAtTopStart={props.curatedBadgeAtTopStart}
          kids={props.kids}
          flagRerun={props.flagRerun}
          awardLookupName={props.awardLookupName}
          reason={props.reason}
          membership={props.membership}
        />
      );
    }
    return <PosterCard {...props} />;
  }),
  { isPosterCard: true as const },
);
