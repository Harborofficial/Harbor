import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { HOLD_SPEED_DELAY_MS, holdSpeedRate } from "@/lib/player/hold-speed";

/**
 * Press-and-hold on the video surface for a second playback rate.
 *
 * The surface that receives the press owns these handlers: the video mount
 * sits under the click stage and never sees a pointer event, so a handler
 * bound there would be unreachable. Releasing after a hold restores the old
 * rate, and the surface asks consumeClick() before running its own click
 * action so the release does not also toggle playback.
 */
export type HoldSpeed = {
  active: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Drop a press in progress, e.g. when the same gesture starts a window drag. */
  cancel: () => void;
  /** True only for the click that ends a hold, then cleared. */
  consumeClick: () => boolean;
};

export function useHoldSpeed(params: {
  enabled: boolean;
  getRate: () => number;
  canEngage: () => boolean;
  setRate: (rate: number) => void;
}): HoldSpeed {
  const latest = useRef(params);
  latest.current = params;

  const [active, setActive] = useState(false);
  const hold = useRef<{
    pointerId: number | null;
    timer: number | null;
    engaged: boolean;
    baseRate: number;
  }>({ pointerId: null, timer: null, engaged: false, baseRate: 1 });
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);

  const release = useCallback((suppressClick: boolean) => {
    const h = hold.current;
    if (h.pointerId == null) return;
    if (h.timer != null) {
      window.clearTimeout(h.timer);
      h.timer = null;
    }
    const wasEngaged = h.engaged;
    h.pointerId = null;
    h.engaged = false;
    if (!wasEngaged) return;

    latest.current.setRate(h.baseRate);
    setActive(false);
    if (!suppressClick) return;

    suppressClickRef.current = true;
    if (suppressTimerRef.current != null) window.clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      suppressTimerRef.current = null;
    }, 0);
  }, []);

  const cancel = useCallback(() => release(false), [release]);

  const consumeClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    if (suppressTimerRef.current != null) {
      window.clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
    return true;
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (!latest.current.enabled) return;
    if (event.pointerType !== "mouse" || !event.isPrimary || event.button !== 0) return;

    const h = hold.current;
    if (h.pointerId != null) return;

    const pointerId = event.pointerId;
    const surface = event.currentTarget;
    h.pointerId = pointerId;
    h.baseRate = latest.current.getRate();
    h.timer = window.setTimeout(() => {
      h.timer = null;
      if (h.pointerId !== pointerId || !latest.current.canEngage()) return;
      h.engaged = true;
      try {
        surface.setPointerCapture(pointerId);
      } catch {
        h.pointerId = null;
        h.engaged = false;
        return;
      }
      setActive(true);
      latest.current.setRate(holdSpeedRate(h.baseRate));
    }, HOLD_SPEED_DELAY_MS);
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (hold.current.pointerId !== event.pointerId) return;
      release(true);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [release],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (hold.current.pointerId === event.pointerId) release(false);
    },
    [release],
  );

  const onLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (hold.current.pointerId === event.pointerId) release(false);
    },
    [release],
  );

  // A release outside the surface, or a window losing focus mid-press, must
  // still restore the rate; leaving playback stuck at 2x is the worst outcome.
  useEffect(() => {
    const clear = (event: PointerEvent) => {
      if (hold.current.pointerId !== event.pointerId) return;
      release(false);
    };
    const onBlur = () => {
      if (hold.current.pointerId != null) release(false);
    };
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
      window.removeEventListener("blur", onBlur);
    };
  }, [release]);

  useEffect(() => {
    if (!params.enabled) release(false);
  }, [params.enabled, release]);

  useEffect(() => {
    const h = hold.current;
    return () => {
      if (h.timer != null) window.clearTimeout(h.timer);
      if (h.engaged) latest.current.setRate(h.baseRate);
      h.pointerId = null;
      h.timer = null;
      h.engaged = false;
      if (suppressTimerRef.current != null) window.clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
      suppressClickRef.current = false;
    };
  }, []);

  return {
    active,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    cancel,
    consumeClick,
  };
}
