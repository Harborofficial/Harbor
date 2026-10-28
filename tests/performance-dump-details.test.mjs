import assert from "node:assert/strict";
import test from "node:test";
import { buildDumpText } from "../src/lib/memory-dump-text.ts";

test("SIMKL diagnostic exports retain timing fields without unrelated detail values", () => {
  const text = buildDumpText({
    now: 1000,
    elapsedSec: 1,
    baselineHeapMB: 1,
    currentHeapMB: 1,
    peakHeapMB: 1,
    dom: { nodes: 1, imgs: 0, vids: 0 },
    networkBytes: 0,
    events: [
      {
        ts: 1000,
        kind: "mark",
        label: "plugin-store:subscriber",
        heapMB: 1,
        domNodes: 1,
        imgs: 0,
        vids: 0,
        detail: {
          store: "harbor-stream-plugins",
          subscriber: 2,
          durationMs: 17,
          source: "must-not-export",
        },
      },
      {
        ts: 1000,
        kind: "mark",
        label: "simkl:response-json",
        heapMB: 1,
        domNodes: 1,
        imgs: 0,
        vids: 0,
        detail: { path: "/sync/activities", durationMs: 42, privateField: "must-not-export" },
      },
    ],
    navStack: [],
    caches: [],
    cacheHistory: new Map(),
    renderReport: [],
    nativeMem: { harborRss: 0, webviewRss: 0, total: 0 },
    ramTier: "high",
    capabilities: { jsHeap: true, longTasks: true, nativeRss: false },
    drift: { ticks: 0, maxDriftMs: 0, stalls: 0, hiddenTicks: 0 },
    bridges: [],
  });
  assert.match(text, /simkl:response-json \{"path":"\/sync\/activities","durationMs":42\}/);
  assert.doesNotMatch(text, /must-not-export|privateField/);
  assert.match(text, /plugin-store:subscriber .*"store":"harbor-stream-plugins","subscriber":2/);
});
