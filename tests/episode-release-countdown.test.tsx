import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { EpisodeReleaseCountdown } from "../src/components/episode-release-countdown.tsx";

test("countdowns share a minute timer, expire without claiming availability, and clean up", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const originalNow = Date.now;
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  let clock = Date.parse("2026-10-21T12:00:00Z");
  let tick: (() => void) | undefined;
  let timers = 0;
  let cleared = 0;
  Date.now = () => clock;
  globalThis.setInterval = ((callback: () => void, ms: number) => {
    assert.equal(ms, 60000);
    tick = callback;
    timers++;
    return 1;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = (() => {
    cleared++;
  }) as typeof clearInterval;
  try {
    await act(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement(EpisodeReleaseCountdown, { date: "2026-10-21T12:02:00Z" }),
          createElement(EpisodeReleaseCountdown, { date: "2026-10-21T12:02:00Z" }),
        ),
      ),
    );
    assert.equal(document.querySelectorAll("time").length, 2);
    assert.match(document.body.textContent ?? "", /In 2 min/);
    assert.equal(timers, 1);
    clock += 60000;
    await act(() => tick!());
    assert.match(document.body.textContent ?? "", /In 1 min/);
    clock += 60000;
    await act(() => tick!());
    assert.equal(document.querySelectorAll("time").length, 0);
    assert.equal(document.body.textContent, "");
    assert.equal(cleared, 1);
  } finally {
    await act(() => root.unmount());
    Date.now = originalNow;
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
    dom.window.close();
  }
});
