// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import arSettings from "../src/lib/i18n/locales/ar/settings.ts";
import ptSettings from "../src/lib/i18n/locales/pt/settings.ts";
import ruSettings from "../src/lib/i18n/locales/ru/settings.ts";
import {
  HOTKEYS,
  createHotkeyMatcher,
  eventToBinding,
  findHotkeyMatch,
  shouldHandleGlobalKeyboardEvent,
} from "../src/lib/hotkeys.ts";

import { usePlayerInteractionBlocker } from "../src/views/player/hooks/use-player-interaction-lock.ts";

function keyboardEvent(key: string, init: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...init,
  } as KeyboardEvent;
}

test("open settings is a configurable Global Ctrl+S command", () => {
  const command = HOTKEYS.find((entry) => entry.id === "globalSettingsOpen");
  assert.deepEqual(command, {
    id: "globalSettingsOpen",
    scope: "Global",
    group: "Navigation",
    label: "Open settings",
    description: "Open Harbor's settings outside playback.",
    defaultBinding: "ctrl+s",
  });
});

test("open settings follows Global priority and effective binding rules", () => {
  const ctrlS = keyboardEvent("s", { ctrlKey: true });
  const ctrlShiftS = keyboardEvent("S", { ctrlKey: true, shiftKey: true });
  const metaS = keyboardEvent("s", { metaKey: true });
  const altP = keyboardEvent("p", { altKey: true });

  assert.equal(findHotkeyMatch(ctrlS, {}, "Global"), "globalSettingsOpen");
  assert.equal(findHotkeyMatch(ctrlShiftS, {}, "Global"), "globalSettingsOpen");
  assert.equal(findHotkeyMatch(metaS, {}, "Global"), null);
  assert.equal(
    findHotkeyMatch(ctrlS, { globalSearchFocus: "ctrl+s" }, "Global"),
    "globalSearchFocus",
  );
  assert.equal(
    findHotkeyMatch(altP, { globalSettingsOpen: "alt+p" }, "Global"),
    "globalSettingsOpen",
  );
  assert.equal(findHotkeyMatch(ctrlS, { globalSettingsOpen: "alt+p" }, "Global"), null);
});

test("default letter shortcuts fall back to the physical key on non-ASCII layouts", () => {
  const russianS = keyboardEvent("ы", { code: "KeyS", ctrlKey: true });
  const turkishI = keyboardEvent("ı", { code: "KeyI" });
  assert.equal(findHotkeyMatch(russianS, {}, "Global"), "globalSettingsOpen");
  assert.equal(findHotkeyMatch(turkishI, {}, "Player"), "playerStats");
  assert.equal(
    findHotkeyMatch(keyboardEvent("з", { code: "KeyP" }), {}, "Player"),
    "playerScreenshot",
  );
  assert.equal(findHotkeyMatch(keyboardEvent("с", { code: "KeyC" }), {}, "Manga"), "mangaMatch");
  assert.equal(
    findHotkeyMatch(keyboardEvent("д", { code: "KeyL", ctrlKey: true }), {}, "Player"),
    "playerScreenLock",
  );
  assert.equal(
    findHotkeyMatch(keyboardEvent("x", { code: "KeyI" }), {}, "Player"),
    "playerSubDelayUp",
  );
  assert.equal(findHotkeyMatch(keyboardEvent("ı"), {}, "Player"), null);
});

test("shifted punctuation can trigger its default when no exact binding owns it", () => {
  const slash = keyboardEvent("/", { code: "Digit7", shiftKey: true });
  assert.equal(findHotkeyMatch(slash, {}, "Global"), "globalSearchFocus");
  assert.equal(
    findHotkeyMatch(slash, { globalSettingsOpen: "shift+/" }, "Global"),
    "globalSettingsOpen",
  );
  assert.equal(findHotkeyMatch(slash, { globalSearchFocus: "g" }, "Global"), null);
  assert.equal(
    findHotkeyMatch(keyboardEvent("<", { code: "Comma", shiftKey: true }), {}, "Player"),
    "playerFrameBack",
  );
});

test("exact custom bindings win and only defaults receive keyboard layout fallbacks", () => {
  const russianS = keyboardEvent("ы", { code: "KeyS", ctrlKey: true });
  assert.equal(
    findHotkeyMatch(russianS, { globalSearchFocus: "ctrl+ы" }, "Global"),
    "globalSearchFocus",
  );
  assert.equal(findHotkeyMatch(russianS, { globalSettingsOpen: "ctrl+p" }, "Global"), null);
  assert.equal(findHotkeyMatch(russianS, { globalSettingsOpen: "ctrl+s" }, "Global"), null);
  assert.equal(
    findHotkeyMatch(russianS, { globalSettingsOpen: "ctrl+ы" }, "Global"),
    "globalSettingsOpen",
  );
  assert.equal(
    findHotkeyMatch(keyboardEvent("ы", { code: "KeyS" }), { globalSearchFocus: "s" }, "Global"),
    null,
  );
});

test("typing, composition and AltGr letters do not trigger layout fallbacks", () => {
  const input = { nodeType: 1, tagName: "INPUT" } as unknown as EventTarget;
  for (const variant of [{ target: input }, { isComposing: true }]) {
    const event = keyboardEvent("ы", { code: "KeyS", ctrlKey: true, ...variant });
    assert.equal(findHotkeyMatch(event, {}, "Global"), null);
  }
  const ctrlAltR = { code: "KeyR", ctrlKey: true, altKey: true };
  assert.equal(findHotkeyMatch(keyboardEvent("к", ctrlAltR), {}, "Player"), "playerReloadSource");
  assert.equal(
    findHotkeyMatch(
      keyboardEvent("к", { ...ctrlAltR, getModifierState: (key) => key === "AltGraph" }),
      {},
      "Player",
    ),
    null,
  );
  // A character that needs AltGr on a layout still has to reach its shortcut;
  // the AltGr modifiers themselves are not part of the binding.
  assert.equal(
    findHotkeyMatch(
      keyboardEvent("/", { shiftKey: true, getModifierState: (key) => key === "AltGraph" }),
      {},
      "Global",
    ),
    "globalSearchFocus",
  );
  assert.equal(
    findHotkeyMatch(
      keyboardEvent("€", {
        code: "KeyE",
        ctrlKey: true,
        altKey: true,
        getModifierState: (key) => key === "AltGraph",
      }),
      {},
      "Player",
    ),
    null,
  );
  assert.equal(findHotkeyMatch(keyboardEvent("Process", { code: "KeyI" }), {}, "Player"), null);
  assert.equal(findHotkeyMatch(keyboardEvent("Dead", { code: "KeyI" }), {}, "Player"), null);
});

test("layout fallbacks cover shifted digits, punctuation keys and AltGr characters", () => {
  const azertyOne = keyboardEvent("1", { code: "Digit1", ctrlKey: true, shiftKey: true });
  assert.equal(findHotkeyMatch(azertyOne, {}, "Player"), "playerAnime4kOn");
  const azertyZero = keyboardEvent("0", { code: "Digit0", ctrlKey: true, shiftKey: true });
  assert.equal(findHotkeyMatch(azertyZero, {}, "Player"), "playerAnime4kOff");
  assert.equal(findHotkeyMatch(azertyZero, {}, "Global"), "globalUiScaleReset");

  const arabicZero = keyboardEvent("٠", { code: "Digit0", ctrlKey: true });
  assert.equal(findHotkeyMatch(arabicZero, {}, "Global"), "globalUiScaleReset");
  assert.equal(findHotkeyMatch(arabicZero, {}, "Player"), "playerAnime4kOff");

  assert.equal(
    findHotkeyMatch(keyboardEvent("ü", { code: "BracketLeft" }), {}, "Player"),
    "playerSpeedDown",
  );
  assert.equal(
    findHotkeyMatch(keyboardEvent("ъ", { code: "BracketRight" }), {}, "Player"),
    "playerSpeedUp",
  );

  const altGraph = (key: string, init: Partial<KeyboardEvent> = {}) =>
    keyboardEvent(key, { ...init, getModifierState: (state) => state === "AltGraph" });
  assert.equal(
    findHotkeyMatch(altGraph("[", { code: "Digit8", ctrlKey: true, altKey: true }), {}, "Player"),
    "playerSpeedDown",
  );
  assert.equal(
    findHotkeyMatch(altGraph("]", { code: "Digit9", ctrlKey: true, altKey: true }), {}, "Player"),
    "playerSpeedUp",
  );

  assert.equal(
    findHotkeyMatch(keyboardEvent("<", { code: "Comma" }), {}, "Player"),
    "playerFrameBack",
  );
  assert.equal(
    findHotkeyMatch(keyboardEvent(">", { code: "Period" }), {}, "Player"),
    "playerFrameForward",
  );

  // Shift itself must not turn an unshifted character into a digit shortcut.
  assert.equal(
    findHotkeyMatch(
      keyboardEvent("!", { code: "Digit1", ctrlKey: true, shiftKey: true }),
      {},
      "Player",
    ),
    null,
  );
});

test("recording keeps literal keys and playback keeps exact binding collisions", () => {
  assert.equal(eventToBinding(keyboardEvent("ы", { code: "KeyS", ctrlKey: true })), "ctrl+ы");
  assert.equal(eventToBinding(keyboardEvent("/", { code: "Digit7", shiftKey: true })), "shift+/");

  const match = createHotkeyMatcher(keyboardEvent("c"), {}, "Player");
  assert.equal(match("playerSubtitleCycleAlt"), true);
  assert.equal(match("playerClipRecord"), true);
  assert.equal(match("mangaMatch"), false);
});

test("global fallbacks yield to exact shortcuts only while their view owns the key", () => {
  const dom = new JSDOM("<main></main>");
  const { window } = dom;
  const document = window.document;
  const previousDocument = globalThis.document;
  globalThis.document = document;
  const settings = { mangaMatch: "ctrl+ы", playerMute: "shift+/" };

  function globalMatch(target: Element, key: string, init: KeyboardEventInit) {
    let match;
    target.addEventListener(
      "keydown",
      (event) => {
        match = findHotkeyMatch(event as KeyboardEvent, settings, "Global");
      },
      { once: true },
    );
    target.dispatchEvent(new window.KeyboardEvent("keydown", { key, ...init }));
    return match;
  }

  try {
    const main = document.querySelector("main")!;
    const reader = document.createElement("div");
    reader.setAttribute("data-harbor-manga-reader", "");
    document.body.append(reader);
    const cyrillic = { code: "KeyS", ctrlKey: true };
    assert.equal(globalMatch(reader, "ы", cyrillic), null);
    reader.remove();
    assert.equal(globalMatch(main, "ы", cyrillic), "globalSettingsOpen");

    const player = document.createElement("div");
    player.setAttribute("data-harbor-player", "");
    const control = player.appendChild(document.createElement("button"));
    document.body.append(player);
    const slash = { code: "Digit7", shiftKey: true };
    assert.equal(globalMatch(main, "/", slash), null);
    player.dataset.docked = "true";
    assert.equal(globalMatch(main, "/", slash), "globalSearchFocus");
    assert.equal(globalMatch(control, "/", slash), null);
    player.dataset.detached = "true";
    assert.equal(globalMatch(control, "/", slash), "globalSearchFocus");
    assert.equal(globalMatch(main, "/", { code: "Slash" }), "globalSearchFocus");
  } finally {
    globalThis.document = previousDocument;
    window.close();
  }
});

test("the player lock listener ignores competing player actions while locked", async () => {
  const { window } = new JSDOM("<div></div>");
  const { document } = window;
  const globals = {
    window,
    document,
    Element: window.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Reflect.get(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const root = createRoot(document.querySelector("div")!);
  let toggles = 0;
  function Blocker({ locked, hotkeys }: { locked: boolean; hotkeys: Record<string, string> }) {
    usePlayerInteractionBlocker({
      locked,
      hotkeys,
      onToggle: () => {
        toggles++;
      },
    });
    return null;
  }
  function press(key: string, init: KeyboardEventInit) {
    const event = new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  }

  try {
    const hotkeys = { playerStats: "ctrl+д" };
    await act(() => root.render(createElement(Blocker, { locked: false, hotkeys })));
    assert.equal(press("д", { code: "KeyL", ctrlKey: true }), false);
    assert.equal(toggles, 0);

    await act(() => root.render(createElement(Blocker, { locked: true, hotkeys })));
    assert.equal(press("д", { code: "KeyL", ctrlKey: true }), true);
    assert.equal(toggles, 1);

    const custom = { ...hotkeys, playerScreenLock: "alt+k" };
    await act(() => root.render(createElement(Blocker, { locked: true, hotkeys: custom })));
    assert.equal(press("д", { code: "KeyL", ctrlKey: true }), true);
    assert.equal(toggles, 1);
    assert.equal(press("k", { code: "KeyK", altKey: true }), true);
    assert.equal(toggles, 2);
  } finally {
    await act(() => root.unmount());
    Object.assign(globalThis, previous);
    window.close();
  }
});

test("supported catalogs translate the open-settings description", () => {
  const source = "Open Harbor's settings outside playback.";
  for (const [locale, catalog] of [
    ["ar", arSettings],
    ["pt", ptSettings],
    ["ru", ruSettings],
  ] as const) {
    assert.equal(typeof catalog[source], "string", locale);
    assert.notEqual(catalog[source]?.trim(), "", locale);
    assert.notEqual(catalog[source], source, locale);
  }
});

function effectContaining(source: string, needle: string): string {
  const needleAt = source.indexOf(needle);
  assert.notEqual(needleAt, -1, "expected Shell effect marker");
  const start = source.lastIndexOf("  useEffect(() => {", needleAt);
  const end = source.indexOf("\n  useEffect(() => {", needleAt);
  assert.notEqual(start, -1, "expected Shell effect start");
  assert.notEqual(end, -1, "expected Shell effect end");
  return source.slice(start, end);
}

test("typing targets retain ownership of the global shortcut", () => {
  const input = {
    nodeType: 1,
    tagName: "INPUT",
    isContentEditable: false,
    getAttribute: () => null,
  };
  const event = keyboardEvent("s", {
    ctrlKey: true,
    target: input as unknown as EventTarget,
    isComposing: false,
  });
  assert.equal(shouldHandleGlobalKeyboardEvent(event), false);
});

test("Shell consumes save before playback guards and navigates only outside playback", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const effect = effectContaining(app, '"globalSettingsOpen"');
  const order = [
    effect.indexOf("shouldHandleGlobalKeyboardEvent(e)"),
    effect.indexOf('"globalSettingsOpen"'),
    effect.indexOf("e.preventDefault();"),
    effect.indexOf("player ||"),
    effect.indexOf("document.querySelector('[data-harbor-multiview-active=\"true\"]')"),
    effect.indexOf("e.stopPropagation();"),
    effect.indexOf("if (e.repeat) return;"),
    effect.indexOf("openSettings();"),
  ];

  assert.equal(
    order.every((index) => index >= 0),
    true,
    order.join(","),
  );
  assert.equal(
    order.every((index, position) => position === 0 || order[position - 1] < index),
    true,
    order.join(","),
  );
  assert.match(effect, /window\.addEventListener\("keydown", onKey, true\);/);
  assert.match(effect, /window\.removeEventListener\("keydown", onKey, true\);/);
  assert.match(effect, /\[openSettings, player, settings\.hotkeys\]/);
});

test("Shell defers implicit zoom aliases owned by a Settings rebind", () => {
  const settingsRebind = keyboardEvent("=", { metaKey: true });
  assert.equal(
    findHotkeyMatch(settingsRebind, { globalSettingsOpen: "meta+=" }, "Global"),
    "globalSettingsOpen",
  );

  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const effect = effectContaining(app, "const isDefaultUiScaleUp");
  const guard = effect.indexOf('findHotkeyMatch(e, overrides, "Global")');
  const implicitAlias = effect.indexOf("isDefaultUiScaleUp(e)");

  assert.ok(guard >= 0, "expected UI-scale Global ownership guard");
  assert.ok(guard < implicitAlias, "expected the guard before implicit zoom alias matching");
  assert.match(
    effect,
    /globalMatch !== "globalUiScaleUp"[\s\S]*globalMatch !== "globalUiScaleDown"[\s\S]*globalMatch !== "globalUiScaleReset"/,
  );
});

test("Multiview marks only its active mounted root", () => {
  const multiview = readFileSync(new URL("../src/views/multiview.tsx", import.meta.url), "utf8");
  assert.match(multiview, /data-harbor-multiview-active=\{active \? "true" : undefined\}/);
});
