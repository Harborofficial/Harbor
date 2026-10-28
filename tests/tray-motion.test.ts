import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { fadeTrayMenu, presentTrayMenu, presentTraySubmenu } from "../src/tray/tray-motion.ts";

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness() {
  const dom = new JSDOM("<!doctype html><div id='menu' style='opacity:0'></div>");
  const element = dom.window.document.getElementById("menu")!;
  let renderedOpacity: string | null = null;
  const animations: {
    frames: Keyframe[];
    options: KeyframeAnimationOptions;
    finish: () => void;
    cancelled: boolean;
  }[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: (target: Element) =>
      renderedOpacity !== null && target === element
        ? { opacity: renderedOpacity }
        : dom.window.getComputedStyle(target),
  });
  element.animate = (frames, options) => {
    const done = deferred();
    const animation = {
      frames: frames as Keyframe[],
      options: options as KeyframeAnimationOptions,
      finish: done.resolve,
      cancelled: false,
    };
    animations.push(animation);
    return {
      finished: done.promise,
      cancel: () => {
        animation.cancelled = true;
      },
    } as unknown as Animation;
  };
  return {
    element,
    animations,
    setRenderedOpacity(value: string | null) {
      renderedOpacity = value;
    },
    cleanup() {
      if (original) Object.defineProperty(globalThis, "getComputedStyle", original);
      else Reflect.deleteProperty(globalThis, "getComputedStyle");
      dom.window.close();
    },
  };
}

test("entry remains transparent until native presentation resolves", async () => {
  const h = harness();
  const native = deferred();
  try {
    const opening = presentTrayMenu(
      h.element,
      () => native.promise,
      () => false,
    );
    assert.equal(h.element.style.opacity, "0");
    assert.equal(h.animations.length, 0);
    native.resolve();
    await opening.ready;
    assert.equal(h.animations.length, 1);
    assert.deepEqual(h.animations[0].frames, [{ opacity: "0" }, { opacity: "1" }]);
    assert.equal(h.animations[0].options.duration, 120);
    h.animations[0].finish();
    await Promise.resolve();
    assert.equal(h.element.style.opacity, "1");
    opening.cancel();
  } finally {
    h.cleanup();
  }
});

test("closing before native presentation completes cannot start a hidden entry animation", async () => {
  const h = harness();
  const native = deferred();
  try {
    const opening = presentTrayMenu(
      h.element,
      () => native.promise,
      () => false,
    );
    opening.cancel();
    native.resolve();
    await opening.ready;
    assert.equal(h.animations.length, 0);
    assert.equal(h.element.style.opacity, "0");
  } finally {
    h.cleanup();
  }
});

test("native dismissal waits for fade completion and fires once", async () => {
  const h = harness();
  let completed = 0;
  try {
    h.element.style.opacity = "1";
    const cancel = fadeTrayMenu(h.element, 0, false, () => {
      completed++;
    });
    assert.equal(completed, 0);
    assert.deepEqual(h.animations[0].frames, [{ opacity: "1" }, { opacity: "0" }]);
    h.animations[0].finish();
    await Promise.resolve();
    assert.equal(completed, 1);
    cancel();
    assert.equal(h.animations[0].cancelled, true);
    assert.equal(completed, 1);
  } finally {
    h.cleanup();
  }
});

test("rapid reopen cancels the old exit and discards its late completion", async () => {
  const h = harness();
  let staleDismissals = 0;
  try {
    h.element.style.opacity = "1";
    const cancelExit = fadeTrayMenu(h.element, 0, false, () => {
      staleDismissals++;
    });
    cancelExit();
    const reopening = presentTrayMenu(
      h.element,
      async () => {},
      () => false,
    );
    await reopening.ready;
    h.animations[0].finish();
    await Promise.resolve();
    assert.equal(staleDismissals, 0);
    assert.equal(h.animations[0].cancelled, true);
    assert.equal(h.element.style.opacity, "1");
    reopening.cancel();
  } finally {
    h.cleanup();
  }
});

test("an interrupted entry exits from its current rendered opacity without jumping", async () => {
  const h = harness();
  let completed = 0;
  try {
    const opening = presentTrayMenu(
      h.element,
      async () => {},
      () => false,
    );
    await opening.ready;
    h.setRenderedOpacity("0.42");
    opening.cancel();
    h.setRenderedOpacity(null);
    assert.equal(h.element.style.opacity, "0.42");
    const cancelExit = fadeTrayMenu(h.element, 0, false, () => {
      completed++;
    });
    assert.deepEqual(h.animations[1].frames, [{ opacity: "0.42" }, { opacity: "0" }]);
    h.animations[1].finish();
    await Promise.resolve();
    assert.equal(completed, 1);
    cancelExit();
  } finally {
    h.cleanup();
  }
});

test("reduced motion presents and dismisses immediately without animation work", async () => {
  const h = harness();
  let completed = false;
  try {
    const opening = presentTrayMenu(
      h.element,
      async () => {},
      () => true,
    );
    await opening.ready;
    assert.equal(h.element.style.opacity, "1");
    opening.cancel();
    const cancelExit = fadeTrayMenu(h.element, 0, true, () => {
      completed = true;
    });
    assert.equal(completed, true);
    assert.equal(h.element.style.opacity, "0");
    assert.equal(h.animations.length, 0);
    cancelExit();
  } finally {
    h.cleanup();
  }
});

test("the theme submenu slides out of the main panel while it fades in", () => {
  const h = harness();
  try {
    const cancel = presentTraySubmenu(h.element, false, "right");
    assert.equal(h.animations.length, 1);
    assert.deepEqual(h.animations[0].frames, [
      { opacity: "0", transform: "translateX(-6px)" },
      { opacity: "1", transform: "translateX(0)" },
    ]);
    assert.equal(h.animations[0].options.duration, 120);
    cancel();
    assert.equal(h.animations[0].cancelled, true);
  } finally {
    h.cleanup();
  }
});

test("a left side submenu slides in from the other edge", () => {
  const h = harness();
  try {
    presentTraySubmenu(h.element, false, "left");
    assert.deepEqual(h.animations[0].frames, [
      { opacity: "0", transform: "translateX(6px)" },
      { opacity: "1", transform: "translateX(0)" },
    ]);
  } finally {
    h.cleanup();
  }
});

test("reduced motion opens the submenu without animation work", () => {
  const h = harness();
  try {
    presentTraySubmenu(h.element, true, "right");
    assert.equal(h.animations.length, 0);
  } finally {
    h.cleanup();
  }
});
