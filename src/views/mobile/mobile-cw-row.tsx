import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { Play } from "@/components/icons/play-filled";
import simklLogo from "@/assets/simkl.png";
import traktLogo from "@/assets/trakt.svg";
import type { Meta } from "@/lib/cinemeta";
import { useAuth } from "@/lib/auth";
import { anyProfileSharesStremioWith, useProfiles } from "@/lib/profiles";
import { useHideAnime } from "@/lib/anime-hide";
import { useHeroLogos } from "@/components/anime-hero/use-hero-logos";
import { dismissCw, isCwDismissed, useCwDismissVersion } from "@/lib/cw-dismiss";
import { clearLocalCw, listLocalCw, subscribeLocalCw, type LocalCwEntry } from "@/lib/local-cw";
import { removeExternalCwItem, useExternalCw } from "@/lib/feed/external-cw";
import { isNuvioSignedIn } from "@/lib/nuvio/nuvio-client";
import {
  deleteWatchProgressFromNuvio,
  isNuvioProviderActive,
  resolveNuvioProfileIndex,
} from "@/lib/nuvio/nuvio-sync";
import { clearResume } from "@/lib/player/resume-store";
import { franchiseDedupKey } from "@/lib/providers/jikan";
import { readSnapshot, useSnapshotVersion } from "@/lib/snapshots";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import {
  ANIME_CLOUD_ID,
  cwSortKey,
  episodeFromVideoId,
  isAnimeCwItem,
  isCwMember,
  library,
  libraryMetaType,
  type LibraryItem,
} from "@/lib/stremio";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function localToLibraryItem(e: LocalCwEntry): LibraryItem {
  return {
    _id: e.id,
    type: e.type,
    name: e.name,
    poster: e.poster,
    background: e.background,
    isAnime: e.isAnime,
    state: {
      timeOffset: e.positionMs,
      duration: e.durationMs,
      season: e.season,
      episode: e.episode,
      video_id: e.videoId,
      flaggedWatched: e.durationMs > 0 && e.positionMs / e.durationMs >= 0.9 ? 1 : 0,
      lastWatched: new Date(e.t).toISOString(),
    },
    removed: false,
    temp: false,
    _ctime: new Date(e.t).toISOString(),
    _mtime: new Date(e.t).toISOString(),
    local: true,
  };
}

// listLocalCw() is synchronous while the cloud library is not, so the first
// merge is local-only. Consumers that must not flash a partial list wait on this.
let cwReady = false;
const readySubs = new Set<() => void>();

// The latch is global but items is per mount, so a remount used to arrive with
// ready already true and an empty list, and home rendered the local-only merge
// for a frame before the cloud library landed. Holding the last resolved list
// here means a remount starts correct instead of starting wrong.
let cloudCache: LibraryItem[] = [];
let cloudKey: string | null = null;

function markCwReady(): void {
  if (cwReady) return;
  cwReady = true;
  for (const fn of readySubs) fn();
}

// A different profile has a different library, so the cache cannot answer for
// it and consumers have to wait again rather than show the outgoing profile's.
function resetCwReady(): void {
  if (!cwReady) return;
  cwReady = false;
  for (const fn of readySubs) fn();
}

export function useMobileCwReady(): boolean {
  return useSyncExternalStore(
    (cb) => {
      readySubs.add(cb);
      return () => void readySubs.delete(cb);
    },
    () => cwReady,
    () => cwReady,
  );
}

export function useMobileCw(limit = 14): LibraryItem[] {
  const { authKey } = useAuth();
  const { settings } = useSettings();
  const { activeProfile, profiles } = useProfiles();
  const hideSharedCw =
    settings.cwPerProfile && anyProfileSharesStremioWith(activeProfile, profiles);
  const hideAnime = useHideAnime();
  const isNuvioProvider = settings.accountProvider === "nuvio";
  const externalCw = useExternalCw(
    isNuvioProvider ||
      (!hideSharedCw &&
        (settings.cwSources.trakt || settings.cwSources.simkl || settings.cwSources.publicmetadb)),
  );
  const [items, setItems] = useState<LibraryItem[]>(() =>
    authKey && cloudKey === authKey ? cloudCache : [],
  );
  const [localVersion, setLocalVersion] = useState(0);
  const dismissVersion = useCwDismissVersion();

  useEffect(() => {
    if (!authKey) {
      cloudKey = null;
      cloudCache = [];
      setItems([]);
      markCwReady();
      return;
    }
    if (cloudKey === authKey) setItems(cloudCache);
    else resetCwReady();
    let cancelled = false;
    library(authKey)
      .then((li) => {
        cloudKey = authKey;
        cloudCache = li;
        if (!cancelled) setItems(li);
      })
      .catch(() => {})
      .finally(markCwReady);
    return () => {
      cancelled = true;
    };
  }, [authKey]);

  useEffect(() => subscribeLocalCw(() => setLocalVersion((v) => v + 1)), []);

  return useMemo(() => {
    void localVersion;
    void dismissVersion;
    const disabledSources = new Set<string>();
    if (!settings.cwSources.simkl) disabledSources.add("simkl");
    if (!settings.cwSources.trakt) disabledSources.add("trakt");
    if (!settings.cwSources.publicmetadb) disabledSources.add("publicmetadb");

    const externalAllowed = externalCw.filter((i) => {
      if (!i.external) return false;
      if (i.external === "nuvio") return true;
      if (disabledSources.has(i.external)) return false;
      if (hideSharedCw) return false;
      return true;
    });

    const base = isNuvioProvider
      ? externalAllowed
      : hideSharedCw
        ? []
        : [
            ...items.filter((i) => !ANIME_CLOUD_ID.test(i._id)),
            ...externalAllowed.filter((i) => i.external !== "nuvio"),
          ];
    const merged = [
      ...base,
      ...listLocalCw(isNuvioProvider ? false : hideSharedCw).map((e) =>
        isNuvioProvider ? { ...localToLibraryItem(e), external: "nuvio" as const } : localToLibraryItem(e),
      ),
    ]
      .filter(
        (i) =>
          (i.type as string) !== "other" &&
          !i._id.startsWith("iptv:") &&
          !isCwDismissed(i) &&
          isCwMember(i) &&
          !(hideAnime && isAnimeCwItem(i)),
      )
      .map((i) => ({ i, k: cwSortKey(i) }))
      .sort((a, b) => b.k - a.k)
      .map((e) => e.i);

    const norm = (s: string) => franchiseDedupKey(s);
    const lastWatchedOf = (i: LibraryItem) => {
      const lw = Date.parse(i.state?.lastWatched ?? "");
      if (Number.isFinite(lw) && lw > 0) return lw;
      const m = i._mtime as unknown;
      const mt = typeof m === "number" ? m : Date.parse(String(m ?? ""));
      return Number.isFinite(mt) ? mt : 0;
    };

    const resolveCollision = (held: LibraryItem, incoming: LibraryItem): LibraryItem => {
      const heldIsNuvio = held.external === "nuvio";
      const incIsNuvio = incoming.external === "nuvio";

      if (isNuvioProvider) {
        if (heldIsNuvio && !incIsNuvio) {
          if (lastWatchedOf(incoming) > lastWatchedOf(held)) {
            return {
              ...held,
              state: {
                ...held.state,
                ...incoming.state,
                video_id: incoming.state?.video_id ?? held.state?.video_id,
                season: incoming.state?.season ?? held.state?.season,
                episode: incoming.state?.episode ?? held.state?.episode,
                timeOffset: incoming.state?.timeOffset ?? held.state?.timeOffset,
                duration: incoming.state?.duration ?? held.state?.duration,
                lastWatched: incoming.state?.lastWatched ?? held.state?.lastWatched,
              },
              _mtime: incoming._mtime ?? held._mtime,
            };
          }
          return held;
        }
        if (!heldIsNuvio && incIsNuvio) {
          if (lastWatchedOf(held) > lastWatchedOf(incoming)) {
            return {
              ...incoming,
              state: {
                ...incoming.state,
                ...held.state,
                video_id: held.state?.video_id ?? incoming.state?.video_id,
                season: held.state?.season ?? incoming.state?.season,
                episode: held.state?.episode ?? incoming.state?.episode,
                timeOffset: held.state?.timeOffset ?? incoming.state?.timeOffset,
                duration: held.state?.duration ?? incoming.state?.duration,
                lastWatched: held.state?.lastWatched ?? incoming.state?.lastWatched,
              },
              _mtime: held._mtime ?? incoming._mtime,
            };
          }
          return incoming;
        }
      }

      const heldIsNativeStremio = !held.external && !isNuvioProvider;
      const incIsNativeStremio = !incoming.external && !isNuvioProvider;
      if (heldIsNativeStremio && !incIsNativeStremio) return held;
      if (!heldIsNativeStremio && incIsNativeStremio) return incoming;

      return lastWatchedOf(incoming) > lastWatchedOf(held) ? incoming : held;
    };

    const byId = new Map<string, LibraryItem>();
    const byName = new Map<string, LibraryItem>();
    for (const i of merged) {
      const nm = norm(i.name ?? "");
      const key = `${i.type}:${nm}`;

      const heldById = byId.get(i._id);
      if (heldById) {
        const resolved = resolveCollision(heldById, i);
        byId.set(resolved._id, resolved);
        if (nm) byName.set(key, resolved);
        continue;
      }

      if (nm) {
        const heldByName = byName.get(key);
        if (heldByName) {
          const resolved = resolveCollision(heldByName, i);
          if (resolved._id !== heldByName._id) byId.delete(heldByName._id);
          if (resolved._id !== i._id) byId.delete(i._id);
          byId.set(resolved._id, resolved);
          byName.set(key, resolved);
          continue;
        }
        byName.set(key, i);
      }
      byId.set(i._id, i);
      if (byId.size >= limit) break;
    }
    return [...byId.values()].sort((a, b) => cwSortKey(b) - cwSortKey(a));
  }, [
    items,
    externalCw,
    localVersion,
    dismissVersion,
    limit,
    hideAnime,
    hideSharedCw,
    activeProfile?.id,
    isNuvioProvider,
    settings.cwSources.trakt,
    settings.cwSources.simkl,
    settings.cwSources.publicmetadb,
  ]);
}

function toMeta(item: LibraryItem): Meta {
  return {
    id: item._id,
    type: libraryMetaType(item.type),
    name: item.name,
    poster: item.poster,
    background: item.background,
  };
}

export function MobileCwRow({
  items,
  onOpenDetail,
}: {
  items: LibraryItem[];
  onOpenDetail: (m: Meta) => void;
}) {
  const t = useT();
  const { settings } = useSettings();
  const { authKey } = useAuth();
  useSnapshotVersion();
  const metas = useMemo(() => items.map(toMeta), [items]);
  const logos = useHeroLogos(metas, settings);
  const isNuvioProvider = settings.accountProvider === "nuvio";

  const handleDismiss = useCallback(
    (item: LibraryItem) => {
      const isNuvio =
        isNuvioProvider || item.external === "nuvio" || (isNuvioSignedIn() && isNuvioProviderActive());
      if (isNuvio) {
        const slot = resolveNuvioProfileIndex();
        removeExternalCwItem(item);
        clearLocalCw(item._id, `nuvio-${slot}`);
        clearLocalCw(item._id);
        const se = episodeFromVideoId(item.state?.video_id);
        const season = item.state?.season ?? se?.season;
        const episode = item.state?.episode ?? se?.episode;
        clearResume(item._id, undefined, undefined, `nuvio-${slot}`);
        clearResume(item._id);
        dismissCw(item, authKey);
        void deleteWatchProgressFromNuvio(
          slot,
          item._id,
          undefined,
          season,
          episode,
        );
        return;
      }
      if (item.local) {
        clearLocalCw(item._id);
        dismissCw(item, authKey);
        return;
      }
      dismissCw(item, authKey);
    },
    [isNuvioProvider, authKey],
  );

  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-4 text-[18px] font-semibold tracking-tight text-ink">
        {t("Continue watching")}
      </h2>
      <div className="flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <MobileCwCard
            key={item._id}
            item={item}
            logo={logos[item._id]}
            onOpenDetail={onOpenDetail}
            onDismiss={() => handleDismiss(item)}
          />
        ))}
      </div>
    </section>
  );
}

function MobileCwCard({
  item,
  logo,
  onOpenDetail,
  onDismiss,
}: {
  item: LibraryItem;
  logo?: string;
  onOpenDetail: (m: Meta) => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const meta = toMeta(item);
  const dur = item.state?.duration ?? 0;
  const off = item.state?.timeOffset ?? 0;
  const progress = dur > 0 ? Math.min(1, off / dur) : 0;
  const isExternal = !!item.external && item.external !== "nuvio";
  const remaining = dur > 0 && !isExternal ? formatRemaining(dur - off, t) : "";
  const ep = episodeInfo(item);
  const sub =
    item.type !== "movie" && ep
      ? isAnimeCwItem(item)
        ? t("Ep {episode}", { episode: ep.episode })
        : t("S{season} · E{episode}", { season: ep.season, episode: ep.episode })
      : "";
  const bg = downscaleTmdb(readSnapshot(item._id) ?? item.background ?? item.poster);

  return (
    <div className="w-[260px] shrink-0">
      <div className="relative">
        <button
          type="button"
          onClick={() => onOpenDetail(meta)}
          aria-label={t("View {title}", { title: item.name })}
          className="relative block aspect-[16/9] w-full overflow-hidden rounded-[16px] bg-surface text-start ring-1 ring-edge-soft/50 transition-transform duration-150 active:scale-[0.97]"
        >
          {bg && (
            <img
              src={bg}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover brightness-90"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-black/15" />
          {logo && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-5 pb-7">
              <img
                src={logo}
                alt=""
                loading="lazy"
                decoding="async"
                className="max-h-[50%] w-auto max-w-[76%] object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]"
              />
            </div>
          )}
          <span className="absolute bottom-2.5 start-2.5 flex max-w-[calc(100%-20px)] items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
            {item.external && item.external !== "nuvio" ? (
              <img
                src={item.external === "trakt" ? traktLogo : simklLogo}
                alt=""
                title={item.external === "trakt" ? t("Paused on Trakt") : t("Paused on Simkl")}
                className="h-3.5 w-3.5 shrink-0 rounded-sm"
              />
            ) : (
              <Play size={11} strokeWidth={0} fill="currentColor" className="shrink-0" />
            )}
            {sub ? (
              <>
                <span className="shrink-0">{sub}</span>
                {remaining && (
                  <>
                    <span className="text-white/45">{"·"}</span>
                    <span className="shrink-0 text-white/80">{remaining}</span>
                  </>
                )}
              </>
            ) : (
              <span className="shrink-0">{remaining || t("Resume")}</span>
            )}
          </span>
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25">
            <div className="h-full bg-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          aria-label={t("Remove from Continue watching")}
          className="absolute end-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white/90 backdrop-blur-sm transition-transform duration-150 active:scale-90"
        >
          <X size={17} strokeWidth={2.4} />
        </button>
      </div>
      <button
        type="button"
        onClick={() => onOpenDetail(meta)}
        aria-label={t("View {title}", { title: item.name })}
        className="mt-1.5 line-clamp-1 w-full text-start text-[13px] font-medium text-ink-muted"
      >
        {item.name}
      </button>
    </div>
  );
}

function episodeInfo(i: LibraryItem): { season: number; episode: number } | null {
  if (i.type === "movie") return null;
  const s = i.state?.season;
  const e = i.state?.episode;
  if (s && e) return { season: s, episode: e };
  const vid = i.state?.video_id ?? "";
  if (/^(kitsu|mal|anilist|anidb):/.test(i._id) && vid.split(":").length === 3) {
    const num = Number(vid.split(":")[2]);
    return Number.isFinite(num) && num > 0 ? { season: 1, episode: num } : null;
  }
  const parsed = episodeFromVideoId(vid);
  return parsed && parsed.episode > 0 ? parsed : null;
}

function formatRemaining(ms: number, t: Translate): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return t("{count}m left", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0
    ? t("{count}h left", { count: hours })
    : t("{hours}h {minutes}m left", { hours, minutes: remainder });
}

function downscaleTmdb(url?: string): string | undefined {
  if (!url) return url;
  return url.replace(/\/t\/p\/(original|w1280|w780|w500)\//, "/t/p/w500/");
}
