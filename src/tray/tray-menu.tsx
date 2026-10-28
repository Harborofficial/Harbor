import {
  Check,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  LogOut,
  Palette,
  PanelBottomClose,
  PanelsTopLeft,
  Pin,
  SquareMinus,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { HarborMark } from "../components/icons/harbor-mark";
import { dismissTraySubmenu, presentTraySubmenu, prefersReducedMotion } from "./tray-motion";
import type { TrayAction, TrayLayout, TrayPrefs, TraySnapshot } from "./types";

type Props = {
  snapshot: TraySnapshot;
  onAction: (action: TrayAction) => Promise<void>;
  onDismiss: () => void;
  onSubmenuChange: (open: boolean) => Promise<void>;
};

const preferenceRows: { id: keyof TrayPrefs; icon: LucideIcon }[] = [
  { id: "alwaysOnTop", icon: Pin },
  { id: "pauseMinimized", icon: SquareMinus },
  { id: "pauseUnfocused", icon: EyeOff },
  { id: "closeToTray", icon: PanelBottomClose },
];

const navigationKeys = new Set([
  "Escape",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "Enter",
  " ",
]);

/** Grace period that lets the pointer cross the gap between the row and the submenu. */
const SUBMENU_CLOSE_DELAY = 90;

function panelStyle(layout: TrayLayout, theme = false): CSSProperties {
  return {
    left: theme ? layout.themeX : layout.mainX,
    top: theme ? layout.themeY : layout.mainY,
    width: theme ? layout.themeWidth : layout.mainWidth,
    height: theme ? layout.themeHeight : layout.mainHeight,
  };
}

function focus(button: HTMLButtonElement | null | undefined) {
  button?.focus({ preventScroll: true });
  button?.scrollIntoView({ block: "nearest" });
}

export function TrayMenu({ snapshot, onAction, onDismiss, onSubmenuChange }: Props) {
  const [submenu, setSubmenu] = useState(false);
  const [submenuClosing, setSubmenuClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const running = useRef(false);
  const live = useRef(true);
  const submenuRequest = useRef(0);
  const moveThemeFocus = useRef(false);
  const envelope = useRef<HTMLDivElement>(null);
  const submenuTimer = useRef<number | null>(null);
  const submenuExit = useRef<(() => void) | null>(null);
  const entranceCancel = useRef<(() => void) | null>(null);
  const pointerOnTheme = useRef(false);
  const themePanel = useRef<HTMLDivElement>(null);
  const mainButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const themeButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const display = snapshot.display;

  useEffect(() => {
    live.current = true;
    focus(mainButtons.current[0]);
    return () => {
      live.current = false;
    };
  }, [snapshot.openId]);

  useEffect(
    () => () => {
      if (submenuTimer.current !== null) window.clearTimeout(submenuTimer.current);
      submenuExit.current?.();
    },
    [],
  );

  useLayoutEffect(() => {
    if (!submenu) return;
    const element = themePanel.current;
    if (!element) return;
    // The panel is in place before the first paint, so it never flashes open.
    const cancel = presentTraySubmenu(element, prefersReducedMotion(), snapshot.layout.submenuSide);
    entranceCancel.current = cancel;
    return () => {
      cancel();
      entranceCancel.current = null;
    };
  }, [submenu, snapshot.layout.submenuSide]);

  useLayoutEffect(() => {
    if (!submenu || !moveThemeFocus.current) return;
    moveThemeFocus.current = false;
    const selected = display?.themes.findIndex((theme) => theme.id === display.themeId) ?? 0;
    focus(themeButtons.current[Math.max(0, selected)]);
  }, [submenu, display]);

  if (!display || (!snapshot.open && !snapshot.closing)) return null;

  const { labels, themes, direction } = display;
  const openKey = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
  const closeKey = direction === "rtl" ? "ArrowRight" : "ArrowLeft";

  const cancelSubmenuClose = () => {
    if (submenuTimer.current !== null) {
      window.clearTimeout(submenuTimer.current);
      submenuTimer.current = null;
    }
  };

  const cancelSubmenuExit = () => {
    if (submenuExit.current) {
      submenuExit.current();
      submenuExit.current = null;
    }
    setSubmenuClosing(false);
  };

  // Opens the theme list. The native window grows before the panel appears, so
  // the pointer can travel into it.
  const openSubmenu = async (moveFocus: boolean) => {
    const request = ++submenuRequest.current;
    cancelSubmenuClose();
    cancelSubmenuExit();
    const alreadyOpen = submenu;
    // The focus moves into the panel once it is mounted.
    moveThemeFocus.current = !alreadyOpen && moveFocus;
    setSubmenu(true);
    try {
      await onSubmenuChange(true);
      if (!live.current || request !== submenuRequest.current) return;
      if (moveFocus && alreadyOpen) {
        focus(
          themeButtons.current[
            Math.max(
              0,
              themes.findIndex((theme) => theme.id === display.themeId),
            )
          ],
        );
      }
    } catch (cause) {
      console.error("[harbor::tray] submenu failed", cause);
      if (live.current) setError(true);
    }
  };

  // Closes the theme list with a short fade. The native window only shrinks
  // once the panel is gone, so the pointer never lands on the window behind.
  const closeSubmenu = (moveFocus: boolean) => {
    const request = ++submenuRequest.current;
    cancelSubmenuClose();
    if (moveFocus) focus(mainButtons.current[1]);
    if (!submenu) return;
    const element = themePanel.current;
    const finish = () => {
      submenuExit.current = null;
      if (!live.current || request !== submenuRequest.current) return;
      setSubmenu(false);
      setSubmenuClosing(false);
      void onSubmenuChange(false).catch((cause) => {
        console.error("[harbor::tray] submenu failed", cause);
        if (live.current) setError(true);
      });
    };
    setSubmenuClosing(true);
    entranceCancel.current?.();
    if (!element) {
      finish();
      return;
    }
    submenuExit.current = dismissTraySubmenu(
      element,
      prefersReducedMotion(),
      snapshot.layout.submenuSide,
      finish,
    );
  };

  // A native menu drops the submenu when the pointer leaves it.
  const scheduleSubmenuClose = () => {
    if (!submenu) return;
    cancelSubmenuClose();
    submenuTimer.current = window.setTimeout(() => {
      submenuTimer.current = null;
      if (pointerOnTheme.current) return;
      closeSubmenu(false);
    }, SUBMENU_CLOSE_DELAY);
  };

  const run = async (action: TrayAction) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(false);
    try {
      await onAction(action);
    } catch (cause) {
      console.error("[harbor::tray] action failed", cause);
      if (live.current) setError(true);
    } finally {
      running.current = false;
      if (live.current) setBusy(false);
    }
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (navigationKeys.has(event.key)) {
      envelope.current?.setAttribute("data-modality", "keyboard");
    }
    const inThemes = !!(event.target as HTMLElement).closest("[data-tray-themes]");
    const buttons = (inThemes ? themeButtons : mainButtons).current.filter(
      (button): button is HTMLButtonElement => !!button,
    );
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      if (submenu) closeSubmenu(true);
      else onDismiss();
    } else if (event.key === "Tab") {
      event.preventDefault();
      onDismiss();
    } else if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      focus(buttons[next]);
    } else if (!inThemes && event.key === openKey && index === 1) {
      event.preventDefault();
      void openSubmenu(true);
    } else if (inThemes && event.key === closeKey) {
      event.preventDefault();
      closeSubmenu(true);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      (event.target as HTMLButtonElement).click();
    }
  };

  const row = (
    index: number,
    id: Exclude<TrayAction["type"], "theme">,
    Icon: LucideIcon,
    checked?: boolean,
  ) => (
    <button
      key={id}
      ref={(element) => {
        mainButtons.current[index] = element;
      }}
      type="button"
      tabIndex={-1}
      className="tray-row"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      aria-disabled={busy || undefined}
      data-tray-action={id}
      onClick={() => {
        void run({ type: id });
      }}
    >
      <span className="tray-row-icon">
        <Icon size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <span className="tray-row-label">{labels[id]}</span>
      <span className="tray-row-state">
        {checked && <Check size={14} strokeWidth={2} aria-hidden />}
      </span>
    </button>
  );
  const Chevron = snapshot.layout.submenuSide === "left" ? ChevronLeft : ChevronRight;

  return (
    <div
      className="tray-envelope"
      ref={envelope}
      data-modality="pointer"
      dir={direction}
      onKeyDown={onKey}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="tray-panel tray-main-panel" style={panelStyle(snapshot.layout)}>
        <header className="tray-header">
          <HarborMark className="tray-brand-mark" />
          <span>Harbor</span>
        </header>
        <div className="tray-separator" role="separator" />
        <div role="menu" aria-label="Harbor" aria-busy={busy}>
          {row(0, "show", PanelsTopLeft)}
          <button
            ref={(element) => {
              mainButtons.current[1] = element;
            }}
            className="tray-row"
            type="button"
            tabIndex={-1}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu}
            aria-controls="tray-theme-menu"
            data-tray-action="theme"
            onPointerEnter={() => {
              cancelSubmenuClose();
              if (!submenu && !submenuClosing) void openSubmenu(false);
            }}
            onPointerLeave={() => scheduleSubmenuClose()}
            onClick={() => {
              if (submenu) closeSubmenu(true);
              else void openSubmenu(true);
            }}
          >
            <span className="tray-row-icon">
              <Palette size={16} strokeWidth={1.75} aria-hidden />
            </span>
            <span className="tray-row-label">{labels.theme}</span>
            <span className="tray-row-state">
              <Chevron size={14} strokeWidth={1.75} aria-hidden />
            </span>
          </button>
          {preferenceRows.map(({ id, icon }, index) =>
            row(index + 2, id, icon, snapshot.prefs[id]),
          )}
          <div className="tray-separator" role="separator" />
          {row(6, "quit", LogOut)}
        </div>
        {error && (
          <div className="tray-error" role="alert">
            {labels.error}
          </div>
        )}
      </div>
      {(submenu || submenuClosing) && (
        <div
          id="tray-theme-menu"
          className="tray-panel tray-theme-panel"
          ref={themePanel}
          role="menu"
          aria-label={labels.theme}
          data-tray-themes
          style={panelStyle(snapshot.layout, true)}
          onPointerEnter={() => {
            cancelSubmenuClose();
            pointerOnTheme.current = true;
          }}
          onPointerLeave={() => {
            pointerOnTheme.current = false;
            scheduleSubmenuClose();
          }}
        >
          {themes.map((theme, index) => (
            <button
              key={theme.id}
              ref={(element) => {
                themeButtons.current[index] = element;
              }}
              className="tray-row tray-theme-row"
              type="button"
              tabIndex={-1}
              role="menuitemradio"
              aria-checked={theme.id === display.themeId}
              aria-disabled={busy || undefined}
              data-theme-id={theme.id}
              onClick={() => {
                void run({ type: "theme", value: theme.id });
              }}
            >
              <span className="tray-row-label">{theme.name}</span>
              <span className="tray-row-state">
                {theme.id === display.themeId && <Check size={14} strokeWidth={2} aria-hidden />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
