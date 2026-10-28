// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { JSDOM } from "jsdom";
import { DEFAULT_THEME } from "../src/lib/theme.ts";

const colorStyle = new JSDOM().window.document.createElement("span").style;
const supportsColor = (value: string) => {
  colorStyle.color = "";
  colorStyle.color = value;
  return colorStyle.color !== "";
};

test("tray catalog includes available featured and parked themes without duplicate ids", async () => {
  const { getTrayThemes } = await import("../src/lib/theme.ts");
  assert.equal(typeof getTrayThemes, "function");
  const themes = getTrayThemes();
  assert.equal(themes.find((theme) => theme.id === "minui-dark")?.name, "MinUI Dark");
  assert.equal(themes.find((theme) => theme.id === "kawaii")?.name, "Kawaii");
  assert.equal(themes.find((theme) => theme.id === "feishin")?.name, "Feishin");
  assert.equal(new Set(themes.map((theme) => theme.id)).size, themes.length);
});

test("tray colors prefer valid computed overrides and fall back to the active palette", async () => {
  const { resolveTrayTokens } = await import("../src/lib/tray-menu-state.ts");
  const tokens = resolveTrayTokens(
    { ...DEFAULT_THEME, preset: "nord" },
    { "--color-ink": "rgb(240, 241, 242)", "--color-accent": "invalid" },
    supportsColor,
  );
  assert.equal(tokens["--color-ink"], "rgb(240, 241, 242)");
  assert.equal(tokens["--color-accent"], "#88c0d0");
  assert.equal(tokens["--color-canvas"], "#2e3440");
});

test("tray colors preserve the user's palette and reject unresolved or inherited colors", async () => {
  const { resolveTrayTokens } = await import("../src/lib/tray-menu-state.ts");
  const tokens = resolveTrayTokens(
    {
      ...DEFAULT_THEME,
      preset: "custom",
      customColors: {
        canvas: "#fafafa",
        surface: "#ffffff",
        elevated: "#eeeeee",
        raised: "#dddddd",
        ink: "#111111",
        inkMuted: "#333333",
        inkSubtle: "#555555",
        edge: "#777777",
        accent: "#123456",
        danger: "#990000",
      },
    },
    { "--color-accent": "var(--missing)", "--color-ink": "currentColor" },
    supportsColor,
  );
  assert.equal(tokens["--color-canvas"], "#fafafa");
  assert.equal(tokens["--color-accent"], "#123456");
  assert.equal(tokens["--color-ink"], "#111111");
  assert.equal(tokens["--color-edge-soft"], "#77777740");
});

test("invalid custom colors use Harbor's real defaults rather than an empty popup palette", async () => {
  const { resolveTrayTokens } = await import("../src/lib/tray-menu-state.ts");
  const tokens = resolveTrayTokens(
    { ...DEFAULT_THEME, preset: "custom", customColors: null },
    { "--color-surface": "inherit", "--color-canvas": "url(https://example.com)" },
    supportsColor,
  );
  assert.equal(tokens["--color-canvas"], "oklch(0.18 0.004 260)");
  assert.equal(tokens["--color-surface"], "oklch(0.22 0.004 260)");
  assert.equal(Object.keys(tokens).length, 12);
});

test("long translated labels and user theme names expand menus within native width limits", async () => {
  const { trayMenuWidths } = await import("../src/lib/tray-menu-state.ts");
  const labels = {
    show: "Show Harbor",
    theme: "Theme",
    alwaysOnTop: "Always on top",
    pauseMinimized: "Pause when minimized",
    pauseUnfocused: "Pause when unfocused",
    closeToTray: "Close to the system tray",
    quit: "Quit Harbor",
    error: "Try again",
  };
  const short = trayMenuWidths(labels, [{ id: "short", name: "Short" }], (text) => text.length * 7);
  assert.ok(short.menuWidth >= 240 && short.menuWidth <= 420);
  assert.ok(short.themeWidth >= 220 && short.themeWidth <= 360);
  const long = trayMenuWidths(
    { ...labels, alwaysOnTop: "A".repeat(100) },
    [{ id: "long", name: "B".repeat(100) }],
    (text) => text.length * 7,
  );
  assert.equal(long.menuWidth, 420);
  assert.equal(long.themeWidth, 360);
  const longError = trayMenuWidths(
    { ...labels, error: "C".repeat(100) },
    [{ id: "short", name: "Short" }],
    (text) => text.length * 7,
  );
  assert.equal(longError.menuWidth, short.menuWidth);
});

test("tray row highlight stays visible when a theme's elevated tone matches the surface", async () => {
  const { contrastRatio, trayRowHoverColor } = await import("../src/lib/tray-menu-state.ts");
  // ElegantFin paints its elevated tone darker than the surface it sits on.
  const elegantfin = {
    surface: { r: 30, g: 41, b: 54 },
    elevated: { r: 30, g: 40, b: 54 },
    raised: { r: 55, g: 65, b: 81 },
  };
  const hover = trayRowHoverColor(elegantfin.surface, elegantfin.elevated, elegantfin.raised);
  assert.ok(
    contrastRatio(elegantfin.surface, hover) >= 1.12,
    "the hover tone must separate from the surface",
  );
  assert.notDeepEqual(hover, elegantfin.elevated);
  // Light palettes can share one tone for both surface and elevated.
  const light = {
    surface: { r: 255, g: 255, b: 255 },
    elevated: { r: 255, g: 255, b: 255 },
    raised: { r: 253, g: 238, b: 243 },
  };
  const lightHover = trayRowHoverColor(light.surface, light.elevated, light.raised);
  assert.ok(contrastRatio(light.surface, lightHover) >= 1.12);
  // A theme whose elevated tone already separates keeps its own color.
  const classic = {
    surface: { r: 20, g: 21, b: 20 },
    elevated: { r: 39, g: 38, b: 38 },
    raised: { r: 64, g: 64, b: 65 },
  };
  assert.deepEqual(
    trayRowHoverColor(classic.surface, classic.elevated, classic.raised),
    classic.elevated,
  );
});

test("main tray bridge publishes theme and CSS changes, syncs custom themes, and disposes observers", async (context) => {
  const { startTrayMenuBridge } = await import("../src/lib/tray-menu-bridge.ts");
  const { saveCustomTheme, removeCustomTheme } = await import("../src/lib/custom-themes.ts");
  const { resolveTokens } = await import("../src/lib/theme.ts");
  const dom = new JSDOM("<!doctype html><html dir='ltr'><head></head><body></body></html>", {
    url: "https://harbor.test",
  });
  const snapshots: import("../src/lib/tray-menu-state.ts").TrayDisplay[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  Object.assign(dom.window, {
    __TAURI_OS_PLUGIN_INTERNALS__: { platform: "windows" },
    __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: "main" } },
      async invoke(
        command: string,
        args: { display: import("../src/lib/tray-menu-state.ts").TrayDisplay },
      ) {
        assert.equal(command, "tray_popup_publish");
        snapshots.push(structuredClone(args.display));
      },
    },
  });
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    Element: dom.window.Element,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    CSS: { supports: (_property: string, value: string) => supportsColor(value) },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  Object.defineProperty(dom.window.document, "hidden", { configurable: true, value: false });
  const originalWarn = console.warn;
  console.warn = (message, ...args) => {
    if (!String(message).includes("tray color canvas unavailable")) originalWarn(message, ...args);
  };
  let settings = {
    theme: { ...DEFAULT_THEME, preset: "nord" },
  } as import("../src/lib/settings/types.ts").Settings;
  const bridge = startTrayMenuBridge(() => settings);
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const [id, callback] of frames) {
      frames.delete(id);
      callback(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  try {
    assert.ok(bridge);
    await settle();
    assert.equal(snapshots.at(-1)?.themeId, "nord");
    assert.equal(snapshots.at(-1)?.labels.closeToTray, "Close to Tray");
    assert.equal(snapshots.at(-1)?.labels.alwaysOnTop, "Always on Top");
    assert.equal(snapshots.at(-1)?.labels.pauseMinimized, "Pause When Minimized");
    assert.equal(snapshots.at(-1)?.labels.pauseUnfocused, "Pause When Unfocused");
    assert.equal(snapshots.at(-1)?.labels.error, "Could not apply this change. Try again.");
    assert.equal(
      snapshots.at(-1)?.tokens["--tray-row-hover"],
      "oklch(0.27 0.004 260)",
      "the popup needs its own row highlight tone",
    );

    await context.test(
      "Arabic tray preferences reuse the existing translated settings labels",
      async () => {
        const { ensureUiLocale } = await import("../src/lib/i18n/load-locale.ts");
        const { getUiLanguage, getUiRegion, setUiLanguage } =
          await import("../src/lib/i18n/store.ts");
        const previousLanguage = getUiLanguage();
        const previousRegion = getUiRegion();
        try {
          await ensureUiLocale("ar");
          setUiLanguage("ar");
          await settle();
          const display = snapshots.at(-1);
          assert.equal(display?.direction, "rtl");
          assert.equal(display?.labels.alwaysOnTop, "دائماً في المقدمة");
          assert.equal(display?.labels.pauseMinimized, "إيقاف مؤقت عند التصغير");
          assert.equal(display?.labels.pauseUnfocused, "إيقاف مؤقت عند فقدان التركيز");
          assert.equal(display?.labels.closeToTray, "التصغير إلى علبة النظام (System tray)");
        } finally {
          setUiLanguage(previousLanguage, previousRegion);
          await settle();
        }
        assert.equal(snapshots.at(-1)?.labels.alwaysOnTop, "Always on Top");
        assert.equal(snapshots.at(-1)?.labels.closeToTray, "Close to Tray");
      },
    );

    settings = {
      ...settings,
      theme: { ...settings.theme, preset: "minui-dark" as typeof settings.theme.preset },
    };
    dom.window.document.documentElement.style.setProperty("--color-accent", "#098765");
    dom.window.document.documentElement.dir = "rtl";
    bridge?.refresh();
    await settle();
    assert.equal(snapshots.at(-1)?.themeId, "minui-dark");
    assert.equal(snapshots.at(-1)?.tokens["--color-accent"], "#098765");
    assert.equal(snapshots.at(-1)?.direction, "rtl");

    saveCustomTheme({
      id: "user:tray-test",
      name: "Tray test",
      blurb: "",
      swatch: ["#000000", "#111111", "#ffffff"],
      tokens: resolveTokens(DEFAULT_THEME),
    });
    await settle();
    assert.equal(
      snapshots.at(-1)?.themes.find((theme) => theme.id === "user:tray-test")?.name,
      "Tray test",
    );

    const style = dom.window.document.createElement("style");
    style.id = "harbor-custom-css";
    style.textContent = ":root { --color-accent: #224466; }";
    dom.window.document.documentElement.style.removeProperty("--color-accent");
    dom.window.document.head.appendChild(style);
    await settle();
    assert.equal(snapshots.at(-1)?.tokens["--color-accent"], "#224466");

    Object.defineProperty(dom.window.document, "hidden", { configurable: true, value: true });
    settings = { ...settings, theme: { ...settings.theme, preset: "user:deleted" } };
    bridge?.refresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(snapshots.at(-1)?.themeId, "cool-grey");
    assert.equal(
      frames.size,
      0,
      "hidden main windows must not depend on suspended animation frames",
    );

    settings = { ...settings, theme: { ...settings.theme, preset: "custom", customColors: null } };
    bridge?.refresh();
    await settle();
    assert.equal(
      snapshots.at(-1)?.themes.some((theme) => theme.id === "custom"),
      true,
    );

    bridge?.dispose();
    const count = snapshots.length;
    dom.window.document.documentElement.style.setProperty("--color-accent", "#abcdef");
    bridge?.refresh();
    await settle();
    assert.equal(snapshots.length, count);
  } finally {
    bridge?.dispose();
    removeCustomTheme("user:tray-test");
    console.warn = originalWarn;
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
});
