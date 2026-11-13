import { undismissCw } from "@/lib/cw-dismiss";
import { useEffect, useRef } from "react";
import { isNuvioSignedIn, loadNuvioState } from "./nuvio-client";
import {
  undismissNextUpInNuvioCloud,
  isNuvioProviderActive,
  markWatchedInNuvio,
  pushWatchProgressToNuvio,
  deleteEpisodeWatchProgressFromNuvio,
  deleteWatchProgressFromNuvio,
  resolveNuvioProfileIndex,
} from "./nuvio-sync";
import { setManualWatched } from "@/lib/manual-watched";
import { setMovieWatchedLocal } from "@/lib/movie-watched";
import { setWatchedFlag } from "@/lib/watched-flag";
import { readActiveProfileIdentity } from "@/lib/profiles";
import { getPlaybackPosition } from "@/lib/player/playback-clock";
import { getWatchedThresholdRatio } from "@/lib/watched-threshold";
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
  const pinnedProfileTargetRef = useRef<number | null>(null);
  const pendingPushRef = useRef<string | null>(null);
  const undismissedRef = useRef<Set<string>>(new Set());

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
      return typeof state.activeProfileIndex === "number" &&
        state.activeProfileIndex >= 1 &&
        state.activeProfileIndex <= 6
        ? state.activeProfileIndex
        : 1;
    }
    const harborProfile = readActiveProfileIdentity()?.id;
    return resolveNuvioProfileIndex(harborProfile);
  };

  // Pin the slot at playback start: switching profiles mid-playback must not
  // redirect this session's progress to another profile.
  const resolvePinnedProfileTarget = () => {
    if (pinnedProfileTargetRef.current == null) {
      pinnedProfileTargetRef.current = getProfileTarget();
    }
    return pinnedProfileTargetRef.current;
  };

  const doPush = async (reason: string) => {
    if (!isNuvioSignedIn() || !isNuvioProviderActive()) return;
    if (isPushingRef.current) {
      // Keep the final flush instead of dropping it behind an in-flight push.
      pendingPushRef.current = reason;
      return;
    }
    const currentSnap = snapRef.current;
    const clockPos = getPlaybackPosition();
    const effectivePos =
      Number.isFinite(clockPos) && clockPos > 0 ? clockPos : currentSnap.positionSec;
    if (currentSnap.durationSec <= 0 || effectivePos < MIN_POSITION_SEC) return;

    const currentSrc = srcRef.current;
    const profileTarget = resolvePinnedProfileTarget();
    if (metaId && !undismissedRef.current.has(metaId)) {
      undismissedRef.current.add(metaId);
      undismissCw(metaId);
      void undismissNextUpInNuvioCloud(profileTarget, metaId)
        .then((ok) => {
          if (!ok) undismissedRef.current.delete(metaId);
        })
        .catch(() => {
          undismissedRef.current.delete(metaId);
        });
    }

    isPushingRef.current = true;
    lastPushedPosRef.current = effectivePos;
    lastPushedTimeRef.current = Date.now();

    const progressPct = effectivePos / currentSnap.durationSec;
    if (progressPct >= getWatchedThresholdRatio()) {
      if (!watchedReportedRef.current) {
        watchedReportedRef.current = true;
        void markWatchedInNuvio(
          profileTarget,
          metaId,
          effSeason,
          effEpisode,
          srcRef.current.meta.name,
        );
        if (effSeason != null && effEpisode != null) {
          setManualWatched(metaId, effSeason, effEpisode, true);
          if (currentSrc.episode?.imdbSeason != null && currentSrc.meta.id !== metaId) {
            setManualWatched(currentSrc.meta.id, effSeason, effEpisode, true);
          }
          void deleteEpisodeWatchProgressFromNuvio(profileTarget, metaId, effSeason, effEpisode);
          if (currentSrc.meta.id !== metaId) {
            void deleteEpisodeWatchProgressFromNuvio(
              profileTarget,
              currentSrc.meta.id,
              effSeason,
              effEpisode,
            );
          }
        } else {
          setMovieWatchedLocal(metaId, true);
          setWatchedFlag(metaId, true);
          void deleteWatchProgressFromNuvio(profileTarget, metaId);
        }
        window.dispatchEvent(new CustomEvent("harbor:continue-watching-updated"));
        window.dispatchEvent(new CustomEvent("harbor:watched-changed"));
        window.dispatchEvent(new CustomEvent("harbor:series-watched-changed"));
      }
      return;
    }

    try {
      await pushWatchProgressToNuvio(
        profileTarget,
        currentSrc.meta.id,
        effectivePos,
        currentSnap.durationSec,
        effSeason,
        effEpisode,
        {
          title: srcRef.current.meta.name,
          name: srcRef.current.meta.name,
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
      const pendingReason = pendingPushRef.current;
      pendingPushRef.current = null;
      if (pendingReason) void doPush(pendingReason);
    }
  };

  useEffect(() => {
    lastPushedPosRef.current = 0;
    lastPushedTimeRef.current = 0;
    watchedReportedRef.current = false;
    pinnedProfileTargetRef.current = null;
    pendingPushRef.current = null;
    undismissedRef.current.clear();
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
      const profileTarget = resolvePinnedProfileTarget();

      if (progressPct >= getWatchedThresholdRatio()) {
        if (!watchedReportedRef.current) {
          watchedReportedRef.current = true;
          void markWatchedInNuvio(
            profileTarget,
            metaId,
            effSeason,
            effEpisode,
            srcRef.current.meta.name,
          );
          if (effSeason != null && effEpisode != null) {
            setManualWatched(metaId, effSeason, effEpisode, true);
            void deleteEpisodeWatchProgressFromNuvio(profileTarget, metaId, effSeason, effEpisode);
          } else {
            setMovieWatchedLocal(metaId, true);
            setWatchedFlag(metaId, true);
            void deleteWatchProgressFromNuvio(profileTarget, metaId);
          }
          window.dispatchEvent(new CustomEvent("harbor:continue-watching-updated"));
          window.dispatchEvent(new CustomEvent("harbor:watched-changed"));
          window.dispatchEvent(new CustomEvent("harbor:series-watched-changed"));
        }
        return;
      }

      const now = Date.now();
      if (
        now - lastPushedTimeRef.current >= TICK_MS &&
        Math.abs(clockPos - lastPushedPosRef.current) >= 2
      ) {
        void doPush("30s-interval");
      }
    }, 1_000);

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
