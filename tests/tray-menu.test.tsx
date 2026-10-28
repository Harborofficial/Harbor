import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { TrayMenu } from "../src/tray/tray-menu.tsx";
import { newerSnapshot, type TrayAction, type TraySnapshot } from "../src/tray/types.ts";

function snapshot(revision = 1): TraySnapshot {
  return {
    revision,
    openId: 1,
    open: true,
    closing: false,
    prefs: { closeToTray: false, alwaysOnTop: false, pauseMinimized: true, pauseUnfocused: false },
    display: {
      themeId: "nord",
      themes: [
        { id: "nord", name: "Nord" },
        { id: "light", name: "Light" },
      ],
      tokens: { "--color-surface": "#353a47", "--color-ink": "#eceff4" },
      labels: {
        show: "Show Harbor",
        theme: "Theme",
        alwaysOnTop: "Always on Top",
        pauseMinimized: "Pause When Minimized",
        pauseUnfocused: "Pause When Unfocused",
        closeToTray: "Close to Tray",
        quit: "Quit Harbor",
        error: "Could not apply this change. Try again.",
      },
      direction: "ltr",
      colorScheme: "dark",
      menuWidth: 276,
      themeWidth: 220,
    },
    layout: {
      width: 502,
      height: 450,
      mainX: 226,
      mainY: 150,
      mainWidth: 276,
      mainHeight: 300,
      themeX: 0,
      themeY: 0,
      themeWidth: 220,
      themeHeight: 450,
      submenuSide: "left",
    },
  };
}

async function harness(onAction: (action: TrayAction) => Promise<void> = async () => {}) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  let dismissed = 0;
  const submenu: boolean[] = [];
  const render = async (state = snapshot()) =>
    act(() =>
      root.render(
        createElement(TrayMenu, {
          snapshot: state,
          onAction,
          onDismiss: () => {
            dismissed++;
          },
          onSubmenuChange: async (open) => {
            submenu.push(open);
          },
        }),
      ),
    );
  const key = async (key: string) =>
    act(async () => {
      document.activeElement!.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  const click = async (element: Element) =>
    act(async () => {
      element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
  const pointer = async (element: Element, type: "pointerover" | "pointerout") =>
    act(async () => {
      element.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
    });
  await render();
  return {
    render,
    key,
    click,
    pointer,
    submenu,
    dismissed: () => dismissed,
    cleanup: async () => {
      await act(() => root.unmount());
      dom.window.close();
    },
  };
}

test("brand header is outside keyboard menu items, with icons and separate checked column", async () => {
  const h = await harness();
  try {
    const header = document.querySelector("header")!;
    assert.equal(header.textContent, "Harbor");
    assert.equal(header.querySelector("button,[tabindex],[role='menuitem']"), null);
    assert.ok(header.querySelector("svg"));
    const rows = [...document.querySelectorAll("[data-tray-action]")];
    assert.deepEqual(
      rows.map((row) => row.textContent),
      [
        "Show Harbor",
        "Theme",
        "Always on Top",
        "Pause When Minimized",
        "Pause When Unfocused",
        "Close to Tray",
        "Quit Harbor",
      ],
    );
    const checked = document.querySelector('[data-tray-action="pauseMinimized"]')!;
    assert.equal(checked.getAttribute("role"), "menuitemcheckbox");
    assert.equal(checked.getAttribute("aria-checked"), "true");
    assert.ok(checked.querySelector(".tray-row-icon svg"));
    assert.ok(checked.querySelector(".tray-row-state svg"));
    assert.equal(document.activeElement?.textContent, "Show Harbor");
  } finally {
    await h.cleanup();
  }
});

test("arrows enter theme radios, Escape closes submenu before main, and focus survives theme updates", async () => {
  const h = await harness();
  try {
    await h.key("ArrowDown");
    assert.equal(document.activeElement?.textContent, "Theme");
    await h.key("ArrowRight");
    assert.equal(document.activeElement?.getAttribute("role"), "menuitemradio");
    assert.equal(document.activeElement?.getAttribute("aria-checked"), "true");
    const state = snapshot(2);
    state.display!.themeId = "light";
    state.display!.tokens["--color-surface"] = "#fff";
    await h.render(state);
    assert.equal(document.activeElement?.textContent, "Nord");
    assert.equal(
      document.querySelector('[data-theme-id="light"]')?.getAttribute("aria-checked"),
      "true",
    );
    await h.key("ArrowDown");
    assert.equal(document.activeElement?.textContent, "Light");
    await h.key("Escape");
    assert.equal(h.dismissed(), 0);
    assert.equal(document.activeElement?.textContent, "Theme");
    await h.key("Escape");
    assert.equal(h.dismissed(), 1);
  } finally {
    await h.cleanup();
  }
});

test("the theme submenu opens on hover and closes when the pointer leaves", async () => {
  const h = await harness();
  try {
    const row = document.querySelector('[data-tray-action="theme"]')!;
    await h.pointer(row, "pointerover");
    assert.equal(h.submenu.at(-1), true);
    assert.ok(document.querySelector("[data-tray-themes]"));
    await h.pointer(row, "pointerout");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    assert.equal(h.submenu.at(-1), false);
    assert.equal(document.querySelector("[data-tray-themes]"), null);
  } finally {
    await h.cleanup();
  }
});

test("the focus ring waits for keyboard navigation", async () => {
  const h = await harness();
  try {
    const envelope = document.querySelector(".tray-envelope")!;
    assert.equal(envelope.getAttribute("data-modality"), "pointer");
    await h.key("ArrowDown");
    assert.equal(envelope.getAttribute("data-modality"), "keyboard");
  } finally {
    await h.cleanup();
  }
});

test("command failure keeps authoritative checks and exposes an error; repeated actions are gated", async () => {
  let reject: (error: Error) => void = () => {};
  let calls = 0;
  const h = await harness(async () => {
    calls++;
    await new Promise<void>((_, fail) => {
      reject = fail;
    });
  });
  try {
    const row = document.querySelector('[data-tray-action="alwaysOnTop"]')!;
    await h.click(row);
    await h.click(row);
    assert.equal(calls, 1);
    assert.equal(row.getAttribute("aria-checked"), "false");
    await act(async () => {
      reject(new Error("native window refused the command"));
    });
    assert.equal(row.getAttribute("aria-checked"), "false");
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /Could not apply/);
    assert.equal(h.dismissed(), 0);
  } finally {
    await h.cleanup();
  }
});

test("Space activates a checkbox and theme selection dispatches its real ID", async () => {
  const actions: TrayAction[] = [];
  const h = await harness(async (action) => {
    actions.push(action);
  });
  try {
    await h.key("ArrowDown");
    await h.key("ArrowDown");
    await h.key(" ");
    assert.deepEqual(actions, [{ type: "alwaysOnTop" }]);
    await h.click(document.querySelector('[data-tray-action="theme"]')!);
    await h.click(document.querySelector('[data-theme-id="light"]')!);
    assert.deepEqual(actions[1], { type: "theme", value: "light" });
  } finally {
    await h.cleanup();
  }
});

test("an older snapshot cannot overwrite a newer event or resurrect a closed menu", () => {
  const current = snapshot(5);
  current.open = false;
  assert.equal(newerSnapshot(current, snapshot(4)), current);
  assert.equal(newerSnapshot(current, snapshot(5)), current);
  assert.equal(newerSnapshot(current, snapshot(6)).revision, 6);
});

test("closing retains the existing menu until native dismissal completes", async () => {
  const h = await harness();
  try {
    const header = document.querySelector("header");
    await h.render({ ...snapshot(2), open: false, closing: true });
    assert.equal(document.querySelector("header"), header);
    assert.equal(document.querySelectorAll("[data-tray-action]").length, 7);
    await h.render({ ...snapshot(3), open: false, closing: false });
    assert.equal(document.querySelector("header"), null);
  } finally {
    await h.cleanup();
  }
});
