import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { Resvg } from "@resvg/resvg-js";

function pixels(svg) {
  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels;
}

function alphaDifference(left, right) {
  assert.equal(left.length, right.length);
  let difference = 0;
  for (let i = 3; i < left.length; i += 4) difference += Math.abs(left[i] - right[i]);
  return difference / (left.length / 4);
}

test("Games animation renders the original controller and returns to rest without external assets", async () => {
  const data = JSON.parse(
    readFileSync(new URL("../src/assets/lottie/nav/games.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(data.assets, [], "the downloadable animation must work offline");
  const original = pixels(
    readFileSync(new URL("../src/assets/nav-icons/games.svg", import.meta.url), "utf8"),
  );
  const dom = new JSDOM("<!doctype html><div id='animation'></div>", { pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  // Lottie's image preloader initializes a transparent canvas even for vector-only
  // artwork. No canvas participates in the SVG rendering verified below.
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {} });
  const { default: lottie } = await import("lottie-web");
  const container = document.getElementById("animation");
  const animation = lottie.loadAnimation({
    container,
    renderer: "svg",
    loop: false,
    autoplay: false,
    animationData: data,
  });
  try {
    if (!animation.isLoaded) {
      await new Promise((resolve, reject) => {
        animation.addEventListener("DOMLoaded", resolve);
        animation.addEventListener("data_failed", () =>
          reject(new Error("Games animation could not load")),
        );
      });
    }
    const frame = (time) => {
      animation.goToAndStop(time, true);
      return pixels(container.querySelector("svg").outerHTML);
    };
    const rest = frame(0);
    assert.ok(
      alphaDifference(rest, original) < 0.05,
      "resting artwork preserves the controller outline, hollow center and controls",
    );
    assert.ok(
      alphaDifference(frame(animation.totalFrames / 3), rest) > 1,
      "hover animation visibly moves the controller",
    );
    assert.ok(
      alphaDifference(frame(animation.totalFrames - 1), rest) < 0.05,
      "finishing hover must not leave a jump to the static icon",
    );
    assert.equal(
      container.querySelector("image, foreignObject, script, animate, animateTransform"),
      null,
    );
    for (let time = 0; time < animation.totalFrames; time++) {
      animation.goToAndStop(time, true);
      const bounds = new Resvg(container.querySelector("svg").outerHTML, {
        font: { loadSystemFonts: false },
      }).getBBox();
      assert.ok(
        bounds.x >= -0.05 &&
          bounds.y >= -0.05 &&
          bounds.x + bounds.width <= data.w + 0.05 &&
          bounds.y + bounds.height <= data.h + 0.05,
        `frame ${time} must stay within the canvas so Settings previews do not clip`,
      );
    }
  } finally {
    animation.destroy();
    dom.window.close();
  }
});
