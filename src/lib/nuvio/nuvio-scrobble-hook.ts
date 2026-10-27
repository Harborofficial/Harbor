import { useEffect, useRef } from "react";
import { isNuvioSignedIn, loadNuvioState } from "./nuvio-client";
import { isNuvioProviderActive, markWatchedInNuvio, pushWatchProgressToNuvio, resolveNuvioProfileIndex } from "./nuvio-sync";
import { readActiveProfileIdentity } from "@/lib/profiles";
import { getPlaybackPosition } from "@/lib/player/playback-clock";
import type { PlayerSrc } from "@/lib/view";

const MIN_POSITION_SEC = 6;
const TICK_MS = 30_000;

type Snap = {
  status: string;
  positionSec: number;
  durationSec: number;
};

export function useNuvioScrobble({
  src,
  snap,
  season,
  episode,
}: {
  src: PlayerSrc;
  snap: Snap;
  season?: number;
  episode?: number;
}): void {
  const lastPushedPosRef = useRef<number>(0);
  const lastPushedTimeRef = useRef<number>(0);
  const watchedReportedRef = useRef<boolean>(false);
  const isPushingRef = useRef<boolean>(false);

  const snapRef = useRef(snap);
  snapRef.current = snap;

  const srcRef = useRef(src);
  srcRef.current = src;

  const metaId = src.meta.id;
  const effSeason = typeof season === "number" ? season : src.episode?.season;
  const effEpisode = typeof episode === "number" ? episode : src.episode?.episode;

  const getProfileTarget = () => {
    if (isNuvioSignedIn()) {
      const state = loadNuvioState();
      return typeof state.activeProfileIndex === "number" && state.activeProfileIndex >= 1 && state.activeProfileIndex <= 6
        ? state.activeProfileIndex
        : 1;
    }
    const harborProfile = readActiveProfileIdentity()?.id;
    return resolveNuvioProfileIndex(harborProfile);
  };

  const doPush = async (reason: string) => {
    if (!isNuvioSignedIn() || !isNuvioProviderActive() || isPushingRef.current) return;
    const currentSnap = snapRef.current;
    const clockPos = getPlaybackPosition();
    const effectivePos = Number.isFinite(clockPos) && clockPos > 0 ? clockPos : currentSnap.positionSec;
    if (currentSnap.durationSec <= 0 || effectivePos < MIN_POSITION_SEC) return;

    const currentSrc = srcRef.current;
    const profileTarget = getProfileTarget();

    isPushingRef.current = true;
    lastPushedPosRef.current = effectivePos;
    lastPushedTimeRef.current = Date.now();

    try {
      await pushWatchProgressToNuvio(
        profileTarget,
        currentSrc.meta.id,
        effectivePos,
        currentSnap.durationSec,
        effSeason,
        effEpisode,
        {
          title: currentSrc.meta.name,
          name: currentSrc.meta.name,
          poster: currentSrc.meta.poster,
          background: currentSrc.meta.background,
        },
      );
      window.dispatchEvent(
        new CustomEvent("harbor:nuvio-progress-pushed", {
          detail: { profileIndex: profileTarget },
        }),
      );
    } catch (err) {
      console.warn(`[nuvio-scrobble] push failed (${reason})`, err);
    } finally {
      isPushingRef.current = false;
    }
  };

  useEffect(() => {
    lastPushedPosRef.current = 0;
    lastPushedTimeRef.current = 0;
    watchedReportedRef.current = false;
  }, [metaId, effSeason, effEpisode]);

  // Active playback interval checking clock position directly (since snap.positionSec doesn't rerender every second)
  useEffect(() => {
    if (!isNuvioSignedIn() || !isNuvioProviderActive()) return;
    if (snap.status !== "playing") return;

    const id = window.setInterval(() => {
      const clockPos = getPlaybackPosition();
      if (!Number.isFinite(clockPos) || clockPos < MIN_POSITION_SEC) return;
      const curSnap = snapRef.current;
      if (curSnap.durationSec <= 0) return;

      const progressPct = clockPos / curSnap.durationSec;
      const profileTarget = getProfileTarget();

      if (progressPct >= 0.9 && !watchedReportedRef.current) {
        watchedReportedRef.current = true;
        void markWatchedInNuvio(profileTarget, metaId, effSeason, effEpisode);
      }





      if (Math.abs(clockPos - lastPushedPosRef.current) >= 2) {
        void doPush("30s-interval");

      }
    }, TICK_MS);

    return () => window.clearInterval(id);
  }, [snap.status, metaId, effSeason, effEpisode]);

  // Immediate flush on pause
  useEffect(() => {
    if (!isNuvioSignedIn() || !isNuvioProviderActive()) return;
    if (snap.status === "paused") {
      const clockPos = getPlaybackPosition();
      if (clockPos >= MIN_POSITION_SEC && Math.abs(clockPos - lastPushedPosRef.current) >= 1) {
        void doPush("pause");
      }
    }
  }, [snap.status]);

  // Flush on unmount, pagehide, and beforeunload
  useEffect(() => {
    if (!isNuvioSignedIn() || !isNuvioProviderActive()) return;
    const handleUnload = () => {
      void doPush("unload");
    };

    window.addEventListener("pagehide", handleUnload);
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      window.removeEventListener("pagehide", handleUnload);
      window.removeEventListener("beforeunload", handleUnload);
      void doPush("unmount").finally(() => {
        window.dispatchEvent(new CustomEvent("harbor:playback-session-ended"));
      });
    };
  }, [metaId, effSeason, effEpisode]);
}
