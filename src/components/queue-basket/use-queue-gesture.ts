import { useCallback, useEffect, useRef, type PointerEvent, type RefObject } from "react";

export type QueueDragPoint = { row: HTMLLIElement; id: string; x: number; y: number };
type Gesture = QueueDragPoint & {
  kind: "mouse" | "touch";
  pointerId: number;
  active: boolean;
  startX: number;
  startY: number;
};
const HOLD_MS = 350;
const MOVE_PX = 8;

export function useQueueGesture(options: {
  enabled: boolean;
  version: unknown;
  listRef: RefObject<HTMLOListElement | null>;
  start: (point: QueueDragPoint) => void;
  move: (point: QueueDragPoint) => void;
  finish: (point: QueueDragPoint) => void;
  cancel: () => void;
}) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const gesture = useRef<Gesture | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const previous = gesture.current;
    gesture.current = null;
    if (previous?.kind === "mouse" && previous.row.hasPointerCapture(previous.pointerId)) {
      previous.row.releasePointerCapture(previous.pointerId);
    }
    callbacks.current.cancel();
  }, []);

  const interactive = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest("button,a,input,textarea,select,[contenteditable='true']");

  const onPointerDown = (event: PointerEvent<HTMLLIElement>, id: string) => {
    if (
      event.pointerType === "touch" ||
      !event.isPrimary ||
      event.button !== 0 ||
      interactive(event.target)
    )
      return;
    cancel();
    gesture.current = {
      row: event.currentTarget,
      id,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      kind: "mouse",
      pointerId: event.pointerId,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLLIElement>) => {
    const current = gesture.current;
    if (!current || current.kind !== "mouse" || current.pointerId !== event.pointerId) return;
    current.x = event.clientX;
    current.y = event.clientY;
    if (
      !current.active &&
      Math.hypot(current.x - current.startX, current.y - current.startY) >= MOVE_PX
    ) {
      current.active = true;
      callbacks.current.start({ ...current, x: current.startX, y: current.startY });
    }
    if (current.active) {
      event.preventDefault();
      callbacks.current.move(current);
    }
  };
  const onPointerUp = (event: PointerEvent<HTMLLIElement>) => {
    const current = gesture.current;
    if (!current || current.kind !== "mouse" || current.pointerId !== event.pointerId) return;
    if (current.active)
      callbacks.current.finish({ ...current, x: event.clientX, y: event.clientY });
    cancel();
  };
  const onPointerCancel = (event: PointerEvent<HTMLLIElement>) => {
    if (gesture.current?.kind === "mouse" && gesture.current.pointerId === event.pointerId)
      cancel();
  };

  useEffect(() => {
    const list = options.listRef.current;
    if (!options.enabled || !list) return;

    const touchStart = (event: TouchEvent) => {
      cancel();
      if (event.touches.length !== 1 || interactive(event.target)) return;
      const row =
        event.target instanceof Element
          ? event.target.closest<HTMLLIElement>("li[data-queue-item-id]")
          : null;
      if (!row || !list.contains(row) || !row.dataset.queueItemId) return;
      const touch = event.touches[0];
      const pending: Gesture = {
        row,
        id: row.dataset.queueItemId,
        kind: "touch",
        pointerId: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        startX: touch.clientX,
        startY: touch.clientY,
        active: false,
      };
      gesture.current = pending;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (gesture.current !== pending || !row.isConnected) return;
        pending.active = true;
        callbacks.current.start(pending);
      }, HOLD_MS);
    };
    const touchMove = (event: TouchEvent) => {
      const current = gesture.current;
      if (!current || current.kind !== "touch") return;
      const touch = Array.from(event.touches).find(
        (point) => point.identifier === current.pointerId,
      );
      if (!touch || event.touches.length !== 1) {
        cancel();
        return;
      }
      current.x = touch.clientX;
      current.y = touch.clientY;
      if (!current.active) {
        if (Math.hypot(current.x - current.startX, current.y - current.startY) >= MOVE_PX) cancel();
        return;
      }
      // A browser-owned scroll must cancel the drag, never turn into a removal.
      if (!event.cancelable) {
        cancel();
        return;
      }
      event.preventDefault();
      callbacks.current.move(current);
    };
    const touchEnd = (event: TouchEvent) => {
      const current = gesture.current;
      if (!current || current.kind !== "touch") return;
      const touch = Array.from(event.changedTouches).find(
        (point) => point.identifier === current.pointerId,
      );
      if (
        touch &&
        current.active &&
        Math.hypot(touch.clientX - current.startX, touch.clientY - current.startY) >= MOVE_PX
      ) {
        event.preventDefault();
        callbacks.current.finish({ ...current, x: touch.clientX, y: touch.clientY });
      }
      cancel();
    };
    const onScroll = () => {
      if (!gesture.current?.active) cancel();
    };
    // React's delegated touch handlers can be passive; only an activated hold blocks scrolling.
    list.addEventListener("touchstart", touchStart, { passive: true });
    list.addEventListener("touchmove", touchMove, { passive: false });
    list.addEventListener("touchend", touchEnd, { passive: false });
    list.addEventListener("touchcancel", cancel);
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      list.removeEventListener("touchstart", touchStart);
      list.removeEventListener("touchmove", touchMove);
      list.removeEventListener("touchend", touchEnd);
      list.removeEventListener("touchcancel", cancel);
      list.removeEventListener("scroll", onScroll);
      cancel();
    };
  }, [options.enabled, options.version, options.listRef, cancel]);

  return { cancel, onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
