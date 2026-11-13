import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { X } from "lucide-react";
import { playerShortcutGroups } from "@/lib/player/shortcut-groups";
import { createHotkeyMatcher, effectiveBinding, formatBindingForDisplay } from "@/lib/hotkeys";
import { useT } from "@/lib/i18n";
import { tvFocus } from "@/lib/keyboard-navigation";
import { useSettings } from "@/lib/settings";

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { settings } = useSettings();
  const overrides = settings.hotkeys;
  const groups = useMemo(() => playerShortcutGroups(overrides ?? {}), [overrides]);
  const closeKey = formatBindingForDisplay(effectiveBinding("playerClose", overrides ?? {}));
  const closeRef = useRef<HTMLButtonElement>(null);
  // A drag that starts inside the panel (e.g. selecting text) and ends on the
  // backdrop must not dismiss it, so both ends of the click have to be the backdrop.
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const close = closeRef.current;
    if (close) tvFocus(close);
    return () => {
      if (previous?.isConnected) tvFocus(previous);
    };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      const controls = Array.from(
        e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'),
      ).filter((el) => el.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (e.key.startsWith("Media")) return;
    // The dialog is modal: player hotkeys stay inert under it, except the two
    // bindings that dismiss it.
    e.stopPropagation();
    const match = createHotkeyMatcher(e.nativeEvent, overrides ?? {}, "Player");
    if (match("playerClose") || match("playerShortcuts")) {
      e.preventDefault();
      if (!e.repeat) onClose();
    }
  };

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-[60] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
        pressedBackdrop.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-shortcuts-title"
        data-tv-focus-scope
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex max-h-full w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-edge-soft bg-canvas/92 shadow-[0_28px_72px_-20px_rgba(0,0,0,0.9)]"
      >
        <header className="flex items-center justify-between gap-4 border-b border-edge-soft px-6 py-4">
          <div className="flex flex-col gap-0.5">
            <h2
              id="player-shortcuts-title"
              dir="auto"
              className="text-[16px] font-semibold text-ink"
            >
              {t("Keyboard shortcuts")}
            </h2>
            <p dir="auto" className="text-[12.5px] text-ink-subtle">
              {t("Press {key} to close. Change these in Settings.", { key: closeKey })}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("Close")}
            data-tv-modal-close
            data-tv-initial-focus
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <X size={17} strokeWidth={2.2} />
          </button>
        </header>
        <div
          tabIndex={0}
          aria-label={t("Keyboard shortcuts")}
          className="overflow-y-auto px-6 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <div className="columns-1 gap-x-10 sm:columns-2 lg:columns-3">
            {groups.map((group) => (
              <section key={group.name} className="mb-5 break-inside-avoid">
                <h3 className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.2em] text-ink-subtle">
                  {t(group.name)}
                </h3>
                <dl className="flex flex-col gap-1.5">
                  {group.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3">
                      <dt dir="auto" className="min-w-0 truncate text-[13px] text-ink-muted">
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
