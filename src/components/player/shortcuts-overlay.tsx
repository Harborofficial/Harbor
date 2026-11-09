import { useMemo } from "react";
import { X } from "lucide-react";
import { playerShortcutGroups } from "@/lib/player/shortcut-groups";
import { effectiveBinding, formatBindingForDisplay } from "@/lib/hotkeys";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { settings } = useSettings();
  const overrides = settings.hotkeys;
  const groups = useMemo(() => playerShortcutGroups(overrides ?? {}), [overrides]);
  const closeKey = formatBindingForDisplay(effectiveBinding("playerClose", overrides ?? {}));

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-[60] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="false"
        aria-label={t("Keyboard shortcuts")}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-edge-soft bg-canvas/92 shadow-[0_28px_72px_-20px_rgba(0,0,0,0.9)]"
      >
        <header className="flex items-center justify-between gap-4 border-b border-edge-soft px-6 py-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[16px] font-semibold text-ink">{t("Keyboard shortcuts")}</h2>
            <p className="text-[12.5px] text-ink-subtle">
              {t("Press {key} to close. Change these in Settings.", { key: closeKey })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <X size={17} strokeWidth={2.2} />
          </button>
        </header>
        <div className="overflow-y-auto px-6 py-5">
          <div className="columns-1 gap-x-10 sm:columns-2 lg:columns-3">
            {groups.map((group) => (
              <section key={group.name} className="mb-5 break-inside-avoid">
                <h3 className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.2em] text-ink-subtle">
                  {t(group.name)}
                </h3>
                <dl className="flex flex-col gap-1.5">
                  {group.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3">
                      <dt className="min-w-0 truncate text-[13px] text-ink-muted">
                        {t(item.label)}
                      </dt>
                      <dd className="shrink-0">
                        <kbd
                          dir="ltr"
                          className="rounded-[6px] border border-edge-soft bg-elevated px-1.5 py-0.5 font-mono text-[11.5px] text-ink"
                        >
                          {formatBindingForDisplay(item.binding)}
                        </kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
