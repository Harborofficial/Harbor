// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { useHoldSpeed, type HoldSpeed } from "../src/views/player/hooks/use-hold-speed.ts";
import { DragClickStage } from "../src/views/player/drag-click-stage.tsx";

const HOLD_MS = 400;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function pointer(win: JSDOM["window"], type: string) {
  const event = new win.MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: "mouse" },
    isPrimary: { value: true },
  });
  return event;
}

async function mountStage(options: { baseRate?: number; playing?: boolean } = {}) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const win = dom.window as unknown as Window & typeof globalThis;
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  // jsdom has no pointer capture; treat every capture as granted.
  Object.assign(win.Element.prototype, {
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => false,
  });

  const rates: number[] = [];
  const clicks: string[] = [];
  let api: HoldSpeed | null = null;

  function Host() {
    const hold = useHoldSpeed({
      enabled: true,
      getRate: () => options.baseRate ?? 1,
      canEngage: () => options.playing ?? true,
      setRate: (rate) => rates.push(rate),
    });
    api = hold;
    return createElement(DragClickStage, {
      drawMode: false,
      pipMode: false,
      onClick: () => clicks.push("click"),
      onDoubleClick: () => clicks.push("double"),
      holdSpeed: hold,
    });
  }

  const { createRoot } = await import("react-dom/client");
  const root = createRoot(win.document.getElementById("root")!);
  await act(() => root.render(createElement(Host)));
  const stage = win.document.querySelector("[data-player-click-stage]") as HTMLElement;

  const press = async () => {
    await act(() => {
      stage.dispatchEvent(pointer(win, "pointerdown"));
      stage.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
  };
  const release = async () => {
    await act(() => {
      stage.dispatchEvent(pointer(win, "pointerup"));
      // What a real release does: pointerup, then the compatibility mouseup
      // the stage watches for its click action.
      stage.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true, button: 0 }));
    });
  };
  const hold = async (ms = HOLD_MS) => {
    await press();
    await act(async () => {
      await sleep(ms);
    });
  };

  return {
    win,
    rates,
    clicks,
    stage,
    get api() {
      return api!;
    },
    press,
    release,
    hold,
    async unmount() {
      await act(() => root.unmount());
      dom.window.close();
    },
  };
}

test("holding the left button plays at 2x and releases back to the previous rate", async () => {
  const view = await mountStage({ baseRate: 1.5 });
  try {
    await view.hold();
    assert.deepEqual(view.rates, [2]);
    assert.equal(view.api.active, true);

    await view.release();
    assert.deepEqual(view.rates, [2, 1.5]);
    assert.equal(view.api.active, false);
    // The click that ends a hold must not also pause playback.
    assert.deepEqual(view.clicks, []);
    // A suppression left over by a release that produced no click expires.
    await act(async () => {
      await sleep(0);
    });
    assert.equal(view.api.consumeClick(), false);
  } finally {
    await view.unmount();
  }
});

test("a quick tap is still a click and never changes the rate", async () => {
  const view = await mountStage();
  try {
    await view.hold(100);
    await view.release();
    assert.deepEqual(view.rates, []);
    assert.deepEqual(view.clicks, ["click"]);
  } finally {
    await view.unmount();
  }
});

test("a cancelled hold restores the rate and leaves the click alone", async () => {
  const view = await mountStage();
  try {
    await view.hold();
    assert.deepEqual(view.rates, [2]);
    await act(() => {
      view.stage.dispatchEvent(pointer(view.win, "pointercancel"));
    });
    assert.deepEqual(view.rates, [2, 1]);
    assert.deepEqual(view.clicks, []);
    assert.equal(view.api.consumeClick(), false);
  } finally {
    await view.unmount();
  }
});

test("a hold does not engage while paused", async () => {
  const view = await mountStage({ playing: false });
  try {
    await view.hold();
    assert.deepEqual(view.rates, []);
    await view.release();
    assert.deepEqual(view.clicks, ["click"]);
  } finally {
    await view.unmount();
  }
});
