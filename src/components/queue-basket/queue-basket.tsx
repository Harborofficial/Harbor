import { ListVideo, Play, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useStartQueue } from "@/hooks/use-start-queue";
import { useT } from "@/lib/i18n";
import { queueClear, queueRemove, queueReorder, useQueue, useQueueResumeItem } from "@/lib/queue";
import "./queue-basket.css";
import { useQueueSurface } from "@/hooks/use-queue-surface";
import { QueueClearConfirm } from "./queue-clear-confirm";

export function QueueBasket() {
  const visible = useQueueSurface();

  return visible ? <QueueBasketContent /> : null;
}

function QueueBasketContent() {
  const t = useT();
  const queue = useQueue();
  const resumeItem = useQueueResumeItem();
  const hasStartedQueue = resumeItem !== null;
  const previewPoster = resumeItem?.meta.poster;
  const [failedPoster, setFailedPoster] = useState<string | null>(null);
  const startQueue = useStartQueue();
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const dialogId = useId();
  const hasItems = queue.length > 0;
  const listRef = useRef<HTMLOListElement>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const [dragId, setDragId] = useState<string | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    x: number;
    y: number;
    destination: number | null;
  } | null>(null);
  const scrollFrame = useRef(0);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const dragSlotsRef = useRef<{ id: string; top: number; height: number }[]>([]);

  const cancelDrag = useCallback(() => {
    for (const row of rowRefs.current.values()) {
      row.style.transition = "";
      row.style.transform = "";
    }

    dragSlotsRef.current = [];
    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = 0;
    dragRef.current = null;
    setDragId(null);
  }, []);

  const updateDropPosition = () => {
    const drag = dragRef.current;
    const list = listRef.current;
    const slots = dragSlotsRef.current;
    if (!drag || !list || !slots.length) return;

    const bounds = list.getBoundingClientRect();
    const outside =
      drag.x < bounds.left ||
      drag.x > bounds.right ||
      drag.y < bounds.top ||
      drag.y > bounds.bottom;

    const from = slots.findIndex((slot) => slot.id === drag.id);
    if (from < 0) return;

    let destination: number | null = null;

    if (!outside) {
      const pointerY = drag.y - bounds.top + list.scrollTop;
      const index = slots.findIndex((slot) => pointerY < slot.top + slot.height / 2);
      destination = index < 0 ? slots.length : index;
    }

    drag.destination = destination;

    const next = slots.map((slot) => slot.id);

    if (destination !== null) {
      const insertAt = from < destination ? destination - 1 : destination;
      next.splice(from, 1);
      next.splice(insertAt, 0, drag.id);
    }

    // Compute the new layout using each row's own height.
    const gap = slots.length > 1 ? slots[1].top - slots[0].top - slots[0].height : 0;

    const heights = new Map(slots.map((slot) => [slot.id, slot.height]));
    const nextTops = new Map<string, number>();
    let top = slots[0].top;

    for (const id of next) {
      nextTops.set(id, top);
      top += (heights.get(id) ?? 0) + gap;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    for (const slot of slots) {
      if (slot.id === drag.id) continue;

      const row = rowRefs.current.get(slot.id);
      if (!row) continue;

      const shift = (nextTops.get(slot.id) ?? slot.top) - slot.top;

      row.style.transition = reducedMotion ? "none" : "transform 190ms cubic-bezier(0.2,0.9,0.2,1)";
      row.style.transform = shift ? `translateY(${shift}px)` : "";
    }
  };

  const scrollWhileDragging = () => {
    const drag = dragRef.current;
    const list = listRef.current;
    if (!drag || !list) return;

    const rect = list.getBoundingClientRect();
    const edge = 44;
    let speed = 0;

    if (drag.y < rect.top + edge) {
      speed = -Math.min(12, (rect.top + edge - drag.y) / 3);
    } else if (drag.y > rect.bottom - edge) {
      speed = Math.min(12, (drag.y - rect.bottom + edge) / 3);
    }

    if (speed !== 0) {
      list.scrollTop += speed;
      updateDropPosition();
    }

    scrollFrame.current = requestAnimationFrame(scrollWhileDragging);
  };

  const movePreview = (x: number, y: number) => {
    const preview = dragPreviewRef.current;
    if (!preview) return;

    preview.style.transform =
      `translate3d(${x - dragOffsetRef.current.x}px, ` + `${y - dragOffsetRef.current.y}px, 0)`;

    const bounds = listRef.current?.getBoundingClientRect();
    const outside =
      bounds != null &&
      (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom);

    preview.dataset.outside = outside ? "true" : "false";
  };

  const startDrag = (event: PointerEvent<HTMLLIElement>, id: string) => {
    if (!event.isPrimary || event.button !== 0) return;

    const target = event.target;
    if (target instanceof Element && target.closest("button, a, input, textarea, select")) {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) return;

    event.preventDefault();
    cancelDrag();

    const list = listRef.current;
    if (!list) return;

    const listRect = list.getBoundingClientRect();

    dragSlotsRef.current = queueRef.current.map((item) => {
      const element = rowRefs.current.get(item.id)!;
      const bounds = element.getBoundingClientRect();

      return {
        id: item.id,
        top: bounds.top - listRect.top + list.scrollTop,
        height: bounds.height,
      };
    });

    const row = event.currentTarget;
    const rect = row.getBoundingClientRect();
    const preview = document.createElement("div");
    preview.className = `${row.className} queue-basket-drag-preview`;
    preview.setAttribute("aria-hidden", "true");
    preview.setAttribute("inert", "");

    for (const child of row.childNodes) {
      preview.appendChild(child.cloneNode(true));
    }

    preview.querySelectorAll("[id]").forEach((element) => {
      element.removeAttribute("id");
    });
    preview.querySelectorAll<HTMLElement>("button").forEach((button) => {
      button.style.visibility = "hidden";
    });

    preview.style.width = `${rect.width}px`;
    preview.style.height = `${rect.height}px`;

    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    dragPreviewRef.current = preview;

    // Keep the preview inside the modal's top layer.
    dialog.appendChild(preview);

    row.setPointerCapture(event.pointerId);
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      destination: null,
    };

    movePreview(event.clientX, event.clientY);
    setDragId(id);
    updateDropPosition();
    scrollFrame.current = requestAnimationFrame(scrollWhileDragging);
  };

  const moveDrag = (event: PointerEvent<HTMLLIElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    drag.x = event.clientX;
    drag.y = event.clientY;
    movePreview(event.clientX, event.clientY);
    updateDropPosition();
  };

  const finishDrag = (event: PointerEvent<HTMLLIElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const bounds = listRef.current?.getBoundingClientRect();
    const outside =
      bounds != null &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom);

    drag.x = event.clientX;
    drag.y = event.clientY;
    updateDropPosition();

    const current = queueRef.current;
    const from = current.findIndex((item) => item.id === drag.id);
    const destination = drag.destination;
    const id = drag.id;

    cancelDrag();

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (from < 0 || !bounds) return;

    if (outside) {
      queueRemove(id);
      return;
    }

    if (destination == null) return;

    const insertAt = from < destination ? destination - 1 : destination;
    if (insertAt === from) return;

    const ids = current.map((item) => item.id).filter((itemId) => itemId !== id);
    ids.splice(insertAt, 0, id);
    queueReorder(ids);
  };

  useEffect(() => {
    if (!open || !hasItems) cancelDrag();
  }, [open, hasItems, cancelDrag]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(scrollFrame.current);
      dragPreviewRef.current?.remove();
      dragPreviewRef.current = null;
      dragRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!hasItems) {
      setOpen(false);
      setConfirmClear(false);
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open, hasItems]);

  if (!hasItems) return null;

  const iconButton =
    "flex size-9 shrink-0 items-center justify-center rounded-lg " +
    "text-ink-subtle transition-colors hover:bg-raised hover:text-ink " +
    "disabled:cursor-not-allowed disabled:opacity-30 " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

  return createPortal(
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("Your queue")}
        aria-label={`${t("Your queue")} · ${t("{count} in queue", {
          count: queue.length,
        })}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        className="queue-basket-trigger"
      >
        <span className="queue-basket-trigger-content">
          <span
            className="queue-basket-trigger-poster"
            data-placeholder={!previewPoster || failedPoster === previewPoster}
            aria-hidden="true"
          >
            {previewPoster && failedPoster !== previewPoster ? (
              <img
                key={previewPoster}
                src={previewPoster}
                alt=""
                draggable={false}
                onError={() => setFailedPoster(previewPoster)}
              />
            ) : (
              <ListVideo size={20} />
            )}
          </span>

          <span className="queue-basket-trigger-label">{t("Queue")}</span>

          <span className="queue-basket-count" aria-hidden="true">
            {queue.length}
          </span>
        </span>
      </button>

      <dialog
        ref={dialogRef}
        id={dialogId}
        aria-labelledby={titleId}
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        className="queue-basket-dialog rounded-2xl border border-edge bg-canvas p-0 text-ink shadow-2xl"
      >
        <div className="flex max-h-[min(80dvh,680px)] flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-edge px-5 py-4">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                {t("Your queue")}
              </h2>
              <p className="mt-1 text-sm text-ink-subtle">
                {t("{count} in queue", { count: queue.length })}
              </p>
            </div>
            <button
              type="button"
              autoFocus
              className={iconButton}
              aria-label={t("Close")}
              onClick={() => setOpen(false)}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </header>

          <ol ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {queue.map((item, index) => (
              <li
                key={item.id}
                onPointerDown={(event) => startDrag(event, item.id)}
                onPointerMove={moveDrag}
                onPointerUp={finishDrag}
                onPointerCancel={cancelDrag}
                onLostPointerCapture={cancelDrag}
                ref={(node) => {
                  if (node) rowRefs.current.set(item.id, node);
                  else rowRefs.current.delete(item.id);
                }}
                data-dragging={dragId === item.id || undefined}
                className="queue-basket-row relative flex items-center gap-3 rounded-xl bg-raised p-3 cursor-grab select-none touch-none active:cursor-grabbing"
              >
                <span className="w-5 shrink-0 text-center text-xs text-ink-subtle">
                  {index + 1}
                </span>

                <div className="h-16 w-11 shrink-0 overflow-hidden rounded-md bg-white/5">
                  {item.meta.poster ? (
                    <img
                      src={item.meta.poster}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <ListVideo
                      className="m-auto h-full text-ink-subtle"
                      size={20}
                      aria-hidden="true"
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-semibold">{item.meta.name}</p>
                  {item.episode && (
                    <p className="mt-1 line-clamp-2 text-xs text-ink-subtle">
                      {`S${item.episode.imdbSeason ?? item.episode.season} · E${item.episode.imdbEpisode ?? item.episode.episode}`}
                      {item.episode.name ? ` · ${item.episode.name}` : ""}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  className={iconButton}
                  aria-label={`${t("Remove from queue")}: ${item.meta.name}`}
                  onClick={() => {
                    queueRemove(item.id);
                    if (queue.length > 1) {
                      dialogRef.current?.focus();
                    }
                  }}
                >
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>

          <footer className="flex flex-col gap-2 border-t border-edge p-4">
            <button
              type="button"
              onClick={() => {
                if (startQueue({ resume: hasStartedQueue })) {
                  setOpen(false);
                }
              }}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 font-semibold text-canvas transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Play size={18} fill="currentColor" aria-hidden="true" />
              {hasStartedQueue ? t("Continue your queue") : t("Start your queue")}
            </button>

            <button
              type="button"
              onClick={() => {
                cancelDrag();
                setConfirmClear(true);
              }}
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Trash2 size={16} aria-hidden="true" />
              {t("Clear your queue")}
            </button>
          </footer>
        </div>
      </dialog>
      {confirmClear && (
        <QueueClearConfirm
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            setOpen(false);
            queueClear();
          }}
        />
      )}
    </>,
    document.body,
  );
}
