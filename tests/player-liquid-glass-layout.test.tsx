import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { act, createElement, useRef } from "react";
import { GLASS_DEFAULTS, type GlassLayout } from "../src/lib/player/liquid-glass.ts";
import { useNativeLiquidGlass } from "../src/views/player/hooks/use-native-liquid-glass.ts";

test("native glass sends layout changes, hides with chrome, and clears without reopening playback", async () => {
  const dom = new JSDOM("<!doctype html><div id='mount'></div>", { pretendToBeVisual: true });
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  let offset = 0;
  let pendingInvoke: Promise<void> | null = null;
  let failNextInvoke = false;
  const calls: { command: string; args: { ownerId: string; layout: GlassLayout } }[] = [];
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    MutationObserver: dom.window.MutationObserver,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.assign(dom.window, {
    __TAURI_INTERNALS__: {
      invoke: async (command: string, args: { ownerId: string; layout: GlassLayout }) => {
        calls.push({ command, args });
        if (failNextInvoke && args.layout.regions.length) {
          failNextInvoke = false;
          throw new Error("Native glass unavailable");
        }
        if (pendingInvoke && args.layout.regions.length) {
          const pending = pendingInvoke;
          pendingInvoke = null;
          await pending;
        }
      },
    },
  });
  const stylesheet = document.createElement("style");
  stylesheet.textContent =
    ".bg-elevated { background: rgb(24, 26, 30); }\n" +
    ".animate-menu-pop { animation: menu-pop 190ms ease; }\n" +
    readFileSync(new URL("../src/views/player/native-liquid-glass.css", import.meta.url), "utf8");
  document.head.appendChild(stylesheet);
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const rect = this.hasAttribute("data-video")
      ? { x: 50, y: 20, width: 1000, height: 600 }
      : { x: 150 + offset, y: 170, width: 200, height: 60 };
    return {
      ...rect,
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON() {},
    };
  };
  function Harness({ enabled, zoom }: { enabled: boolean; zoom: number }) {
    const root = useRef<HTMLDivElement>(null);
    const video = useRef<HTMLDivElement>(null);
    const active = useNativeLiquidGlass(root, video, enabled, "same-playback", {
      ...GLASS_DEFAULTS,
      zoom,
    });
    return createElement(
      "main",
      {
        ref: root,
        "data-active": active,
        "data-native-liquid-glass-enabled": enabled ? "true" : "false",
        "data-native-liquid-glass": active ? "on" : undefined,
      },
      createElement("div", { ref: video, "data-video": "" }),
      createElement(
        "div",
        { id: "chrome" },
        createElement(
          "div",
          {
            className: "bg-elevated",
            "data-mpv-glass": "",
            style: {
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              borderBottomRightRadius: 30,
              borderBottomLeftRadius: 30,
            },
          },
          createElement("div", { "data-native-glass-surface": "" }),
        ),
      ),
      createElement(
        "div",
        { "data-mpv-controls": "" },
        createElement("div", { id: "bottom-shared", "data-native-glass-surface": "" }),
        createElement("button", { id: "bottom-control", "data-mpv-glass": "" }),
        createElement("div", {
          id: "audio-panel",
          className: "bg-elevated animate-menu-pop",
          "data-mpv-glass": "panel",
          "aria-hidden": "true",
        }),
      ),
    );
  }
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("mount")!);
  const render = async (enabled: boolean, zoom = 1.08) => {
    await act(async () => {
      root.render(createElement(Harness, { enabled, zoom }));
    });
    await flush();
  };
  async function flush(settle = true) {
    await act(async () => {
      await Promise.resolve();
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
      await Promise.resolve();
    });
    if (settle) await act(async () => new Promise((resolve) => setTimeout(resolve, 220)));
  }
  try {
    await render(true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls.at(-1)!.args.layout.regions, [
      {
        x: 100,
        y: 150,
        width: 200,
        height: 60,
        radius: 30,
        radii: [30, 30, 30, 30],
      },
    ]);
    assert.equal(calls.at(-1)!.args.layout.viewportWidth, 1000);
    assert.equal(document.querySelector("main")!.getAttribute("data-active"), "true");
    assert.equal(
      document.getElementById("bottom-shared")!.hasAttribute("data-mpv-glass-active"),
      false,
    );
    assert.equal(
      document.getElementById("bottom-control")!.hasAttribute("data-mpv-glass-active"),
      false,
    );
    assert.equal(
      document.getElementById("audio-panel")!.hasAttribute("data-mpv-glass-active"),
      false,
    );
    const owner = calls[0].args.ownerId;
    await render(true, 1.25);
    assert.equal(calls.length, 3);
    assert.equal(calls.at(-1)!.args.ownerId, owner);
    assert.equal(calls.at(-1)!.args.layout.optics.zoom, 1.1);
    assert.equal(calls.at(-1)!.args.layout.regions.length, 1);
    const openingSurface = document.querySelector<HTMLElement>("#chrome > div")!;
    let openingMoving = true;
    openingSurface.getAnimations = () =>
      [{ playState: openingMoving ? "running" : "finished" }] as Animation[];
    openingSurface.dispatchEvent(new dom.window.Event("transitionrun", { bubbles: true }));
    await flush(false);
    assert.equal(calls.at(-1)!.args.layout.regions.length, 0);
    let finishOpening!: () => void;
    pendingInvoke = new Promise<void>((resolve) => {
      finishOpening = resolve;
    });
    await act(async () => {
      const audio = document.getElementById("audio-panel")!;
      const opened = audio.cloneNode(true) as HTMLElement;
      opened.setAttribute("aria-hidden", "false");
      audio.replaceWith(opened);
    });
    // A new panel is prepared before another animation frame or IPC response.
    assert.equal(calls.at(-1)!.args.layout.regions.length, 1);
    assert.equal(
      document.getElementById("audio-panel")!.hasAttribute("data-mpv-glass-active"),
      false,
    );
    assert.equal(
      document.getElementById("audio-panel")!.hasAttribute("data-mpv-glass-prepared"),
      true,
    );
    assert.equal(
      getComputedStyle(document.getElementById("audio-panel")!).backgroundColor,
      "rgba(0, 0, 0, 0)",
    );
    assert.equal(getComputedStyle(document.getElementById("audio-panel")!).animation, "none");
    await act(async () => {
      finishOpening();
      await Promise.resolve();
    });
    await flush(false);
    assert.equal(calls.at(-1)!.args.layout.regions.length, 1);
    assert.equal(
      document.getElementById("audio-panel")!.hasAttribute("data-mpv-glass-active"),
      true,
    );
    assert.equal(
      getComputedStyle(document.getElementById("audio-panel")!).backgroundColor,
      "rgba(0, 0, 0, 0.024)",
    );
    assert.equal(openingSurface.hasAttribute("data-mpv-glass-active"), false);
    openingMoving = false;
    openingSurface.dispatchEvent(new dom.window.Event("transitionend", { bubbles: true }));
    await flush(false);
    assert.equal(calls.at(-1)!.args.layout.regions.length, 2);
    assert.equal(
      document.getElementById("bottom-control")!.hasAttribute("data-mpv-glass-active"),
      false,
    );
    await act(async () => {
      document.getElementById("audio-panel")!.setAttribute("aria-hidden", "true");
    });
    await flush();
    assert.equal(calls.at(-1)!.args.layout.regions.length, 1);
    await act(async () => {
      document.getElementById("chrome")!.style.opacity = "0";
    });
    await flush();
    assert.equal(calls.at(-1)!.args.layout.regions.length, 0);
    await act(async () => {
      document.getElementById("chrome")!.style.opacity = "1";
    });
    await flush();
    assert.equal(calls.at(-1)!.args.layout.regions.length, 1);
    const settledCount = calls.length;
    for (const propertyName of ["background-color", "color", "box-shadow"]) {
      const transition = new dom.window.Event("transitionrun", { bubbles: true });
      Object.defineProperty(transition, "propertyName", { value: propertyName });
      document.querySelector("#chrome > div")!.dispatchEvent(transition);
      await flush();
      assert.equal(calls.length, settledCount, `${propertyName} must not toggle glass`);
      assert.equal(document.querySelector("main")!.getAttribute("data-active"), "true");
    }
    await flush();
    assert.equal(calls.length, settledCount);
    assert.equal(frames.size, 0);
    await act(async () => {
      window.dispatchEvent(new dom.window.Event("harbor:mpv-output-layout"));
    });
    await flush();
    assert.equal(calls.length, settledCount + 2);
    assert.equal(calls.at(-1)!.args.layout.regions.length, 1);
    await render(false);
    assert.equal(calls.at(-1)!.args.layout.regions.length, 0);
    assert.equal(document.querySelector("main")!.getAttribute("data-active"), "false");
    assert.equal(document.querySelectorAll("[data-mpv-glass-active]").length, 0);
    assert.equal(document.querySelectorAll("[data-mpv-glass-prepared]").length, 0);
    assert.equal(
      getComputedStyle(document.getElementById("audio-panel")!).animation,
      "menu-pop 190ms ease",
    );
    assert.equal(
      getComputedStyle(document.getElementById("audio-panel")!).backgroundColor,
      "rgb(24, 26, 30)",
    );
    // Even a stale active marker must not override the user's disabled setting.
    document.querySelector("main")!.setAttribute("data-native-liquid-glass", "on");
    document.getElementById("audio-panel")!.setAttribute("data-mpv-glass-active", "");
    document.getElementById("audio-panel")!.setAttribute("data-mpv-glass-prepared", "");
    assert.equal(
      getComputedStyle(document.getElementById("audio-panel")!).backgroundColor,
      "rgb(24, 26, 30)",
    );
    document.querySelector("main")!.removeAttribute("data-native-liquid-glass");
    document.getElementById("audio-panel")!.removeAttribute("data-mpv-glass-active");
    document.getElementById("audio-panel")!.removeAttribute("data-mpv-glass-prepared");
    await render(true);
    assert.equal(calls.at(-1)!.args.layout.regions.length, 1);
    const beforeMotion = calls.filter((call) => call.args.layout.regions.length > 0).length;
    for (offset = 1; offset <= 10; offset++) {
      window.dispatchEvent(new dom.window.Event("harbor:mpv-refresh-geom"));
      await flush(false);
    }
    assert.equal(calls.filter((call) => call.args.layout.regions.length > 0).length, beforeMotion);
    assert.equal(calls.at(-1)!.args.layout.regions.length, 0);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 220)));
    assert.equal(
      calls.filter((call) => call.args.layout.regions.length > 0).length,
      beforeMotion + 1,
    );
    assert.equal(calls.at(-1)!.args.layout.regions[0].x, 110);
    const surface = document.querySelector<HTMLElement>("#chrome > div")!;
    let animating = true;
    surface.getAnimations = () =>
      [{ playState: animating ? "running" : "finished" }] as Animation[];
    offset = 12;
    surface.dispatchEvent(new dom.window.Event("transitionrun", { bubbles: true }));
    await flush(false);
    const duringTransition = calls.length;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 220)));
    assert.equal(calls.length, duringTransition);
    assert.equal(calls.at(-1)!.args.layout.regions.length, 0);
    animating = false;
    surface.dispatchEvent(new dom.window.Event("transitionend", { bubbles: true }));
    await flush(false);
    assert.equal(calls.at(-1)!.args.layout.regions[0].x, 112);
    surface.setAttribute("data-mpv-glass-moving", "");
    await flush();
    assert.equal(calls.at(-1)!.args.layout.regions.length, 0);
    assert.equal(surface.hasAttribute("data-mpv-glass-active"), false);
    assert.equal(surface.hasAttribute("data-mpv-glass-prepared"), true);
    assert.equal(getComputedStyle(surface).backgroundColor, "rgba(0, 0, 0, 0)");
    const whileDragging = calls.length;
    offset = 13;
    window.dispatchEvent(new dom.window.Event("harbor:mpv-refresh-geom"));
    await flush();
    assert.equal(calls.length, whileDragging);
    assert.equal(getComputedStyle(surface).backgroundColor, "rgba(0, 0, 0, 0)");
    surface.removeAttribute("data-mpv-glass-moving");
    await flush(false);
    assert.equal(calls.at(-1)!.args.layout.regions[0].x, 113);
    surface.dataset.mpvGlass = "priority";
    Object.assign(surface.style, {
      borderStyle: "solid",
      borderTopWidth: "1px",
      borderBottomWidth: "1px",
      borderLeftWidth: "0px",
      borderRightWidth: "1px",
      borderTopLeftRadius: "0px",
      borderTopRightRadius: "16px",
      borderBottomRightRadius: "16px",
      borderBottomLeftRadius: "0px",
    });
    offset = 13.375;
    await flush();
    assert.deepEqual(calls.at(-1)!.args.layout.regions[0], {
      x: 113.375,
      y: 151,
      width: 199,
      height: 58,
      radius: 0,
      edgeFeather: 4,
      radii: [0, 15, 15, 0],
    });
    Object.assign(surface.style, {
      borderLeftWidth: "1px",
      borderRightWidth: "0px",
      borderTopLeftRadius: "16px",
      borderTopRightRadius: "0px",
      borderBottomRightRadius: "0px",
      borderBottomLeftRadius: "16px",
    });
    offset = 20.125;
    await flush();
    assert.deepEqual(calls.at(-1)!.args.layout.regions[0], {
      x: 121.125,
      y: 151,
      width: 199,
      height: 58,
      radius: 15,
      edgeFeather: 4,
      radii: [15, 0, 0, 15],
    });
    offset = 20;
    window.dispatchEvent(new dom.window.Event("harbor:mpv-refresh-geom"));
    await flush();
    await render(false);
    const afterDisable = calls.length;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 220)));
    assert.equal(calls.length, afterDisable);
    assert.equal(calls.at(-1)!.args.layout.regions.length, 0);
    let finishInvoke!: () => void;
    pendingInvoke = new Promise<void>((resolve) => {
      finishInvoke = resolve;
    });
    await render(true);
    await render(false);
    assert.equal(
      getComputedStyle(document.getElementById("audio-panel")!).backgroundColor,
      "rgb(24, 26, 30)",
    );
    await act(async () => {
      finishInvoke();
      await Promise.resolve();
    });
    await flush();
    assert.equal(document.querySelectorAll("[data-mpv-glass-active]").length, 0);
    assert.equal(document.querySelectorAll("[data-mpv-glass-prepared]").length, 0);
    assert.equal(
      getComputedStyle(document.getElementById("audio-panel")!).backgroundColor,
      "rgb(24, 26, 30)",
    );
    failNextInvoke = true;
    await render(true);
    assert.equal(document.querySelectorAll("[data-mpv-glass-prepared]").length, 0);
    assert.equal(getComputedStyle(surface).backgroundColor, "rgb(24, 26, 30)");
    window.dispatchEvent(new dom.window.Event("harbor:mpv-refresh-geom"));
    await flush();
    assert.equal(surface.hasAttribute("data-mpv-glass-active"), true);
    assert.ok(calls.every((call) => call.command === "mpv_glass_layout"));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
