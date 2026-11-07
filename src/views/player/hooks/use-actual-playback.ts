import { useEffect, useRef } from "react";
import {
  capturePlaybackActor,
  playbackSourceKey,
  recordActualPlayback,
  type ActualPlayback,
} from "@/lib/playback-history";
import { actualPlaybackSnapshot } from "@/lib/player/actual-playback";
import { getPlaybackPosition, subscribePlaybackClock } from "@/lib/player/playback-clock";
import type { PlayerSnapshot } from "@/lib/player/bridge";
import type { PlayerSrc } from "@/lib/view";
import { readRememberedSub, subtitleMediaKey } from "@/lib/subtitles/subtitle-memory";

/** The player, not a menu or a metadata write, owns actual playback recency. */
export function useActualPlayback(src: PlayerSrc, snap: PlayerSnapshot): void {
  const key = `${playbackSourceKey(src)}|${src.meta.id}|${src.episode?.season ?? ""}|${src.episode?.episode ?? ""}`;
  const latest = useRef({ key, src, snap });
  const flush = useRef<() => void>(() => {});
  const loaded = useRef({ key, armed: !snap.firstFrameReady });
  if (loaded.current.key !== key) loaded.current = { key, armed: !snap.firstFrameReady };
  if (!snap.firstFrameReady) loaded.current.armed = true;
  latest.current = { key, src, snap };
  useEffect(() => {
    const session = { id: crypto.randomUUID(), actor: capturePlaybackActor() };
    let last: ActualPlayback | null = null;
    let observedPlaying = false;
    let lastSavedAt = 0;
    let previousPosition = getPlaybackPosition();
    const rememberedSubtitle = () =>
      readRememberedSub(subtitleMediaKey(src.meta.id, src.episode?.season, src.episode?.episode));
    const save = () => {
      const actor = capturePlaybackActor();
      if (
        last &&
        !!actor.privateCw !== !!session.actor.privateCw &&
        actor.profileId === session.actor.profileId &&
        actor.storageProfileId === session.actor.storageProfileId &&
        actor.accountId === session.actor.accountId &&
        actor.provider === session.actor.provider
      ) {
        // A privacy preference does not create another play or transfer its owner.
        session.actor = actor;
        last = { ...last, actor };
      }
      if (last && recordActualPlayback(last)) lastSavedAt = Date.now();
    };
    const saveCurrent = () => {
      const current = latest.current;
      if (last && current.key === key) {
        last =
          actualPlaybackSnapshot(
            current.src,
            current.snap,
            last.positionMs / 1000,
            session,
            last.playedAt,
            rememberedSubtitle(),
          ) ?? last;
      }
      save();
    };
    flush.current = saveCurrent;
    const observe = () => {
      const current = latest.current;
      if (current.key !== key || !loaded.current.armed) return;
      if (current.snap.status === "playing" && current.snap.firstFrameReady) observedPlaying = true;
      if (!observedPlaying) return;
      const position = getPlaybackPosition();
      // Buffer/cache updates share the clock subscription. They are not plays.
      if (position === previousPosition) return;
      previousPosition = position;
      const next = actualPlaybackSnapshot(
        current.src,
        current.snap,
        position,
        session,
        Date.now(),
        rememberedSubtitle(),
      );
      if (!next) return;
      last = next;
      if (!lastSavedAt || Date.now() - lastSavedAt >= 4000) save();
    };
    const unsubscribe = subscribePlaybackClock(observe);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saveCurrent();
    };
    window.addEventListener("pagehide", saveCurrent);
    window.addEventListener("beforeunload", saveCurrent);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", saveCurrent);
      window.removeEventListener("beforeunload", saveCurrent);
      document.removeEventListener("visibilitychange", onVisibility);
      saveCurrent();
    };
  }, [key]);
  useEffect(() => {
    if (snap.status !== "playing") flush.current();
  }, [
    snap.status,
    snap.subtitleTracks,
    snap.audioTracks,
    snap.subDelaySec,
    snap.audioDelaySec,
    snap.subtitleFps,
  ]);
}
