import type { HoldSpeed } from "./hooks/use-hold-speed";

export function DragClickStage(props: {
  drawMode: boolean;
  pipMode: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onWheelVolume?: (deltaY: number) => void;
  holdSpeed?: HoldSpeed;
}) {
  const { drawMode, pipMode, onClick, onDoubleClick, onWheelVolume, holdSpeed } = props;
  return (
    <div
      data-player-click-stage
      className="pointer-events-auto absolute inset-0 z-[3]"
      onWheel={(e) => {
        if (drawMode || pipMode) return;
        if (e.ctrlKey || e.metaKey) return;
        onWheelVolume?.(e.deltaY);
      }}
      onPointerDown={holdSpeed?.onPointerDown}
      onPointerUp={holdSpeed?.onPointerUp}
      onPointerCancel={holdSpeed?.onPointerCancel}
      onLostPointerCapture={holdSpeed?.onLostPointerCapture}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (drawMode || pipMode) return;
        if (e.button !== 0) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const startTime = Date.now();
        let dragStarted = false;
        const onMove = (ev: MouseEvent) => {
          if (dragStarted) return;
          if (Date.now() - startTime < 150) return;
          const dx = Math.abs(ev.clientX - startX);
          const dy = Math.abs(ev.clientY - startY);
          if (dx > 8 || dy > 8) {
            dragStarted = true;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            // The pressure that started a window drag is not a speed hold.
            holdSpeed?.cancel();
            import("@tauri-apps/api/window")
              .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
              .catch(() => {});
          }
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          if (!dragStarted && !holdSpeed?.consumeClick()) onClick();
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (drawMode || pipMode) return;
        onDoubleClick();
      }}
    />
  );
}
