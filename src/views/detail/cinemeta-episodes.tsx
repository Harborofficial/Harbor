import { getViewedSeason, setViewedSeason } from "@/lib/season-view-pref";
import type { Season } from "@/lib/providers/tmdb";
import { EpisodeReleaseCountdown } from "@/components/episode-release-countdown";
import { Check, ChevronDown } from "lucide-react";
import { Play } from "@/components/icons/play-filled";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Meta } from "@/lib/cinemeta";
import { EpisodeWatchedMenu, type WatchedMenuTarget } from "@/components/episode-watched-menu";
import {
  manualEpisodeKeys,
  manualWatchedState,
  manualWatchedVersion,
  subscribeManualWatched,
} from "@/lib/manual-watched";
import { isNuvioProviderActive } from "@/lib/active-profile-id";
import { Poster } from "@/components/poster";
import { useSettings } from "@/lib/settings";
import { useLocalAwareSeriesPlay } from "@/lib/local-library/use-series-play";
import { useT } from "@/lib/i18n";
import { EpisodeDownloadButton } from "./episode-download-button";
import { EpisodeReviewsButton } from "./episode-reviews-dialog";
import { resumeDefaultSeason } from "@/lib/episode-progress";
import { DragStrip } from "@/components/drag-strip";
import { EpisodeGrid } from "./episode-grid";
import { EpisodeGridCard } from "./episode-grid-card";
import type { GridEpisode, Progress } from "./episode-grid-types";
import { SeasonExplorer } from "./season-explorer";
import { useSeasonExplorerView } from "./use-season-explorer";
import { effectiveTmdbLanguage } from "@/lib/providers/tmdb/tmdb-client";
import { seasonPill } from "@/lib/season-name";
import { EpisodeLayoutToggle } from "./episode-layout-toggle";
import { isUpcomingDate } from "./helpers";
import { EpisodeRatingBadge } from "./episode-rating-badge";
import { useEpisodeImdbRatings } from "./use-episode-imdb-ratings";
import {
  episodeNumber,
  episodeSeason,
  groupEpisodes,
  NO_SEASON,
  type CinemetaVideo,
} from "./episode-groups";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

export function CinemetaEpisodes({
  meta,
  videos,
  stremioWatched,
  resumeSeason,
  resumeEpisode,
  imdbId,
  tmdbTvId,
  seasonPosters,
  seasons,
}: {
  meta: Meta;
  videos: NonNullable<Meta["videos"]>;
  stremioWatched?: Set<string>;
  resumeSeason?: number;
  resumeEpisode?: number;
  imdbId?: string | null;
  tmdbTvId?: number;
  seasonPosters?: Record<number, string>;
  seasons?: Season[];
}) {
  const t = useT();
  const { settings, update } = useSettings();
  const playLocalAware = useLocalAwareSeriesPlay();
  const mwVersion = useSyncExternalStore(subscribeManualWatched, manualWatchedVersion);
  const [watchedMenu, setWatchedMenu] = useState<WatchedMenuTarget | null>(null);
  const openWatchedMenu = (
    e: React.MouseEvent,
    season: number,
    episode: number,
    watched: boolean,
  ) => {
    e.preventDefault();
    setWatchedMenu({
      x: e.clientX,
      y: e.clientY,
      season,
      episode,
      watched,
      origin: e.currentTarget instanceof HTMLElement ? e.currentTarget : null,
    });
  };
  const grouped = useMemo(() => groupEpisodes(videos), [videos]);
  const combinedWatched = useMemo(() => {
    const watched = new Set(stremioWatched ?? []);
    if (resumeSeason != null && resumeEpisode != null && (resumeSeason > 1 || resumeEpisode > 1)) {
      if (!isNuvioProviderActive()) {
        for (const v of videos) {
          const s = v.season ?? 0;
          const e = v.episode ?? v.number ?? 0;
          if (s >= 1 && e >= 1) {
            if (s < resumeSeason || (s === resumeSeason && e < resumeEpisode)) {
              watched.add(`${s}:${e}`);
            }
          }
        }
      }
    }
    const manual = manualEpisodeKeys(meta.id, [imdbId]);

    for (const key of manual.watched) watched.add(key);
    for (const key of manual.unwatched) watched.delete(key);

    return watched;
  }, [meta.id, imdbId, stremioWatched, mwVersion, resumeSeason, resumeEpisode, videos]);
  const seasonStats = useMemo(
    () =>
      grouped.map((group) => ({
        seasonNumber: group.seasonNumber,
        episodeCount: group.episodes.length,
      })),
    [grouped],
  );

  const allEpisodesOrdered = useMemo(
    () =>
      grouped.flatMap((g) =>
        g.episodes.map((ep, i) => ({
          season: ep.season ?? (g.seasonNumber || 1),
          episode: ep.episode ?? ep.number ?? (ep.season == null ? i + 1 : 1),
          released: ep.released ?? null,
        })),
      ),
    [grouped],
  );

  const [active, setActive] = useState<number>(
    () =>
      getViewedSeason(meta.id, seasonStats) ??
      resumeDefaultSeason(meta.id, seasonStats, combinedWatched, resumeSeason),
  );
  const userPickedRef = useRef(false);

  useEffect(() => {
    userPickedRef.current = false;
  }, [meta.id]);

  useEffect(() => {
    if (userPickedRef.current) return;
    setActive(
      getViewedSeason(meta.id, seasonStats) ??
        resumeDefaultSeason(meta.id, seasonStats, combinedWatched, resumeSeason),
    );
  }, [meta.id, seasonStats, combinedWatched, resumeSeason]);

  const reviewsImdbId = imdbId ?? (/^tt\d+$/.test(meta.id) ? meta.id : null);
  const imdbRatings = useEpisodeImdbRatings(
    settings.showEpisodeRating ? reviewsImdbId : null,
    active,
    settings.omdbKey,
  );

  const selectSeason = (season: number) => {
    userPickedRef.current = true;
    setViewedSeason(meta.id, season);
    setActive(season);
  };
  const explorerItems = useMemo(() => {
    const tmdbByNumber = new Map((seasons ?? []).map((season) => [season.seasonNumber, season]));
    return grouped.map((group) => {
      const tmdb = tmdbByNumber.get(group.seasonNumber);
      const name =
        tmdb?.name ??
        (group.seasonNumber === NO_SEASON
          ? t("No Season")
          : group.seasonNumber === 0
            ? t("Specials")
            : t("Season {n}", { n: group.seasonNumber }));
      return {
        key: String(group.seasonNumber),
        seasonNumber: group.seasonNumber >= 0 ? group.seasonNumber : undefined,
        name,
        nameLanguage: tmdb?.nameLanguage,
        isGenericName: tmdb?.isGenericName,
        overview: tmdb?.overview,
        overviewLanguage: tmdb?.overviewLanguage,
        poster: seasonPosters?.[group.seasonNumber],
        count: group.episodes.length,
        year: group.episodes[0]?.released?.slice(0, 4),
      };
    });
  }, [grouped, seasons, seasonPosters, t]);

  const activeEps = grouped.find((g) => g.seasonNumber === active)?.episodes ?? [];

  const watchedAt = (season: number, number: number): boolean => {
    const st = manualWatchedState(meta.id, season, number);
    return (
      st === true || (st === undefined && combinedWatched.has(`${season}:${number}`))
    );
  };

  const progressFor = (g: GridEpisode): Progress => ({
    ratio: 0,
    watched: watchedAt(g.season, g.number),
    startedAt: 0,
  });

  // The grid and the strip read the same model; only the list walks the raw videos, because it
  // shows a description the card layouts would clip away.
  const gridEpisodes = useMemo<GridEpisode[]>(
    () =>
      activeEps.map((ep, i) => {
        const season = episodeSeason(ep);
        const number = episodeNumber(ep, i);
        const stills = ep.thumbnail ? [ep.thumbnail] : [];
        const overview = ep.overview ?? ep.description;
        const airDate = ep.released ?? null;
        const runtime = ep.runtime ?? null;
        return {
          key: `${meta.id}:${season}:${number}`,
          number,
          season,
          title: ep.name || ep.title || t("Episode {n}", { n: number }),
          stills,
          runtime,
          airDate,
          overview,
          upcoming: isUpcomingDate(airDate),
          rating: imdbRatings.get(`${season}:${number}`),
          ratingIsImdb: true,
          reviews: reviewsImdbId ? { imdbId: reviewsImdbId, season, episode: number } : undefined,
          play: (opts) =>
            playLocalAware({
              meta,
              episode: {
                season,
                episode: number,
                videoId: ep.id || undefined,
                runtime: runtime ?? undefined,
                name: ep.name || ep.title || undefined,
                still: stills[0],
                overview,
              },
              opts: {
                autoPlay: settings.instantPlay || settings.seasonSourceLock,
                resume: opts?.resume,
              },
            }),
        };
      }),
    [
      activeEps,
      imdbRatings,
      reviewsImdbId,
      meta,
      t,
      playLocalAware,
      settings.instantPlay,
      settings.seasonSourceLock,
    ],
  );

  // Without any metadata source the shelf can only render placeholders.
  const hasSeasonMetadata =
    !!settings.tvdbKey ||
    !!settings.tmdbKey ||
    !!seasons?.length ||
    !!Object.keys(seasonPosters ?? {}).length;
  const showExplorer =
    settings.tvdbSeasonExplorer !== false &&
    hasSeasonMetadata &&
    grouped.some((group) => group.seasonNumber >= 1);
  const explorer = useSeasonExplorerView({
    metaId: meta.id,
    imdbId,
    tvdbKey: settings.tvdbKey,
    tmdbKey: settings.tmdbKey,
    tmdbTvId,
    seasonPosters,
    titlePoster: meta.poster,
    seasonType: "official",
    lang: effectiveTmdbLanguage(),
    items: explorerItems,
    activeKey: String(active),
    enabled: showExplorer,
    allowProxy: false,
  });
  if (grouped.length === 0) return null;

  return (
    <div data-episodes className="flex scroll-mt-24 flex-col gap-6">
      {showExplorer && (
        <SeasonExplorer
          key={meta.id}
          data={explorer}
          background={meta.background}
          activeKey={String(active)}
          onSelect={(key) => selectSeason(Number(key))}
        />
      )}
      <div className="flex items-end justify-between gap-6">
        <h3 className="text-[22px] font-medium tracking-tight text-ink">{t("Episodes")}</h3>
        <div className="flex items-center gap-3">
          {grouped.length > 1 && (
            <SeasonDropdown
              seasons={grouped.map((g) => g.seasonNumber)}
              items={explorer.items}
              active={active}
              onChange={selectSeason}
            />
          )}
          <EpisodeLayoutToggle
            value={settings.episodeLayout}
            onChange={(v) => update({ episodeLayout: v })}
          />
        </div>
      </div>
      <p className="text-[13px] text-ink-subtle">
        {activeEps.length === 1
          ? t("{n} episode", { n: activeEps.length })
          : t("{n} episodes", { n: activeEps.length })}
      </p>
      <div key={settings.episodeLayout} className="animate-fade-in">
        {settings.episodeLayout === "grid" ? (
          <EpisodeGrid
            meta={meta}
            episodes={gridEpisodes}
            progressFor={progressFor}
            onContextMenu={openWatchedMenu}
          />
        ) : settings.episodeLayout === "strip" ? (
          <DragStrip itemCount={gridEpisodes.length}>
            {gridEpisodes.map((g) => (
              <div
                key={g.key}
                className="shrink-0"
                style={{ width: Math.round(244 * (settings.episodeCardScale || 1)) }}
              >
                <EpisodeGridCard
                  meta={meta}
                  g={g}
                  progress={progressFor(g)}
                  onContextMenu={openWatchedMenu}
                />
              </div>
            ))}
          </DragStrip>
        ) : (
          <div className="flex flex-col gap-1">
            {activeEps.map((ep, i) => {
              const season = episodeSeason(ep);
              const epNumber = episodeNumber(ep, i);
              return (
                <CinemetaEpisodeRow
                  key={ep.id ?? `${ep.season ?? "x"}-${ep.episode ?? i}`}
                  meta={meta}
                  ep={ep}
                  imdbRating={imdbRatings.get(`${season}:${epNumber}`)}
                  reviewsImdbId={reviewsImdbId}
                  flatIndex={ep.season == null ? i + 1 : undefined}
                  watched={watchedAt(season, epNumber)}
                  onContextMenu={openWatchedMenu}
                />
              );
            })}
          </div>
        )}
      </div>
      {watchedMenu && (
        <EpisodeWatchedMenu
          metaId={meta.id}
          meta={{
            type: "series",
            name: meta.name,
            poster: meta.poster,
            background: meta.background,
          }}
          target={watchedMenu}
          imdbId={imdbId}
          allEpisodes={allEpisodesOrdered}
          onClose={() => setWatchedMenu(null)}
        />
      )}
    </div>
  );
}

export function CinemetaEpisodeRow({
  meta,
  ep,
  flatIndex,
  imdbRating,
  reviewsImdbId,
  watched = false,
  onContextMenu,
}: {
  meta: Meta;
  ep: CinemetaVideo;
  flatIndex?: number;
  imdbRating?: number;
  reviewsImdbId?: string | null;
  watched?: boolean;
  onContextMenu?: (e: React.MouseEvent, season: number, episode: number, watched: boolean) => void;
}) {
  const t = useT();
  const playLocalAware = useLocalAwareSeriesPlay();
  const { settings } = useSettings();
  const aired = ep.released ?? ep.firstAired ?? null;
  const epNumber = ep.episode ?? ep.number ?? flatIndex ?? 1;
  const season = ep.season ?? 0;
  const runtime = ep.runtime ?? null;
  const playEpisode = {
    season: ep.season ?? 0,
    episode: epNumber,
    runtime: runtime ?? undefined,
    name: ep.name || ep.title || undefined,
    videoId: ep.id || undefined,
    still: ep.thumbnail || undefined,
    overview: ep.overview ?? ep.description,
  };
  return (
    <div
      data-no-card-ring
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, season, epNumber, watched) : undefined}
      className="group flex items-center gap-4 rounded-lg px-4 py-5 transition-colors hover:bg-elevated/30"
    >
      <button
        onClick={() =>
          playLocalAware({
            meta,
            episode: playEpisode,
            opts: { autoPlay: settings.instantPlay || settings.seasonSourceLock },
          })
        }
        className="flex min-w-0 flex-1 gap-6 text-start"
      >
        <div className="relative w-[200px] shrink-0 overflow-hidden rounded-lg">
          <Poster
            src={ep.thumbnail}
            seed={ep.id ?? `${meta.id}-${ep.season}-${epNumber}`}
            ratio="landscape"
            lazy
          />
          <div className="absolute inset-0 flex items-center justify-center bg-canvas/40 opacity-0 transition-opacity group-hover:opacity-100">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-canvas">
              <Play size={18} fill="currentColor" />
            </div>
          </div>
          {ep.season != null && (
            <span className="absolute start-2 top-2 rounded-md bg-canvas/95 px-1.5 py-0.5 text-[11px] font-semibold text-ink">
              {epNumber}
            </span>
          )}
          {settings.showEpisodeRating && imdbRating != null && imdbRating > 0 && (
            <span className="absolute bottom-2 start-2 flex items-center gap-1.5 rounded-md bg-black/80 px-2 py-1">
              <EpisodeRatingBadge value={imdbRating} isImdb />
            </span>
          )}
          {watched && (
            <span className="absolute end-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-canvas shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
              <Check size={13} strokeWidth={3} />
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h4 className="truncate text-[16px] font-semibold text-ink">
            {ep.name || ep.title || formatAired(aired) || t("Episode {n}", { n: epNumber })}
          </h4>
          <p className="text-[12px] text-ink-subtle">
            {[
              ep.season != null ? `S${ep.season} E${epNumber}` : null,
              runtime ? t("{n} min", { n: runtime }) : null,
              formatAired(aired),
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </p>
          <EpisodeReleaseCountdown date={aired} />
          {(ep.overview ?? ep.description) && (
            <p className="line-clamp-2 text-[13.5px] leading-relaxed text-ink-muted">
              {ep.overview ?? ep.description}
            </p>
          )}
        </div>
      </button>
      {ep.season != null && reviewsImdbId && (
        <EpisodeReviewsButton
          meta={meta}
          seriesImdbId={reviewsImdbId}
          season={season}
          episode={epNumber}
          episodeTitle={ep.name || ep.title || undefined}
        />
      )}
      <EpisodeDownloadButton meta={meta} episode={playEpisode} />
    </div>
  );
}

function SeasonDropdown({
  seasons,
  items,
  active,
  onChange,
}: {
  seasons: number[];
  items: { key: string; name: string; seasonNumber?: number; isGenericName?: boolean }[];
  active: number;
  onChange: (n: number) => void;
}) {
  const t = useT();
  const [menu, setMenu] = useState<{
    right: number;
    top?: number;
    bottom?: number;
    maxH: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = menu != null;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 16;
    const below = window.innerHeight - r.bottom - margin;
    const above = r.top - margin;
    const up = below < 240 && above > below;
    const maxH = Math.max(160, Math.min(0.6 * window.innerHeight, up ? above : below));
    const right = Math.max(margin, window.innerWidth - r.right);
    setMenu(
      up
        ? { right, bottom: window.innerHeight - r.top + 8, maxH }
        : { right, top: r.bottom + 8, maxH },
    );
  };

  const activeItem = items.find((item) => item.key === String(active));
  const activePill = activeItem ? seasonPill(activeItem, t) : null;

  return (
    <>
      <button
        ref={btnRef}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => (menu ? setMenu(null) : openMenu())}
        className="flex h-10 items-center gap-2 rounded-full bg-white/[0.06] ps-4 pe-3 text-[13.5px] font-medium text-ink transition-colors hover:bg-white/[0.10]"
      >
        <span className="max-w-[220px] truncate">{activeItem?.name ?? seasonLabel(t, active)}</span>
        {activePill && (
          <span className="shrink-0 rounded bg-ink/10 px-1.5 py-px text-[10.5px] font-semibold text-ink-muted">
            {activePill}
          </span>
        )}
        <ChevronDown
          size={15}
          className={`text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ right: menu.right, top: menu.top, bottom: menu.bottom }}
            className="animate-fade-in fixed z-[200] w-72 overflow-hidden rounded-lg border border-edge bg-elevated py-1.5 shadow-[0_18px_44px_-12px_rgba(0,0,0,0.6)]"
          >
            <div className="overflow-y-auto" style={{ maxHeight: menu.maxH }}>
              {seasons.map((s) => {
                const isActive = s === active;
                const item = items.find((entry) => entry.key === String(s));
                const pill = item ? seasonPill(item, t) : null;
                return (
                  <button
                    key={s}
                    onClick={() => {
                      onChange(s);
                      setMenu(null);
                    }}
                    className={`flex w-full items-center px-4 py-2.5 text-start text-[13.5px] transition-colors ${
                      isActive
                        ? "bg-ink/10 text-ink"
                        : "text-ink-muted hover:bg-raised hover:text-ink"
                    }`}
                  >
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="truncate">{item?.name ?? seasonLabel(t, s)}</span>
                      {pill && (
                        <span className="w-fit rounded bg-ink/10 px-1.5 py-px text-[10.5px] font-semibold text-ink-muted">
                          {pill}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function seasonLabel(t: Translator, n: number): string {
  if (n === 0) return t("Specials");
  if (n === NO_SEASON) return t("No Season");
  return t("Season {n}", { n });
}

function formatAired(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
