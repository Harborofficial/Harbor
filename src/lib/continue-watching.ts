import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { anyProfileSharesStremioWith, useProfiles } from "@/lib/profiles";
import { useSettings } from "@/lib/settings";
import { listLocalCw, subscribeLocalCw } from "@/lib/local-cw";
import { setExternalCwSources } from "@/lib/feed/external-cw";
import { useExternalCw } from "@/lib/feed/external-cw";
import {
  ANIME_CLOUD_ID,
  cwMemberViaResume,
  cwSortKey,
  episodeFromVideoId,
  isCwMember,
  library,
  resumeSourceForItem,
  type ExternalCwSource,
  type LibraryItem,
} from "@/lib/stremio";

export type CwCard = {
  id: string;
  type: "movie" | "series";
  name: string;
  poster?: string;
  background?: string;
  season?: number;
  episode?: number;
  videoId?: string;
  progress: number;
  at: number;
};

export function localToLibraryItem(e: ReturnType<typeof listLocalCw>[number]): LibraryItem {
  return {
    _id: e.id,
    type: e.type,
    name: e.name,
    poster: e.poster,
    background: e.background,
    isAnime: e.isAnime,
    external: (e as any).external,
    upNext: e.type === "series" && e.positionMs === 0,
    state: {
      timeOffset: e.positionMs,
      duration: e.durationMs,
      season: e.season,
      episode: e.episode,
      video_id:
        e.videoId ??
        (e.season != null && e.episode != null ? `${e.id}:${e.season}:${e.episode}` : undefined),
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

function episodeOf(i: LibraryItem): { season: number; episode: number } | null {
  const season = i.state?.season;
  const episode = i.state?.episode;
  if (season && episode) return { season, episode };
  const vid = i.state?.video_id ?? "";
  if (/^(kitsu|mal|anilist|anidb):/.test(i._id) && vid.split(":").length === 3) {
    const ep = Number(vid.split(":")[2]);
    return Number.isFinite(ep) && ep > 0 ? { season: 1, episode: ep } : null;
  }
  const parsed = episodeFromVideoId(vid);
  return parsed && parsed.episode > 0 ? parsed : null;
}

function watchedAt(i: LibraryItem): number {
  const lw = i.state?.lastWatched ? Date.parse(i.state.lastWatched) : NaN;
  if (Number.isFinite(lw)) return lw;
  const m = i._mtime ? Date.parse(i._mtime) : NaN;
  return Number.isFinite(m) ? m : 0;
}

function toCard(i: LibraryItem): CwCard {
  const ep = i.type === "movie" ? null : episodeOf(i);
  const duration = i.state?.duration ?? 0;
  const offset = i.state?.timeOffset ?? 0;
  return {
    id: i._id,
    type: i.type === "movie" ? "movie" : "series",
    name: i.name,
    poster: i.poster,
    background: i.background,
    season: ep?.season,
    episode: ep?.episode,
    videoId: i.state?.video_id,
    progress: duration > 0 ? Math.min(1, offset / duration) : 0,
    at: watchedAt(i),
  };
}

const CW_RETRY_DELAYS_MS = [1000, 4000, 10000];
let cwCacheKey: string | null = null;
let cwCacheItems: LibraryItem[] = [];

export function clearCwCache(): void {
  cwCacheKey = null;
  cwCacheItems = [];
}

export function useContinueWatching(excludeId?: string, limit = 12): CwCard[] {
  const { authKey } = useAuth();
  const { settings } = useSettings();
  const { activeProfile, profiles } = useProfiles();
  const isNuvioProvider = settings.accountProvider === "nuvio";
  const hideSharedCw =
    !isNuvioProvider &&
    settings.cwPerProfile &&
    anyProfileSharesStremioWith(activeProfile, profiles);
  const cwSources = settings.cwSources;
  useEffect(() => {
    const mask: { trakt: boolean; simkl: boolean; publicmetadb?: boolean; nuvio?: boolean } = {
      trakt: !!cwSources.trakt,
      simkl: !!cwSources.simkl,
    };
    if (cwSources.publicmetadb !== undefined) mask.publicmetadb = !!cwSources.publicmetadb;
    if (isNuvioProvider) mask.nuvio = true;
    setExternalCwSources(mask);
  }, [cwSources.trakt, cwSources.simkl, cwSources.publicmetadb, isNuvioProvider]);
  const externalCw = useExternalCw(
    Boolean(
      isNuvioProvider ||
        (!hideSharedCw &&
          (cwSources.trakt || cwSources.simkl || cwSources.publicmetadb)),
    ),
  );
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [localVersion, setLocalVersion] = useState(0);

  useEffect(() => {
    if (!authKey) {
      setItems([]);
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    let attempt = 0;
    if (cwCacheKey === authKey && cwCacheItems.length > 0) setItems(cwCacheItems);
    const load = () => {
      library(authKey)
        .then((li) => {
          cwCacheKey = authKey;
          cwCacheItems = li;
          attempt = 0;
          if (!cancelled) setItems(li);
        })
        .catch(() => {
          if (cancelled || attempt >= CW_RETRY_DELAYS_MS.length) return;
          const wait = CW_RETRY_DELAYS_MS[attempt];
          attempt += 1;
          timer = window.setTimeout(load, wait);
        });
    };
    load();
    const retryNow = () => {
      if (cancelled || cwCacheKey === authKey) return;
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
      attempt = 0;
      load();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") retryNow();
    };
    window.addEventListener("online", retryNow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener("online", retryNow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [authKey]);

  useEffect(() => subscribeLocalCw(() => setLocalVersion((v) => v + 1)), []);

  return useMemo(() => {
    void localVersion;
    const isNuvio = settings.accountProvider === "nuvio";
    const disabledSources = new Set<ExternalCwSource>();
    if (!cwSources.simkl) disabledSources.add("simkl");
    if (!cwSources.trakt) disabledSources.add("trakt");
    if (!cwSources.publicmetadb) disabledSources.add("publicmetadb");

    const externalAllowed = externalCw.filter((i) => {
      if (!i.external) return false;
      if (i.external === "nuvio") return true;
      if (disabledSources.has(i.external)) return false;
      if (hideSharedCw) return false;
      if (i.external === "simkl" || i.external === "trakt" || i.external === "publicmetadb") {
        if (i.upNext || i.waitingForAir) return true;
        const offset = i.state?.timeOffset ?? 0;
        const dur = i.state?.duration ?? 0;
        if (offset <= 0 || (i.state?.flaggedWatched ?? 0) > 0) return false;
        if (dur > 0 && offset / dur >= 0.9) return false;
      }
      return true;
    });

    const base = isNuvio
      ? externalAllowed
      : hideSharedCw
        ? []
        : [
            ...(cwSources.library ? items.filter((i) => !ANIME_CLOUD_ID.test(i._id)) : []),
            ...externalAllowed.filter((i) => i.external !== "nuvio"),
          ];
    const local = listLocalCw(hideSharedCw).filter((e) =>
      e.source === "library" ? cwSources.library : cwSources.local,
    );
    const merged = [...base, ...local.map(localToLibraryItem)]
      .filter((i) => {
        if ((i.type as string) === "other" || i._id.startsWith("iptv:")) return false;
        if (!isCwMember(i)) return false;
        // A disabled source's backfilled resume entry must not resurrect library cards.
        if (disabledSources.size > 0 && cwMemberViaResume(i)) {
          const src = resumeSourceForItem(i);
          if (src && disabledSources.has(src)) return false;
        }
        return true;
      })
      .map((i) => ({ i, k: cwSortKey(i) }))
      .sort((a, b) => b.k - a.k)
      .map((e) => e.i);
    const seen = new Set<string>();
    const out: CwCard[] = [];
    for (const i of merged) {
      if (i._id === excludeId || seen.has(i._id)) continue;
      seen.add(i._id);
      out.push(toCard(i));
      if (out.length >= limit) break;
    }
    return out;
  }, [items, externalCw, localVersion, excludeId, limit, hideSharedCw, cwSources, activeProfile?.id]);
}
