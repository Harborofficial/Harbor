import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/auth";
import { anyProfileSharesStremioWith, useProfiles } from "@/lib/profiles";
import { isNuvioProviderActive } from "@/lib/active-profile-id";
import type { AddonRow } from "@/lib/addons";
import { loadAnimeAddonRows } from "@/lib/addons-anime-filter";
import { absorbCloudAnimeCw } from "@/lib/anime-cw-absorb";
import { detectAnimeForCw, useDetectedAnimeVersion } from "@/lib/anime-detect";
import { setExternalCwSources, useExternalCw } from "@/lib/feed/external-cw";
import { isCwDismissed, useCwDismissVersion } from "@/lib/cw-dismiss";
import { animeCwIdsVersion, subscribeAnimeCwIds } from "@/lib/anime-cw-ids";
import { dedupeAnimeCw, warmCwAnimeIdentities } from "@/lib/cw-anime-identity";
import { publishResumeStates } from "@/lib/hover-preview/store";
import {
  listLocalCw,
  localCwSourceEnabled,
  localCwVersion,
  subscribeLocalCw,
} from "@/lib/local-cw";
import {
  manualWatchedLibraryItems,
  manualWatchedVersion,
  subscribeManualWatched,
} from "@/lib/manual-watched";
import { useSettings } from "@/lib/settings";
import {
  ANIME_CLOUD_ID,
  cwSortKey,
  isAnimeCwItem,
  isCwMember,
  library,
  type LibraryItem,
} from "@/lib/stremio";

const CW_CAP = 20;
const SETTLE_MS = 150;
const SETTLE_CAP_MS = 650;

export type BpAnimeCwBase = {
  raw: LibraryItem[];
  libItems: LibraryItem[];
  resurfaceLibrary: LibraryItem[];
  addonRows: AddonRow[];
  manualWatchedVer: number;
  animeDetectVer: number;
  ready: boolean;
};

function localItems(
  privateOnly: boolean,
  sources: { library: boolean; local: boolean },
): LibraryItem[] {
  return listLocalCw(privateOnly)
    .filter((e) => localCwSourceEnabled(e, sources))
    .filter((e) => ANIME_CLOUD_ID.test(e.id) || e.isAnime)
    .map((e) => ({
      _id: e.id,
      type: e.type,
      name: e.name,
      poster: e.poster,
      background: e.background,
      isAnime: true,
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
    }));
}

export function useBpAnimeCwBase(): BpAnimeCwBase {
  const { authKey } = useAuth();
  const { settings } = useSettings();
  const { activeProfile, profiles } = useProfiles();
  const isNuvio = settings.accountProvider === "nuvio" || isNuvioProviderActive();
  const hideSharedCw =
    !isNuvio && settings.cwPerProfile && anyProfileSharesStremioWith(activeProfile, profiles);
  const cwVersion = useCwDismissVersion();
  const animeIdsVersion = useSyncExternalStore(subscribeAnimeCwIds, animeCwIdsVersion);
  const animeDetectVer = useDetectedAnimeVersion();
  const { cwSources } = settings;
  useEffect(() => {
    setExternalCwSources({
      trakt: cwSources.trakt,
      simkl: cwSources.simkl,
      publicmetadb: cwSources.publicmetadb,
      ...(isNuvio ? { nuvio: true } : {}),
    });
  }, [cwSources.trakt, cwSources.simkl, cwSources.publicmetadb, isNuvio]);
  const trackerCw = useExternalCw(
    isNuvio || (!hideSharedCw && (cwSources.trakt || cwSources.simkl || cwSources.publicmetadb)),
  );
  const localCwVer = useSyncExternalStore(subscribeLocalCw, localCwVersion);
  const manualWatchedVer = useSyncExternalStore(subscribeManualWatched, manualWatchedVersion);
  const [libItems, setLibItems] = useState<LibraryItem[]>([]);
  const [addonRows, setAddonRows] = useState<AddonRow[]>([]);

  useEffect(() => {
    if (!authKey) {
      setLibItems([]);
      return;
    }
    const load = () => {
      library(authKey)
        .then((li) => {
          setLibItems(li);
          if (!hideSharedCw) absorbCloudAnimeCw(li);
        })
        .catch(() => setLibItems([]));
    };
    load();
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [authKey, hideSharedCw]);

  // Catalogs do not depend on cwPerProfile, so this used to re-sweep every installed
  // addon whenever that toggle moved. Keyed on authKey alone, and the returned canceller
  // is what stops a stale sign-in's rows from landing after a switch.
  useEffect(() => {
    if (!authKey) {
      setAddonRows([]);
      return;
    }
    return loadAnimeAddonRows(authKey, setAddonRows);
  }, [authKey]);

  const localAnimeCw = useMemo<LibraryItem[]>(() => {
    void localCwVer;
    return localItems(hideSharedCw, cwSources);
  }, [localCwVer, hideSharedCw, activeProfile?.id, cwSources]);

  const pool = useMemo(
    () => [
      ...localAnimeCw,
      ...(hideSharedCw || !cwSources.library
        ? []
        : libItems.filter((i) => !ANIME_CLOUD_ID.test(i._id))),
      ...(hideSharedCw
        ? []
        : trackerCw.filter((i) =>
            i.external === "trakt"
              ? cwSources.trakt
              : i.external === "simkl"
                ? cwSources.simkl
                : i.external === "publicmetadb"
                  ? cwSources.publicmetadb
                  : i.external === "nuvio"
                    ? isNuvio
                    : true,
          )),
    ],
    [localAnimeCw, libItems, trackerCw, hideSharedCw, cwSources, isNuvio],
  );

  const raw = useMemo(() => {
    void cwVersion;
    void animeDetectVer;
    void animeIdsVersion;
    const sorted = pool
      .filter((i) => {
        if (!isCwMember(i)) return false;
        if (!i.local && !isAnimeCwItem(i)) return false;
        if (isCwDismissed(i)) return false;
        return true;
      })
      .sort((a, b) => cwSortKey(b) - cwSortKey(a));
    return dedupeAnimeCw(sorted).slice(0, CW_CAP);
  }, [pool, cwVersion, animeDetectVer, animeIdsVersion, hideSharedCw]);

  useEffect(() => {
    void warmCwAnimeIdentities(raw);
  }, [raw]);

  useEffect(() => {
    publishResumeStates(raw);
  }, [raw]);

  useEffect(() => {
    void detectAnimeForCw(libItems);
  }, [libItems]);

  const resurfaceLibrary = useMemo(() => {
    void manualWatchedVer;
    const library = hideSharedCw || !cwSources.library ? [] : libItems;
    const manual = manualWatchedLibraryItems().filter(isAnimeCwItem);
    if (manual.length === 0) return library;
    const memberIds = new Set(library.filter(isCwMember).map((i) => i._id));
    const usable = manual.filter((i) => !memberIds.has(i._id));
    if (usable.length === 0) return library;
    const overrideIds = new Set(usable.map((i) => i._id));
    return [...library.filter((i) => !overrideIds.has(i._id)), ...usable];
  }, [libItems, manualWatchedVer, hideSharedCw, cwSources.library]);

  const sig = raw
    .map((i) => `${i._id}:${i.state?.season ?? ""}:${i.state?.episode ?? ""}`)
    .join("|");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return;
    const settle = window.setTimeout(() => setReady(true), SETTLE_MS);
    return () => window.clearTimeout(settle);
  }, [sig, ready]);
  useEffect(() => {
    const cap = window.setTimeout(() => setReady(true), SETTLE_CAP_MS);
    return () => window.clearTimeout(cap);
  }, []);

  return {
    raw,
    libItems,
    resurfaceLibrary,
    addonRows,
    manualWatchedVer,
    animeDetectVer,
    ready,
  };
}
