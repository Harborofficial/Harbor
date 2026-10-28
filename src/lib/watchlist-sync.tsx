import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { library } from "@/lib/stremio";
import { fetchWatchlist } from "@/lib/trakt/watchlist";
import type { TraktItem } from "@/lib/trakt/types";
import { useTrakt } from "@/lib/trakt/provider";
import { fetchWatchlist as fetchSimklWatchlist } from "@/lib/simkl/watchlist";
import { useSimkl } from "@/lib/simkl/provider";
import { setWatchlistAggregate } from "@/lib/watchlist";
import { isNuvioProviderActive, resolveNuvioProfileIndex } from "@/lib/nuvio/nuvio-sync";
import { getNuvioAccountId } from "@/lib/nuvio/nuvio-client";
import {
  readCachedNuvioLibrary,
  pullNuvioLibrarySnapshot,
} from "@/lib/nuvio/nuvio-library";

const STORE: { stremio: string[]; nuvio: string[]; trakt: string[]; simkl: string[] } = {
  stremio: [],
  nuvio: [],
  trakt: [],
  simkl: [],
};

function pushAggregate() {
  setWatchlistAggregate([...STORE.stremio, ...STORE.nuvio, ...STORE.trakt, ...STORE.simkl]);
}

export function setStremioAggregate(ids: string[]): void {
  STORE.stremio = ids;
  pushAggregate();
}

export function setNuvioAggregate(ids: string[]): void {
  STORE.nuvio = ids;
  pushAggregate();
}

export async function refreshWatchlistAggregates(
  authKey: string | null,
  traktConnected: boolean,
  simklConnected: boolean,
  isCurrent: () => boolean = () => true,
): Promise<TraktItem[]> {
  const jobs: Array<Promise<void>> = [];
  const nextStore = { ...STORE };
  if (isNuvioProviderActive()) {
    nextStore.stremio = [];
    const slot = resolveNuvioProfileIndex();
    const cached = readCachedNuvioLibrary(slot);
    nextStore.nuvio = cached.map((i) => i.content_id).filter(Boolean);
  } else if (authKey) {
    nextStore.nuvio = [];
    jobs.push(
      library(authKey)
        .then((items) => {
          if (!isCurrent()) return;
          nextStore.stremio = items.filter((i) => !i.removed && !i.temp).map((i) => i._id);
        })
        .catch(() => {}),
    );
  } else {
    nextStore.stremio = [];
    nextStore.nuvio = [];
  }
  let traktItems: TraktItem[] = [];
  if (traktConnected) {
    jobs.push(
      fetchWatchlist()
        .then((items) => {
          if (!isCurrent()) return;
          traktItems = items;
          const ids: string[] = [];
          for (const t of items) {
            if (t.ids.imdb) ids.push(t.ids.imdb);
            if (t.ids.tmdb) {
              ids.push(t.type === "movie" ? `tmdb:movie:${t.ids.tmdb}` : `tmdb:tv:${t.ids.tmdb}`);
            }
          }
          nextStore.trakt = ids;
        })
        .catch(() => {}),
    );
  } else {
    nextStore.trakt = [];
  }
  if (simklConnected) {
    jobs.push(
      fetchSimklWatchlist()
        .then((items) => {
          if (!isCurrent()) return;
          const ids: string[] = [];
          for (const it of items) {
            if (it.ids.imdb) ids.push(it.ids.imdb);
            if (it.ids.tmdb) {
              ids.push(
                it.type === "movie" ? `tmdb:movie:${it.ids.tmdb}` : `tmdb:tv:${it.ids.tmdb}`,
              );
            }
          }
          nextStore.simkl = ids;
        })
        .catch(() => {}),
    );
  } else {
    nextStore.simkl = [];
  }
  await Promise.all(jobs);
  if (isCurrent()) {
    Object.assign(STORE, nextStore);
    pushAggregate();
  }
  return traktItems;
}

export function WatchlistSync() {
  const { authKey } = useAuth();
  const { settings } = useSettings();
  const isNuvio = settings.accountProvider === "nuvio";
  const { isConnected: traktConnected } = useTrakt();
  const { isConnected: simklConnected } = useSimkl();

  useEffect(() => {
    if (isNuvio || !authKey) {
      STORE.stremio = [];
      pushAggregate();
      return;
    }
    let cancelled = false;
    library(authKey)
      .then((items) => {
        if (cancelled) return;
        const ids: string[] = [];
        for (const it of items) {
          if (it.removed || it.temp) continue;
          ids.push(it._id);
        }
        STORE.stremio = ids;
        pushAggregate();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authKey, isNuvio]);

  useEffect(() => {
    if (!traktConnected) {
      STORE.trakt = [];
      pushAggregate();
      return;
    }
    let cancelled = false;
    fetchWatchlist()
      .then((items) => {
        if (cancelled) return;
        const ids: string[] = [];
        for (const t of items) {
          if (t.ids.imdb) ids.push(t.ids.imdb);
          if (t.ids.tmdb) {
            ids.push(t.type === "movie" ? `tmdb:movie:${t.ids.tmdb}` : `tmdb:tv:${t.ids.tmdb}`);
          }
        }
        STORE.trakt = ids;
        pushAggregate();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [traktConnected]);

  useEffect(() => {
    if (!simklConnected) {
      STORE.simkl = [];
      pushAggregate();
      return;
    }
    let cancelled = false;
    fetchSimklWatchlist()
      .then((items) => {
        if (cancelled) return;
        const ids: string[] = [];
        for (const it of items) {
          if (it.ids.imdb) ids.push(it.ids.imdb);
          if (it.ids.tmdb) {
            ids.push(it.type === "movie" ? `tmdb:movie:${it.ids.tmdb}` : `tmdb:tv:${it.ids.tmdb}`);
          }
        }
        STORE.simkl = ids;
        pushAggregate();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [simklConnected]);

  useEffect(() => {
    if (!isNuvio) {
      STORE.nuvio = [];
      pushAggregate();
      return;
    }
    let cancelled = false;
    let requestSeq = 0;
    const updateNuvio = (pullRemote = false) => {
      const seq = ++requestSeq;
      const accountId = getNuvioAccountId();
      const slot = resolveNuvioProfileIndex();
      const items = readCachedNuvioLibrary(slot);
      STORE.nuvio = items.map((i) => i.content_id).filter(Boolean);
      pushAggregate();
      if (pullRemote) {
        void pullNuvioLibrarySnapshot(slot).then((fresh) => {
          if (
            cancelled ||
            seq !== requestSeq ||
            getNuvioAccountId() !== accountId ||
            resolveNuvioProfileIndex() !== slot
          ) return;
          STORE.nuvio = fresh.map((i) => i.content_id).filter(Boolean);
          pushAggregate();
        });
      }
    };
    updateNuvio(true);
    const onProfileOrState = () => updateNuvio(true);
    const onLibraryChange = () => updateNuvio(false);
    const onFocus = () => {
      if (document.visibilityState === "visible") updateNuvio(true);
    };

    window.addEventListener("harbor:nuvio-profile-changed", onProfileOrState);
    window.addEventListener("harbor:nuvio-state-changed", onProfileOrState);
    window.addEventListener("harbor:nuvio-library-changed", onLibraryChange);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") updateNuvio(true);
    }, 8000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("harbor:nuvio-profile-changed", onProfileOrState);
      window.removeEventListener("harbor:nuvio-state-changed", onProfileOrState);
      window.removeEventListener("harbor:nuvio-library-changed", onLibraryChange);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [isNuvio]);

  return null;
}
