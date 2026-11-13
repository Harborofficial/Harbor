import { memo, useEffect, useRef, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import { peekCachedLogo, resolveLogo } from "@/lib/logo";
import { sizeImageUrl } from "@/lib/img-size";
import { useContextMenu, type MembershipContext } from "@/lib/context-menu";
import { useSettings } from "@/lib/settings";
import { useViewActions } from "@/lib/view";
import { usePosterChain } from "@/components/poster";
import { ensureStaticHeroArt, peekStaticHeroArt } from "@/lib/providers/anime-hero-art-static";
import { prepareExpandingCardArtwork } from "@/lib/expanding-card-artwork";
import { ScoreStack, type CardBadge } from "@/components/card-score-stack";
import { useTmdbImdbId } from "@/lib/providers/tmdb";
import {
  hoverPreviewBlur,
  hoverPreviewEnter,
  hoverPreviewFocus,
  hoverPreviewLeave,
} from "@/lib/hover-preview/store";
import { Bookmark, Check } from "lucide-react";
import { LocalDot } from "@/components/local-badge";
import { TopTenRibbon } from "@/components/top-ten-ribbon";
import {
  AnimeAwardBadge,
  AnimeAwardTab,
  ClassicAwardBadge,
  ClassicAwardTab,
  useClassicAwardWin,
} from "@/components/card-award";
import { findTopAward, parseAwardYear } from "@/lib/anime-awards";
import { useT } from "@/lib/i18n";
import { externalToKitsu, kitsuToImdb } from "@/lib/providers/anime-mapping";
import { useCardSharedState, type CardSharedState } from "@/components/use-card-shared-state";
import { CinemaBadge, RerunBadge, StatusBadge, stackTop } from "@/components/card-status-badges";
import { useCardScoreState } from "@/components/use-card-score-state";
import { isCardAnimeId } from "@/lib/card-anime";

// Preserve the local TV-card support for Simkl anime IDs. Poster-card anime
// detection is intentionally left unchanged.
function isTvCardAnimeId(id: string): boolean {
  return isCardAnimeId(id) || id.startsWith("simkl:");
}

const POS = {
  center: "inset-0 items-center justify-center text-center",
  bottomStart: "inset-x-0 bottom-0 items-end justify-start p-3.5 text-start",
  bottomEnd: "inset-x-0 bottom-0 items-end justify-end p-3.5 text-end",
} as const;

const WATCHLIST_POS: Record<string, string> = {
  topStart: "top-2 start-2",
  topEnd: "top-2 end-2",
  bottomStart: "bottom-2 start-2",
  bottomEnd: "bottom-2 end-2",
};

function useLogo(meta: Meta): string | undefined {
  const { settings } = useSettings();
  const [logo, setLogo] = useState<string | undefined>(() =>
    peekCachedLogo(settings.tmdbKey, meta),
  );
  useEffect(() => {
    let cancelled = false;
    const cached = peekCachedLogo(settings.tmdbKey, meta);
    if (cached) {
      setLogo(cached);
      return;
    }
    setLogo(undefined);
    resolveLogo(settings.tmdbKey, meta)
      .then((url) => {
        if (!cancelled) setLogo(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [meta, settings.tmdbKey]);
  return logo;
}

export const TvCard = memo(function TvCard({
  meta,
  kids = false,
  flagRerun = false,
  awardLookupName,
  curatedBadgeAtTopStart = false,
  reason,
  membership,
}: {
  meta: Meta;
  kids?: boolean;
  flagRerun?: boolean;
  awardLookupName?: string;
  curatedBadgeAtTopStart?: boolean;
  reason?: string;
  membership?: MembershipContext;
}) {
  const { openMeta, openManga } = useViewActions();
  const { open: openContextMenu } = useContextMenu();
  const cardRef = useRef<HTMLButtonElement>(null);
  const { settings } = useSettings();
  const cardSettings = { ...settings, ...settings.tvCardOptions };
  const logo = useLogo(meta);
  const poster = usePosterChain(
    settings.rpdbKey,
    meta.id,
    meta.poster,
    meta.type === "series" ? "series" : "movie",
  );
  const isAnimeCardId = isTvCardAnimeId(meta.id);
  const [animeImdbId, setAnimeImdbId] = useState<string>();
  useEffect(() => {
    setAnimeImdbId(undefined);
    if (!isAnimeCardId || cardSettings.animeCardRating !== "imdb") return;
    const match = meta.id.match(/^(kitsu|mal|anilist|anidb):(\d+)/);
    if (!match) return;
    let cancelled = false;
    void (async () => {
      const source = match[1] === "mal" ? "myanimelist" : match[1];
      const kitsuId =
        match[1] === "kitsu"
          ? Number(match[2])
          : await externalToKitsu(source, Number(match[2])).catch(() => null);
      if (!kitsuId || cancelled) return;
      const imdb = await kitsuToImdb(kitsuId).catch(() => null);
      if (!cancelled && imdb) setAnimeImdbId(imdb);
    })();
    return () => {
      cancelled = true;
    };
  }, [meta.id, isAnimeCardId, cardSettings.animeCardRating]);
  const imdbId = useTmdbImdbId(meta.id) ?? undefined;
  const sharedCardState = useCardSharedState({ meta, settings: cardSettings, imdbId, flagRerun });
  const animeRating = isAnimeCardId && cardSettings.showMalBadge ? meta.imdbRating : undefined;
  const { cardBadges } = useCardScoreState({
    meta,
    settings: cardSettings,
    imdbId,
    animeImdbId,
    animeRating,
    cardRef,
  });
  const open = () => {
    if (meta.type === "manga") {
      openManga(meta.id);
      return;
    }
    openMeta(meta);
  };

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={open}
      onContextMenu={(e) => openContextMenu(e, { kind: "meta", meta, membership })}
      onFocus={(e) => !kids && hoverPreviewFocus(meta, e.currentTarget)}
      onBlur={(e) => !kids && hoverPreviewBlur(e.currentTarget)}
      style={{ borderRadius: settings.posterRadius }}
      className="group relative block aspect-[16/9] w-full overflow-hidden bg-elevated ring-1 ring-edge-soft transition-[box-shadow,--tw-ring-color] duration-200 ease-out hover:ring-edge hover:shadow-[0_10px_28px_-18px_rgba(0,0,0,0.8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/70"
    >
      <span
        data-preview-anchor
        className="absolute inset-0"
        onPointerEnter={(e) => !kids && hoverPreviewEnter(meta, e.currentTarget, e.buttons)}
        onPointerLeave={(e) => !kids && hoverPreviewLeave(e.currentTarget)}
      >
        <TvCardArtwork
          meta={meta}
          awardLookupName={awardLookupName}
          kids={kids}
          logo={logo}
          posterSrc={poster.src}
          backdropSrc={poster.backdrop}
          imdbId={imdbId}
          onPosterError={poster.onError}
          reason={reason}
          curatedBadgeAtTopStart={curatedBadgeAtTopStart}
          cardSettings={cardSettings}
          scoreBadges={cardBadges}
          sharedState={sharedCardState}
          isAnime={isAnimeCardId}
        />
      </span>
    </button>
  );
});

// MAL/Kitsu anime metas carry no backdrop; the TV card would otherwise blur the poster.
function useAnimeBackdrop(meta: Meta): string | undefined {
  const { settings } = useSettings();
  const isAnime = isTvCardAnimeId(meta.id);
  const [backdrop, setBackdrop] = useState<{ meta: Meta; url?: string }>(() => ({
    meta,
    url: isAnime ? peekStaticHeroArt(meta.id)?.bg : undefined,
  }));
  useEffect(() => {
    if (!isAnime || (meta.background && meta.background !== meta.poster)) {
      return;
    }
    let cancelled = false;
    const resolve = async () => {
      await ensureStaticHeroArt().catch(() => {});
      if (cancelled) return;
      const staticBg = peekStaticHeroArt(meta.id)?.bg;
      if (staticBg) {
        setBackdrop({ meta, url: staticBg });
        return;
      }
      const url = await prepareExpandingCardArtwork(meta, settings.tmdbKey).catch(() => undefined);
      if (!cancelled) setBackdrop({ meta, url: url && url !== meta.poster ? url : undefined });
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [meta, isAnime, settings.tmdbKey]);
  // Reused cards must not display the previous title while its replacement resolves.
  return isAnime && backdrop.meta === meta ? backdrop.url : undefined;
}

export function TvCardArtwork({
  meta,
  awardLookupName,
  kids = false,
  logo,
  posterSrc,
  backdropSrc,
  imdbId,
  onPosterError,
  reason,
  curatedBadgeAtTopStart = false,
  cardSettings,
  scoreBadges = [],
  sharedState,
  isAnime = false,
}: {
  meta: Meta;
  awardLookupName?: string;
  kids?: boolean;
  logo?: string;
  posterSrc?: string;
  backdropSrc?: string;
  imdbId?: string;
  onPosterError?: () => void;
  reason?: string;
  curatedBadgeAtTopStart?: boolean;
  cardSettings?: ReturnType<typeof useSettings>["settings"];
  scoreBadges?: CardBadge[];
  sharedState: CardSharedState;
  isAnime?: boolean;
}) {
  const { settings } = useSettings();
  const card = cardSettings ?? { ...settings, ...settings.tvCardOptions };
  const t = useT();
  const [failedBackdrop, setFailedBackdrop] = useState<string>();
  const [logoAspect, setLogoAspect] = useState<{ src: string; compact: boolean }>();
  const animeBackdrop = useAnimeBackdrop(meta);
  const { showTop10, inCinema, rerun, newBadge, hasDub, watched, inWatchlist, inLocalLibrary } =
    sharedState;
  const awardYear = parseAwardYear(meta.releaseInfo);
  const awardImdb = !isAnime && card.cardAwardDisplay !== "none" ? imdbId : undefined;
  const classicWin = useClassicAwardWin(meta, awardImdb);
  const animeAward = isAnime
    ? (findTopAward(awardLookupName ?? meta.name, awardYear) ?? findTopAward(meta.name, awardYear))
    : null;
  const hasAwardWin = !!classicWin || !!animeAward;
  const showCinema = inCinema && !rerun;
  const hasStatusBadge = card.showCardBadges && (rerun || showCinema || !!newBadge);
  const hasAwardBadge =
    card.cardAwardDisplay === "badge" && (isAnime ? !!animeAward : !!classicWin);
  const curatedPosition = curatedBadgeAtTopStart ? "end" : "start";
  const ribbonSide =
    curatedBadgeAtTopStart && card.top10RibbonSide === "left" ? "right" : card.top10RibbonSide;
  const ribbonLeft = showTop10 && ribbonSide === "left";
  const ribbonRight = showTop10 && ribbonSide === "right";
  const overlayRibbonShift = curatedBadgeAtTopStart ? ribbonRight : ribbonLeft;
  const backdrop =
    meta.background && meta.background !== meta.poster ? meta.background : animeBackdrop;
  // Keep the local RPDB/provider backdrop as the first choice, followed by
  // the original metadata or anime backdrop.
  const wide = [backdropSrc, backdrop].find((url) => url && url !== failedBackdrop);
  const pos =
    settings.tvCardLogoPos === "off" ? null : (POS[settings.tvCardLogoPos] ?? POS.bottomStart);
  const topLeftSlots = curatedBadgeAtTopStart
    ? 1
    : (ribbonLeft ? 1 : 0) + (hasDub ? 1 : 0) + (hasStatusBadge ? 1 : 0) + (hasAwardBadge ? 1 : 0);
  const rightBadgeSlots = curatedBadgeAtTopStart
    ? (hasDub ? 1 : 0) + (hasStatusBadge ? 1 : 0) + (hasAwardBadge ? 1 : 0)
    : 0;
  const awardTabTop = hasAwardWin && card.cardAwardDisplay === "tabs";
  const scoreStackAtTop = !kids && scoreBadges.length > 0 && card.badgePlacement === "top";
  // Curated TV badges move to the right to leave the ranking number visible.
  // Scores must follow those badges (and any right-side ribbon) rather than
  // sharing their first slot. Top-centered award tabs also need some space.
  const scoreTopClass =
    scoreStackAtTop && (rightBadgeSlots > 0 || ribbonRight || awardTabTop)
      ? stackTop(
          rightBadgeSlots + (rightBadgeSlots === 0 && !ribbonRight && awardTabTop ? 1 : 0),
          ribbonRight,
          "tv",
        )
      : undefined;
  const topRightSlots = (ribbonRight ? 1 : 0) + rightBadgeSlots + (scoreStackAtTop ? 1 : 0);
  const watchlistPosition =
    card.watchlistBadge === "topStart" && topLeftSlots > 0
      ? `start-2 ${stackTop(topLeftSlots, false, "tv", true)}`
      : card.watchlistBadge === "topEnd" && topRightSlots > 0
        ? `end-2 ${stackTop(topRightSlots, false, "tv", true)}`
        : WATCHLIST_POS[card.watchlistBadge];
  const scoreStackAtBottom = !kids && scoreBadges.length > 0 && card.badgePlacement !== "top";
  const watchedPosition = `${scoreStackAtBottom ? "bottom-9" : "bottom-2"} end-2`;

  return (
    <>
      {wide ? (
        <img
          src={sizeImageUrl(wide, 640)}
          alt=""
          draggable={false}
          loading="lazy"
          onError={() => setFailedBackdrop(wide)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <img
          src={posterSrc}
          onError={onPosterError}
          alt=""
          draggable={false}
          loading="lazy"
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-[18px] saturate-[1.2]"
        />
      )}

      {pos && (
        <>
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                settings.tvCardLogoPos === "center"
                  ? "linear-gradient(0deg, color-mix(in oklch, var(--color-canvas), transparent 20%) 0%, color-mix(in oklch, var(--color-canvas), transparent 55%) 50%, color-mix(in oklch, var(--color-canvas), transparent 30%) 100%)"
                  : "linear-gradient(0deg, var(--color-canvas) 2%, color-mix(in oklch, var(--color-canvas), transparent 35%) 34%, color-mix(in oklch, var(--color-canvas), transparent 82%) 62%, transparent 84%)",
            }}
          />

          <span className={`absolute z-10 flex gap-2.5 ${pos}`}>
            <span className="h-[54px] w-[36px] shrink-0 overflow-hidden rounded-sm shadow-[0_8px_18px_-8px_rgba(0,0,0,0.9)] ring-1 ring-white/12">
              <img
                src={posterSrc}
                onError={onPosterError}
                alt=""
                draggable={false}
                className="h-full w-full object-cover"
              />
            </span>
            <span className="flex min-w-0 flex-1 flex-col justify-end gap-1">
              {logo ? (
                <img
                  src={logo}
                  alt={meta.name}
                  draggable={false}
                  loading="lazy"
                  onLoad={(event) => {
                    const { naturalWidth, naturalHeight } = event.currentTarget;
                    const ratio = naturalHeight > 0 ? naturalWidth / naturalHeight : Infinity;
                    const threshold = naturalWidth <= 500 ? 2.1 : 2.7;
                    setLogoAspect({ src: logo, compact: ratio < threshold });
                  }}
                  className={`${logoAspect?.src === logo && logoAspect.compact ? "max-h-[54px]" : "max-h-[34px]"} w-auto max-w-full self-start object-contain object-left [filter:drop-shadow(0_2px_8px_rgba(0,0,0,0.8))]`}
                />
              ) : (
                <span className="line-clamp-2 text-[14.5px] font-semibold leading-tight text-ink [text-shadow:0_1px_8px_rgba(0,0,0,0.9)]">
                  {meta.name}
                </span>
              )}
              {!kids && (
                <span className="truncate text-[11px] tabular-nums text-ink-muted [text-shadow:0_1px_6px_rgba(0,0,0,0.9)] min-h-[1em]">
                  {[meta.releaseInfo, reason].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
          </span>
        </>
      )}
      {!kids && scoreBadges.length > 0 && (
        <ScoreStack
          badges={scoreBadges}
          limit={scoreBadges.length}
          placement={card.badgePlacement}
          topClass={scoreTopClass}
          shiftedFromEnd={inWatchlist && scoreStackAtBottom && card.watchlistBadge === "bottomEnd"}
        />
      )}
      {showTop10 && <TopTenRibbon side={ribbonSide} />}
      {hasDub && (
        <span
          className={`pointer-events-none absolute ${curatedPosition === "end" ? "end-2" : "start-2"} ${stackTop(0, overlayRibbonShift, "tv")} z-10 rounded-md bg-accent/90 px-2 py-1 text-[10px] font-extrabold text-canvas`}
        >
          DUB
        </span>
      )}
      {card.showCardBadges && (
        <>
          {rerun && (
            <RerunBadge
              year={meta.releaseInfo}
              dubShift={hasDub}
              ribbonShift={overlayRibbonShift}
              side={curatedPosition}
              layout="tv"
            />
          )}
          {showCinema && (
            <CinemaBadge
              dubShift={hasDub}
              ribbonShift={overlayRibbonShift}
              side={curatedPosition}
              layout="tv"
            />
          )}
          {newBadge && (
            <StatusBadge
              label={t(newBadge.label)}
              tone={newBadge.tone}
              kids={kids}
              dubShift={hasDub}
              ribbonShift={overlayRibbonShift}
              side={curatedPosition}
              layout="tv"
            />
          )}
        </>
      )}

      {hasAwardBadge &&
        (isAnime ? (
          <AnimeAwardBadge
            win={animeAward!}
            stacked={hasStatusBadge}
            dubShift={hasDub}
            ribbonShift={overlayRibbonShift}
            layout="tv"
            side={curatedPosition}
          />
        ) : (
          <ClassicAwardBadge
            win={classicWin}
            stacked={hasStatusBadge}
            dubShift={hasDub}
            ribbonShift={overlayRibbonShift}
            layout="tv"
            side={curatedPosition}
          />
        ))}
      {card.cardAwardDisplay === "tabs" && isAnime && (
        <AnimeAwardTab
          name={awardLookupName ?? meta.name}
          fallbackName={meta.name}
          year={awardYear}
          top
        />
      )}
      {card.cardAwardDisplay === "tabs" && classicWin && !isAnime && (
        <ClassicAwardTab win={classicWin} top={awardTabTop} />
      )}
      {card.watchlistBadge !== "off" && inWatchlist && (
        <span
          className={`absolute z-20 grid h-6 w-6 place-items-center rounded-full bg-canvas/95 text-ink ${watchlistPosition}`}
        >
          <Bookmark size={12} fill="currentColor" />
        </span>
      )}
      {card.showWatchedBadge && watched && (
        <span
          className={`absolute z-20 grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white ${watchedPosition}`}
        >
          <Check size={12} />
        </span>
      )}
      {card.showLocalLibraryBadge && inLocalLibrary && (
        <LocalDot
          title="In your local library"
          className={`bottom-2 ${card.watchlistBadge === "bottomStart" ? "start-10" : "start-2"}`}
        />
      )}
    </>
  );
}
