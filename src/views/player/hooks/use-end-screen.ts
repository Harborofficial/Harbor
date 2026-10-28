import { useCallback, useEffect, useRef, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import type { PlayerSnapshot } from "@/lib/player/bridge";
import { getPlaybackPosition, subscribePlaybackClock } from "@/lib/player/playback-clock";
import { isNaturalEnd } from "@/lib/player/playback-end";
import { loadMoreLikeThis } from "@/lib/recommendations";
import type { PlayerSrc } from "@/lib/view";
import { isFinalSeriesEpisode } from "@/lib/player/series-finale";
import { animeSeriesFromStreamId } from "@/lib/series-episodes";
import { endScreenArt, warmEndScreenArt } from "@/lib/player/end-screen-art";

/** Short stubs and clips should never get a recommendation screen. */
const MIN_DURATION_SEC = 90;

export type EndScreenMode = "full" | "shrink";

export type EndScreenState = {
  open: boolean;
  mode: EndScreenMode;
  items: Meta[];
  focused: number;
  countdown: number | null;
  countdownTotal: number;
  focus: (index: number) => void;
  interact: () => void;
  dismiss: () => void;
};

export function useEndScreen(params: {
  src: PlayerSrc;
  snap: PlayerSnapshot;
  enabled: boolean;
  leadSec: number;
  countdownSec: number;
  onZero: "close" | "play";
  tmdbKey: string | null;
  isLive: boolean;
  onPlay: (meta: Meta) => void;
  onClose: () => void;
}): EndScreenState {
  const { src, snap, enabled, leadSec, countdownSec, onZero, tmdbKey, isLive, onPlay, onClose } =
    params;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<EndScreenMode>("full");
  const [items, setItems] = useState<Meta[]>([]);
  const [preparedUrl, setPreparedUrl] = useState<string | null>(null);
  const [focused, setFocused] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const firedEarlyRef = useRef<string | null>(null);
  const firedEndRef = useRef<string | null>(null);
  const earlySinceRef = useRef(0);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const [seriesEnd, setSeriesEnd] = useState<{ src: PlayerSrc; final: boolean } | null>(null);
  const episodic = src.meta.type === "series" || src.episode != null;
  const eligible = !episodic || (seriesEnd?.src === src && seriesEnd.final);

  useEffect(() => {
    if (!episodic || !src.episode) return;
    let alive = true;
    void isFinalSeriesEpisode(
      src.meta,
      {
        ...src.episode,
        episode: src.episodeEnd ?? src.episode.episode,
      },
      { tmdbKey: tmdbKey ?? "", isAnime: src.isAnime },
    )
      .catch(() => false)
      .then((final) => {
        if (alive) setSeriesEnd({ src, final });
      });
    return () => {
      alive = false;
    };
  }, [src, episodic, tmdbKey]);

  // Latest callbacks/mode without making the load effect depend on them.
  const latest = useRef({ mode, items, focused, onPlay, onClose });
  latest.current = { mode, items, focused, onPlay, onClose };

  // A new stream starts a new attempt.
  useEffect(() => {
    firedEarlyRef.current = null;
    firedEndRef.current = null;
    earlySinceRef.current = 0;
    setOpen(false);
    setItems([]);
    setPreparedUrl(null);
    setFocused(0);
    setCountdown(null);
  }, [src.url]);

  // Changing the lead time re-arms the early card even if it was dismissed.
  useEffect(() => {
    firedEarlyRef.current = null;
    earlySinceRef.current = 0;
  }, [leadSec]);

  // Series must reach their final catalog episode across every season first.
  //
  // The clock is watched through a plain subscription: this lives in the player
  // view, and subscribing React to the 100 ms clock would redraw the whole player.
  useEffect(() => {
    if (!enabled || !eligible || open || isLive || leadSec === 0 || preparedUrl !== src.url) return;
    if (snap.durationSec < MIN_DURATION_SEC) return;

    const evaluate = () => {
      const current = snapRef.current;
      if (current.durationSec < MIN_DURATION_SEC) return;
      const duration = current.durationSec;
      const position = getPlaybackPosition();

      // Back near the start means a replay or a start-over; arm the card again.
      if (position > 0 && position < 30) {
        firedEarlyRef.current = null;
        firedEndRef.current = null;
      }

      const natural = isNaturalEnd(current, position);
      const ended = current.status !== "playing" && position >= duration - 1;
      if (natural || ended) {
        if (firedEndRef.current === src.url) return;
        firedEndRef.current = src.url;
        if (items.length === 0) {
          latest.current.onClose();
          return;
        }
        setMode("full");
        setOpen(true);
        return;
      }

      // A lead longer than the film itself can never reach its mark.
      if (leadSec <= 0 || leadSec >= duration) return;
      if (items.length === 0) return;
      const windowStart = duration - leadSec;
      if (position < windowStart) {
        earlySinceRef.current = 0;
        return;
      }
      // A replay flashes the old near-end position for a moment before it seeks
      // back to the start. Require the window to hold before acting on it.
      if (earlySinceRef.current === 0) earlySinceRef.current = Date.now();
      if (Date.now() - earlySinceRef.current < 1500) return;
      if (firedEarlyRef.current === src.url) return;
      firedEarlyRef.current = src.url;
      setMode("shrink");
      setOpen(true);
    };

    evaluate();
    return subscribePlaybackClock(evaluate);
  }, [
    eligible,
    enabled,
    isLive,
    leadSec,
    open,
    snap.durationSec,
    src.url,
    preparedUrl,
    items.length,
  ]);

  // The film can reach its end while the early screen is up; at that point the
  // mini player no longer has anything to show, so the card goes full-screen.
  useEffect(() => {
    if (!open || mode !== "shrink") return;
    if (!isNaturalEnd(snap, getPlaybackPosition())) return;
    setMode("full");
  }, [mode, open, snap]);

  // Starting over (or replaying) while the card is up means the user is
  // watching again; step aside instead of leaving them stuck on the card.
  useEffect(() => {
    if (!open) return;
    const check = () => {
      const current = snapRef.current;
      if (current.durationSec <= 0) return;
      const position = getPlaybackPosition();
      if (position > 0 && position < 30) {
        setOpen(false);
        setCountdown(null);
      }
    };
    return subscribePlaybackClock(check);
  }, [open]);

  // Prepare cards while playback continues, before shrinking the player.
  useEffect(() => {
    if (!enabled || !eligible || isLive || leadSec === 0 || snap.durationSec < MIN_DURATION_SEC)
      return;
    let alive = true;
    setPreparedUrl(null);
    const animeId = animeSeriesFromStreamId(src.episode?.kitsuStreamId);
    const recommendationMeta = animeId ? { ...src.meta, id: animeId } : src.meta;
    void loadMoreLikeThis(recommendationMeta, tmdbKey)
      .catch(() => [])
      .then(async (list) => {
        if (!alive) return;
        await warmEndScreenArt([
          endScreenArt(src.meta.background),
          endScreenArt(src.meta.poster),
          ...list.map((item) => endScreenArt(item.background ?? item.poster)),
        ]);
        if (!alive) return;
        setItems(list);
        setFocused(0);
        setPreparedUrl(src.url);
      });
    return () => {
      alive = false;
    };
  }, [
    enabled,
    eligible,
    isLive,
    leadSec === 0,
    snap.durationSec >= MIN_DURATION_SEC,
    src.url,
    src.meta,
    src.episode?.kitsuStreamId,
    tmdbKey,
  ]);

  // Countdown. Any interaction cancels it for the rest of this screen.
  useEffect(() => {
    if (!open || countdownSec <= 0) {
      setCountdown(null);
      return;
    }
    setCountdown(countdownSec);
    const id = window.setInterval(() => {
      setCountdown((value) => (value == null ? null : Math.max(0, value - 1)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [open, countdownSec]);

  useEffect(() => {
    if (!open || countdown !== 0) return;
    const {
      mode: currentMode,
      items: list,
      focused: index,
      onPlay: play,
      onClose: close,
    } = latest.current;
    if (onZero === "play" && list[index]) {
      play(list[index]);
      return;
    }
    // Closing the player is only safe once the film has actually finished.
    // In the early layout the card steps aside and playback keeps going.
    if (currentMode === "full") close();
    else {
      setOpen(false);
      setCountdown(null);
    }
  }, [countdown, onZero, open]);

  const focus = useCallback((index: number) => setFocused(index), []);
  const interact = useCallback(() => setCountdown(null), []);
  const dismiss = useCallback(() => {
    setOpen(false);
    setCountdown(null);
  }, []);

  return {
    open,
    mode,
    items,
    focused,
    countdown,
    countdownTotal: countdownSec,
    focus,
    interact,
    dismiss,
  };
}
