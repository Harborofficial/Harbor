import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { subscribeCustomThemes } from "./custom-themes";
import { t } from "./i18n";
import { subscribe as subscribeLanguage } from "./i18n/store";
import { subscribeUiCatalog } from "./i18n/translate";
import { isWindowsDesktop } from "./platform";
import type { Settings } from "./settings/types";
import { DEFAULT_THEME, getTrayThemes, isLightColor, resolveTokens } from "./theme";
import {
  resolveTrayTokens,
  TRAY_HOVER_TOKEN,
  TRAY_MENU_FONT,
  TRAY_TOKEN_KEYS,
  trayMenuWidths,
  trayRowHoverColor,
  type TrayDisplay,
  type TrayLabels,
  type TrayRgb,
} from "./tray-menu-state";

export type TrayMenuBridge = { refresh: () => void; dispose: () => void };

function label(key: string, englishFallback: string): string {
  const translated = t(key);
  return translated === key ? englishFallback : translated;
}

export function startTrayMenuBridge(readSettings: () => Settings): TrayMenuBridge | null {
  if (
    !("__TAURI_INTERNALS__" in window) ||
    !isWindowsDesktop() ||
    getCurrentWindow().label !== "main"
  ) {
    return null;
  }

  const root = document.documentElement;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const defaults = resolveTokens(DEFAULT_THEME);
  let disposed = false;
  let queued = false;
  let frame = 0;
  let lastPublished = "";
  let publishing = Promise.resolve();
  let warnedCanvas = false;

  function solidSurfaces(tokens: Record<string, string>): void {
    if (!context) {
      if (!warnedCanvas) {
        console.warn("[harbor] tray color canvas unavailable; using default solid surfaces");
        warnedCanvas = true;
      }
      for (const key of [
        "--color-canvas",
        "--color-surface",
        "--color-elevated",
        "--color-raised",
      ]) {
        tokens[key] = defaults[key];
      }
      return;
    }
    const composite = (foreground: string, background: string) => {
      context.fillStyle = background;
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = foreground;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    };
    // Glass palettes need a real backdrop in a separate opaque native window.
    tokens["--color-canvas"] = composite(tokens["--color-canvas"], defaults["--color-canvas"]);
    for (const key of ["--color-surface", "--color-elevated", "--color-raised"]) {
      tokens[key] = composite(tokens[key], tokens["--color-canvas"]);
    }
  }

  function readColor(value: string): TrayRgb | null {
    if (!context) return null;
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return { r, g, b };
  }

  // The theme's elevated tone can match the surface it sits on, which leaves the
  // row highlight invisible. Publish a row color that always separates.
  function hoverToken(tokens: Record<string, string>): string {
    const surface = readColor(tokens["--color-surface"]);
    const elevated = readColor(tokens["--color-elevated"]);
    const raised = readColor(tokens["--color-raised"]);
    if (!surface || !elevated || !raised) return defaults["--color-elevated"];
    const hover = trayRowHoverColor(surface, elevated, raised);
    return `rgb(${hover.r}, ${hover.g}, ${hover.b})`;
  }

  function publish(): void {
    frame = 0;
    queued = false;
    if (disposed) return;
    const settings = readSettings();
    const style = getComputedStyle(root);
    const computed = Object.fromEntries(
      TRAY_TOKEN_KEYS.map((key) => [key, style.getPropertyValue(key)]),
    );
    const tokens = resolveTrayTokens(settings.theme, computed, (value) =>
      CSS.supports("color", value),
    );
    solidSurfaces(tokens);
    tokens[TRAY_HOVER_TOKEN] = hoverToken(tokens);
    const labels: TrayLabels = {
      show: t("Show Harbor"),
      theme: t("Theme"),
      alwaysOnTop: label("Always on top", "Always on Top"),
      pauseMinimized: label("Pause when minimized", "Pause When Minimized"),
      pauseUnfocused: label("Pause when unfocused", "Pause When Unfocused"),
      closeToTray: label("Close to the system tray", "Close to Tray"),
      quit: t("Quit Harbor"),
      error: t("Could not apply this change. Try again."),
    };
    const themes = getTrayThemes();
    if (settings.theme.customColors || settings.theme.preset === "custom") {
      themes.push({ id: "custom", name: t("Custom") });
    }
    if (context) context.font = TRAY_MENU_FONT;
    const measure = (text: string) => context?.measureText(text).width ?? text.length * 8;
    const display: TrayDisplay = {
      themeId: themes.some((theme) => theme.id === settings.theme.preset)
        ? settings.theme.preset
        : DEFAULT_THEME.preset,
      themes,
      tokens,
      labels,
      direction: root.dir === "rtl" ? "rtl" : "ltr",
      colorScheme: isLightColor(tokens["--color-canvas"]) ? "light" : "dark",
      ...trayMenuWidths(labels, themes, measure),
    };
    const serialized = JSON.stringify(display);
    if (serialized === lastPublished) return;
    lastPublished = serialized;
    publishing = publishing
      .then(async () => {
        if (!disposed) await invoke("tray_popup_publish", { display });
      })
      .catch((error) => {
        lastPublished = "";
        console.warn("[harbor] tray_popup_publish failed", error);
      });
  }

  function refresh(): void {
    if (disposed || queued) return;
    queued = true;
    // Hidden WebViews can suspend animation frames while the tray is in use.
    if (document.hidden) queueMicrotask(publish);
    else frame = requestAnimationFrame(publish);
  }

  const rootObserver = new MutationObserver(refresh);
  rootObserver.observe(root, {
    attributes: true,
    attributeFilter: [
      "style",
      "dir",
      "class",
      "data-theme-mode",
      "data-theme-layout",
      "data-theme-card",
      "data-theme-button",
    ],
  });
  const isStylesheet = (node: Node) => {
    const element = node instanceof Element ? node : node.parentElement;
    return !!element?.closest('style, link[rel="stylesheet"]');
  };
  const headObserver = new MutationObserver((mutations) => {
    if (
      mutations.some(
        (mutation) =>
          isStylesheet(mutation.target) ||
          [...mutation.addedNodes, ...mutation.removedNodes].some(isStylesheet),
      )
    )
      refresh();
  });
  headObserver.observe(document.head, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href", "media", "disabled"],
  });
  const onVisibility = () => {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      queued = false;
    }
    refresh();
  };
  const stopThemes = subscribeCustomThemes(refresh);
  const stopLanguage = subscribeLanguage(refresh);
  const stopCatalog = subscribeUiCatalog(refresh);
  document.addEventListener("visibilitychange", onVisibility);
  document.head.addEventListener("load", refresh, true);
  refresh();

  return {
    refresh,
    dispose() {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      rootObserver.disconnect();
      headObserver.disconnect();
      stopThemes();
      stopLanguage();
      stopCatalog();
      document.removeEventListener("visibilitychange", onVisibility);
      document.head.removeEventListener("load", refresh, true);
    },
  };
}
