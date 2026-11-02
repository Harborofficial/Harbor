import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, useRef } from "react";
import { GLASS_DEFAULTS, type GlassLayout } from "../src/lib/player/liquid-glass.ts";
import { useNativeLiquidGlass } from "../src/views/player/hooks/use-native-liquid-glass.ts";

test("native glass sends layout changes, hides with chrome, and clears without reopening playback", async () => {
  const dom = new JSDOM("<!doctype html><div id='mount'></div>", { pretendToBeVisual: true });
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
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
      },
    },
  });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const rect = this.hasAttribute("data-video")
      ? { x: 50, y: 20, width: 1000, height: 600 }
      : { x: 150, y: 170, width: 200, height: 60 };
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
      { ref: root, "data-active": active },
      createElement("div", { ref: video, "data-video": "" }),
      createElement(
        "div",
        { id: "chrome" },
        createElement(
          "div",
          {
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
  async function flush() {
    await act(async () => {
      await Promise.resolve();
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
      await Promise.resolve();
    });
  }
  try {
    await render(true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.layout.regions, [
      {
        x: 100,
        y: 150,
        width: 200,
        height: 60,
        radius: 30,
        radii: [30, 30, 30, 30],
      },
    ]);
    assert.equal(calls[0].args.layout.viewportWidth, 1000);
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
    assert.equal(calls.length, 2);
    assert.equal(calls[1].args.ownerId, owner);
    assert.equal(calls[1].args.layout.optics.zoom, 1.1);
    assert.equal(calls[1].args.layout.regions.length, 1);
    await act(async () => {
      document.getElementById("audio-panel")!.setAttribute("aria-hidden", "false");
    });
    await flush();
    assert.equal(calls.at(-1)!.args.layout.regions.length, 2);
    assert.equal(
      document.getElementById("audio-panel")!.hasAttribute("data-mpv-glass-active"),
      true,
    );
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
    await flush();
    assert.equal(calls.length, settledCount);
    assert.equal(frames.size, 0);
    await act(async () => {
      window.dispatchEvent(new dom.window.Event("harbor:mpv-output-layout"));
    });
    await flush();
    assert.equal(calls.length, settledCount + 1);
    assert.equal(calls.at(-1)!.args.layout.regions.length, 1);
    await render(false);
    assert.equal(calls.at(-1)!.args.layout.regions.length, 0);
    assert.equal(document.querySelector("main")!.getAttribute("data-active"), "false");
    assert.ok(calls.every((call) => call.command === "mpv_glass_layout"));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
