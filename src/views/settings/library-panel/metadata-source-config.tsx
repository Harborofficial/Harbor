import { useEffect, useMemo, useRef, useState } from "react";
import type { Addon } from "@/lib/addons";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { metadataAddons } from "@/lib/meta-resource";
import {
  METADATA_SOURCE_SECTIONS,
  defaultMetadataSourceChain,
  metadataSourceKind,
  metadataSourceName,
  normalizeMetadataSourceChain,
  type MetadataSourceSection,
} from "@/lib/metadata-sources";
import { useSettings } from "@/lib/settings";
import { GripVertical } from "lucide-react";
import { ArrowDown, ArrowUp } from "../icons";
import { ModalButton, SettingsModal } from "../kit";

export function MetadataSourceConfig({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { authKey } = useAuth();
  const { settings, update } = useSettings();
  const [addons, setAddons] = useState<Addon[]>([]);
  const [active, setActive] = useState<MetadataSourceSection>("title");
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragRef = useRef<{ from: number; to: number; pointerId: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void metadataAddons(authKey, [])
      .then((items) => {
        if (!cancelled) setAddons(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authKey, open]);

  const section = METADATA_SOURCE_SECTIONS.find((item) => item.id === active)!;
  const chain = useMemo(
    () =>
      normalizeMetadataSourceChain(active, settings.metadataSources?.[active], addons, settings),
    [active, addons, settings],
  );

  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= chain.length || to >= chain.length) return;
    const next = [...chain];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    update({
      metadataSources: { ...settings.metadataSources, [active]: next },
    });
  };

  const move = (index: number, offset: number) => reorder(index, index + offset);

  const startDrag = (event: React.PointerEvent<HTMLElement>, index: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { from: index, to: index, pointerId: event.pointerId };
    setDragging(index);
    setDragOver(index);
  };

  const dragMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const row = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-source-index]");
    const to = Number(row?.dataset.sourceIndex);
    if (Number.isInteger(to)) {
      drag.to = to;
      setDragOver(to);
    }
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(null);
    setDragOver(null);
    if (drag.to !== drag.from) reorder(drag.from, drag.to);
  };

  const cancelDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(null);
    setDragOver(null);
  };

  const reset = () => {
    const next = defaultMetadataSourceChain(active, addons, settings);
    update({
      metadataSources: { ...settings.metadataSources, [active]: next },
    });
  };

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={t("Configure metadata sources")}
      sub={t(
        "Each section falls through in order until a source provides a value. Drag a source or use the arrows to reorder.",
      )}
      actions={<ModalButton onClick={onClose}>{t("Done")}</ModalButton>}
      width={760}
    >
      <div className="grid min-h-[360px] flex-1 gap-4 md:grid-cols-[190px_minmax(0,1fr)]">
        <div className="flex h-full min-h-[360px] flex-col gap-1 overflow-y-auto rounded-xl border border-edge bg-canvas/30 p-1.5">
          {METADATA_SOURCE_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={active === item.id}
              onClick={() => {
                setActive(item.id);
                setDragging(null);
                setDragOver(null);
              }}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] font-medium transition-colors ${
                active === item.id
                  ? "bg-raised text-ink"
                  : "text-ink-muted hover:bg-ink/5 hover:text-ink"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  active === item.id ? "bg-accent" : "bg-ink-subtle"
                }`}
              />
              <span>{t(item.label)}</span>
            </button>
          ))}
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">{t(section.label)}</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-subtle">
                {t(section.description)}
              </p>
            </div>
            <span className="shrink-0 rounded border border-accent/30 bg-accent/5 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent">
              {t("fallback order")}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            {chain.length === 0 ? (
              <p className="rounded-lg border border-edge bg-elevated p-3 text-[12px] text-ink-subtle">
                {t("No sources are available for this section.")}
              </p>
            ) : (
              chain.map((id, index) => {
                const kind = metadataSourceKind(id, addons, settings);
                return (
                  <div
                    key={id}
                    data-source-index={index}
                    className={`flex min-h-10 items-center gap-2 rounded-lg border bg-elevated px-2.5 py-2 transition-[border-color,opacity] ${
                      dragging === index ? "opacity-45" : ""
                    } ${
                      dragOver === index && dragging !== index ? "border-accent/70" : "border-edge"
                    }`}
                  >
                    <span
                      className="shrink-0 cursor-grab touch-none text-ink-subtle active:cursor-grabbing"
                      aria-hidden
                      onPointerDown={(event) => startDrag(event, index)}
                      onPointerMove={dragMove}
                      onPointerUp={endDrag}
                      onPointerCancel={cancelDrag}
                    >
                      <GripVertical size={15} />
                    </span>
                    <span className="w-4 shrink-0 text-[11px] text-ink-subtle">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-ink">
                        {metadataSourceName(id, addons, settings)}
                      </div>
                      <div className="text-[11px] text-ink-subtle">{kind ? t(kind) : ""}</div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-edge bg-surface text-ink-muted hover:text-ink disabled:opacity-30"
                        aria-label={t("Move {name} up", {
                          name: metadataSourceName(id, addons, settings),
                        })}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-edge bg-surface text-ink-muted hover:text-ink disabled:opacity-30"
                        aria-label={t("Move {name} down", {
                          name: metadataSourceName(id, addons, settings),
                        })}
                        disabled={index === chain.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {import.meta.env.DEV && (
            <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-edge bg-canvas/25 p-2.5">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--color-accent)]"
                checked={settings.metadataSourceLabels === true}
                onChange={(event) => update({ metadataSourceLabels: event.target.checked })}
              />
              <span>
                <span className="block text-[12px] font-medium text-ink">
                  {t("Show source labels on the detail page")}
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-subtle">
                  {t("Useful for checking which addon or provider supplied each part.")}
                </span>
              </span>
            </label>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[11px] leading-relaxed text-ink-subtle">
              {t(
                "Only configured providers appear here. Episode and season numbering is kept from one source at a time.",
              )}
            </p>
            <button
              type="button"
              className="shrink-0 rounded-md border border-edge bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-muted hover:text-ink"
              onClick={reset}
            >
              {t("Reset section")}
            </button>
          </div>
        </div>
      </div>
    </SettingsModal>
  );
}
