import { Dices } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePosterChain } from "@/components/poster";
import type { Meta } from "@/lib/cinemeta";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import { useView } from "@/lib/view";
import { artAtWidth } from "@/lib/image-rung";
import { useWatchedFlagIds } from "@/lib/watched-flag";
import { useMovieWatchedIds } from "@/lib/movie-watched";
import { externalWatchedIds, subscribeExternalWatched } from "@/lib/feed/external-watched";
import { useAuth } from "@/lib/auth";
import { libraryIfChanged } from "@/lib/stremio";
import { stremioMovieWatched } from "@/lib/stremio-watched";
import { filterSurprisePool } from "./surprise-me-filter";

const EXCLUDE_WATCHED_KEY = "harbor.discover.surprise.hide-watched-movies.v1";

function storedExcludeWatched(): boolean {
  try {
    return localStorage.getItem(EXCLUDE_WATCHED_KEY) === "true";
  } catch {
    return false;
  }
}

function updateExcludeWatched(value: boolean): void {
  try {
    localStorage.setItem(EXCLUDE_WATCHED_KEY, String(value));
  } catch {
    // In private mode, preserve the choice for the current session.
  }
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function SurpriseMe({ pool }: { pool: Meta[] }) {
  const t = useT();
  const { openMeta } = useView();
  const { authKey } = useAuth();
  const { settings } = useSettings();
  const [excludeWatched, setExcludeWatched] = useState(storedExcludeWatched);
  const watchedFlags = useWatchedFlagIds();
  const movieWatched = useMovieWatchedIds();
  const externalWatched = useSyncExternalStore(subscribeExternalWatched, externalWatchedIds);
  const [stremioWatched, setStremioWatched] = useState<Set<string>>(() => new Set());
  const [checkingStremio, setCheckingStremio] = useState(false);
  const lastRef = useRef<string | null>(null);
  const [tiles, setTiles] = useState<Meta[]>([]);

  // Fetch Stremio's watched entries only while the filter is enabled.
  // Discard a previous account's response if the account or profile changes.
  useEffect(() => {
    let cancelled = false;
    setStremioWatched(new Set());
    if (!excludeWatched || settings.accountProvider === "nuvio" || !authKey) {
      setCheckingStremio(false);
      return;
    }
    setCheckingStremio(true);
    void libraryIfChanged(authKey)
      .then((items) => {
        if (cancelled) return;
        setStremioWatched(
          new Set(
            items
              .filter((item) => !item.removed && item.type === "movie" && stremioMovieWatched(item))
              .map((item) => item._id),
          ),
        );
      })
      .catch(() => {
        // Local and tracker watched states remain available while offline.
      })
      .finally(() => {
        if (!cancelled) setCheckingStremio(false);
      });
    return () => {
      cancelled = true;
    };
  }, [excludeWatched, authKey, settings.accountProvider]);

  const eligible = useMemo(
    () =>
      filterSurprisePool(pool, excludeWatched, {
        watchedFlags,
        movieWatched,
        externalWatched,
        stremioWatched,
      }),
    [pool, excludeWatched, watchedFlags, movieWatched, externalWatched, stremioWatched],
  );

  useEffect(() => {
    setTiles(shuffle(eligible).slice(0, 18));
  }, [eligible]);

  const surprise = () => {
    if (!eligible.length || checkingStremio) return;
    let pick = eligible[Math.floor(Math.random() * eligible.length)];
    if (eligible.length > 1) {
      while (pick.id === lastRef.current)
        pick = eligible[Math.floor(Math.random() * eligible.length)];
    }
    lastRef.current = pick.id;
    setTiles(shuffle(eligible).slice(0, 18));
    openMeta(pick);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{t("Can't decide?")}</h2>
        <button
          type="button"
          role="switch"
          aria-checked={excludeWatched}
          aria-label={t("Hide watched movies")}
          onClick={() => {
            const next = !excludeWatched;
            setExcludeWatched(next);
            updateExcludeWatched(next);
          }}
          className="inline-flex items-center gap-2 rounded-lg px-1 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span>{t("Hide watched movies")}</span>
          <span
            aria-hidden="true"
            className={
              "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors " +
              (excludeWatched ? "bg-accent" : "bg-ink/20")
            }
          >
            <span
              className={
                "absolute top-[3px] h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform " +
                (excludeWatched ? "translate-x-[19px]" : "translate-x-[3px]")
              }
            />
          </span>
        </button>
      </div>
      <button
        type="button"
        disabled={eligible.length === 0 || checkingStremio}
        onClick={surprise}
        className="group relative flex min-h-[56px] flex-1 items-center overflow-hidden rounded-2xl ring-1 ring-edge-soft/50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="absolute inset-0 flex">
          {tiles.map((m, i) => (
            <SurpriseTile key={`${m.id}-${i}`} meta={m} />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/85 to-canvas/30" />
        <div className="relative flex items-center gap-3 px-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-canvas shadow-[0_6px_18px_-6px_rgba(0,0,0,0.6)] transition-transform duration-300 group-hover:rotate-[18deg] group-active:scale-90">
            <Dices size={18} strokeWidth={2.2} />
          </span>
          <span className="flex flex-col text-start leading-tight">
            <span className="text-[14px] font-semibold text-ink">{t("Surprise me")}</span>
            <span className="text-[11.5px] text-ink-muted">
              {checkingStremio
                ? t("Checking watched movies...")
                : eligible.length === 0
                  ? excludeWatched
                    ? t("No unwatched titles available")
                    : t("No titles available")
                  : t("Pick a random title")}
            </span>
          </span>
        </div>
      </button>
    </div>
  );
}

function SurpriseTile({ meta }: { meta: Meta }) {
  const { settings } = useSettings();
  const poster = usePosterChain(
    settings.rpdbKey,
    meta.id,
    meta.poster,
    meta.type === "series" ? "series" : "movie",
  );
  return (
    <img
      src={artAtWidth(poster.src, 40)}
      alt=""
      draggable={false}
      loading="lazy"
      onError={poster.onError}
      className="h-full min-w-0 flex-1 object-cover transition-transform duration-700 group-hover:scale-[1.04]"
    />
  );
}
