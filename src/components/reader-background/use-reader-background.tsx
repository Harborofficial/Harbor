import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import type { ContextAction } from "@/lib/context-actions";
import { useContextMenuActions } from "@/lib/context-menu";
import { useT } from "@/lib/i18n";
import {
  optimizeBackgroundForShare,
  processBackgroundImage,
} from "@/views/settings/theme-panel/image-utils";
import {
  loadReaderBackground,
  removeReaderBackground,
  saveReaderBackground,
} from "./reader-background-store";

export type ReaderBackgroundOptions = {
  imageKey: string;
  transformKey: string;
  idPrefix: string;
};

export type ReaderBackgroundTransform = {
  zoom: number;
  x: number;
  y: number;
};

const DEFAULT_TRANSFORM: ReaderBackgroundTransform = { zoom: 1, x: 50, y: 50 };

export function readerBackgroundStyle(
  image: string,
  transform: ReaderBackgroundTransform,
): CSSProperties {
  return {
    backgroundImage: `url(${JSON.stringify(image)})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    transform: `translate(${(transform.x - 50) * (transform.zoom - 1)}%, ${
      (transform.y - 50) * (transform.zoom - 1)
    }%) scale(${transform.zoom})`,
    transformOrigin: "center",
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function loadTransform(key: string): ReaderBackgroundTransform {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_TRANSFORM;
    const value = JSON.parse(raw) as Partial<ReaderBackgroundTransform> | null;
    return {
      zoom: clamp(finite(value?.zoom, DEFAULT_TRANSFORM.zoom), 1, 2.5),
      x: clamp(finite(value?.x, DEFAULT_TRANSFORM.x), 0, 100),
      y: clamp(finite(value?.y, DEFAULT_TRANSFORM.y), 0, 100),
    };
  } catch {
    return DEFAULT_TRANSFORM;
  }
}

export function useReaderBackground({ imageKey, transformKey, idPrefix }: ReaderBackgroundOptions) {
  const t = useT();
  const menu = useContextMenuActions();
  const [image, setImage] = useState<string | null>(null);
  const [transform, setTransform] = useState(() => loadTransform(transformKey));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const loadSequence = useRef(0);

  useEffect(() => {
    const sequence = ++loadSequence.current;
    let alive = true;
    void loadReaderBackground(imageKey).then((stored) => {
      if (alive && loadSequence.current === sequence) setImage(stored);
    });
    return () => {
      alive = false;
    };
  }, [imageKey]);

  const updateTransform = (
    patch:
      | Partial<ReaderBackgroundTransform>
      | ((current: ReaderBackgroundTransform) => Partial<ReaderBackgroundTransform>),
  ) => {
    setTransform((current) => {
      const next = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
      try {
        localStorage.setItem(transformKey, JSON.stringify(next));
      } catch {
        // The image is already stored; losing the crop preference is not fatal.
      }
      return next;
    });
  };

  const resetTransform = () => {
    setTransform(DEFAULT_TRANSFORM);
    try {
      localStorage.removeItem(transformKey);
    } catch {
      // The image is already gone; ignore transform cleanup failures.
    }
  };

  const save = async (value: string | null) => {
    loadSequence.current++;
    try {
      if (value) await saveReaderBackground(imageKey, value);
      else await removeReaderBackground(imageKey);
      if (!value) resetTransform();
      setImage(value);
      setError(null);
    } catch {
      setError(
        t(
          "Couldn't save that background. Reader background storage is full. Try a smaller image or clear cached data.",
        ),
      );
    }
  };

  const choose = () => {
    if (!pending.current) input.current?.click();
  };

  const importImage = async (file: File | undefined) => {
    if (!file || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const data = await processBackgroundImage(file);
      if (!data?.startsWith("data:image/")) throw new Error("Invalid image");
      // Validate even small files before replacing a working background.
      const preview = new Image();
      preview.src = data;
      await preview.decode();
      await save(await optimizeBackgroundForShare(data));
    } catch {
      setError(t("Couldn't read that image. Try a different file."));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const actions = (): ContextAction[] => [
    {
      id: `${idPrefix}-background-change`,
      label: t("Change background"),
      disabled: pending.current,
      run: choose,
    },
    ...(image
      ? [
          {
            id: `${idPrefix}-background-resize`,
            label: t("Resize & move"),
            children: [
              {
                id: `${idPrefix}-background-zoom-in`,
                label: t("Zoom in"),
                group: "zoom",
                dismiss: "keep-open" as const,
                repeatable: true,
                run: () =>
                  updateTransform((current) => ({
                    zoom: clamp(current.zoom + 0.1, 1, 2.5),
                  })),
              },
              {
                id: `${idPrefix}-background-zoom-out`,
                label: t("Zoom out"),
                group: "zoom",
                dismiss: "keep-open" as const,
                repeatable: true,
                run: () =>
                  updateTransform((current) => ({
                    zoom: clamp(current.zoom - 0.1, 1, 2.5),
                  })),
              },
              {
                id: `${idPrefix}-background-move-left`,
                label: t("Move left"),
                group: "move",
                dismiss: "keep-open" as const,
                repeatable: true,
                run: () =>
                  updateTransform((current) => ({
                    zoom: Math.max(current.zoom, 1.1),
                    x: clamp(current.x - 20, 0, 100),
                  })),
              },
              {
                id: `${idPrefix}-background-move-right`,
                label: t("Move right"),
                group: "move",
                dismiss: "keep-open" as const,
                repeatable: true,
                run: () =>
                  updateTransform((current) => ({
                    zoom: Math.max(current.zoom, 1.1),
                    x: clamp(current.x + 20, 0, 100),
                  })),
              },
              {
                id: `${idPrefix}-background-move-up`,
                label: t("Move up"),
                group: "move",
                dismiss: "keep-open" as const,
                repeatable: true,
                run: () => updateTransform((current) => ({ y: clamp(current.y - 5, 0, 100) })),
              },
              {
                id: `${idPrefix}-background-move-down`,
                label: t("Move down"),
                group: "move",
                dismiss: "keep-open" as const,
                repeatable: true,
                run: () => updateTransform((current) => ({ y: clamp(current.y + 5, 0, 100) })),
              },
              {
                id: `${idPrefix}-background-reset-resize`,
                label: t("Reset size & position"),
                group: "reset",
                dismiss: "keep-open" as const,
                repeatable: true,
                run: resetTransform,
              },
            ],
          },
          {
            id: `${idPrefix}-background-reset`,
            label: t("Reset background"),
            disabled: pending.current,
            run: () => save(null),
          },
        ]
      : []),
  ];

  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.closest("article, button, input, select, textarea, a, img, [data-reader-panel]")
    )
      return;
    menu.open(event, {
      kind: "actions",
      id: `${idPrefix}-reader-background`,
      label: t("Background"),
      actions,
    });
  };

  return {
    image,
    transform,
    updateTransform,
    actions,
    onContextMenu,
    input: (
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void importImage(file);
        }}
      />
    ),
    error: error ? (
      <p role="alert" className="text-sm text-red-400">
        {error}
      </p>
    ) : null,
    controls: (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={choose}
          className="rounded-xl border border-current/20 px-3 py-2 text-sm disabled:opacity-50"
        >
          {busy ? t("Compressing…") : t("Change background")}
        </button>
        {image && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(null)}
            className="rounded-xl border border-current/20 px-3 py-2 text-sm disabled:opacity-50"
          >
            {t("Reset background")}
          </button>
        )}
      </div>
    ),
  };
}
