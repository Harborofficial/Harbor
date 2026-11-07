import assert from "node:assert/strict";
import { test } from "node:test";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { previewWindow } from "../src/lib/trickplay-policy";
import {
  trickplaySetUrl,
  trickplayStop,
  trickplayGet,
  trickplayWarm,
  trickplayPrefetchHover,
  thumbCacheGet,
  thumbCacheReceivedAt,
  thumbCacheSet,
  subscribeThumbnails,
} from "../src/lib/trickplay";

test("preview windows follow scrubbing direction and stay inside the title", () => {
  assert.deepEqual(previewWindow(20, 100, 1), [20, 22, 24, 26, 18]);
  assert.deepEqual(previewWindow(20, 100, -1), [20, 18, 16, 14, 22]);
  assert.deepEqual(previewWindow(0, 5, 1), [0, 2, 4]);
  assert.deepEqual(previewWindow(99, 100, 1), [98]);
  assert.deepEqual(previewWindow(10, Infinity, 1), []);
  assert.deepEqual(previewWindow(NaN, 100, 1), []);
});

test("thumbnail events and late requests cannot cross playback sessions", async () => {
  const originalWindow = globalThis.window;
  Object.assign(globalThis, { window: { crypto: globalThis.crypto } });
  let session = 0;
  let resolveFrame: ((value: string) => void) | undefined;
  const prefetch: number[][] = [];
  const handlers = new Map<number, number>();
  mockIPC((command, args) => {
    if (command === "plugin:event|listen") {
      handlers.set(args.handler as number, args.handler as number);
      return args.handler;
    }
    if (command === "plugin:event|unlisten") {
      handlers.delete(args.eventId as number);
      return;
    }
    if (command === "plugin:event|emit") {
      for (const handler of handlers.values()) {
        window.__TAURI_INTERNALS__.runCallback(handler, { payload: args.payload });
      }
      return;
    }
    if (command === "thumbs_set_url") return `session-${++session}`;
    if (command === "thumbs_get")
      return new Promise<string>((resolve) => {
        resolveFrame = resolve;
      });
    if (command === "thumbs_prefetch") prefetch.push(args.times as number[]);
  });
  const notifications: number[] = [];
  const unsubscribe = subscribeThumbnails((bucket) => notifications.push(bucket));
  try {
    await trickplaySetUrl("first");
    await emit("thumb-ready", { session: "session-1", bucket: 1, uri: "first-frame" });
    assert.equal(thumbCacheGet(1), "first-frame");
    assert.ok(thumbCacheReceivedAt(1)! <= performance.now());
    assert.deepEqual(notifications, [-1, 1]);
    const pending = trickplayGet(4);
    await new Promise((resolve) => setImmediate(resolve));
    await trickplaySetUrl("second");
    resolveFrame!("late-first-frame");
    assert.equal(await pending, null);
    await emit("thumb-ready", { session: "session-1", bucket: 1, uri: "stale" });
    assert.equal(thumbCacheGet(1), undefined);
    assert.equal(thumbCacheGet(2), undefined);
    await emit("thumb-ready", { session: "session-2", bucket: 3, uri: "second-frame" });
    assert.equal(thumbCacheGet(3), "second-frame");
    await trickplayWarm(20, 100, true);
    assert.deepEqual(prefetch.at(-1), [20, 30, 40, 50, 10]);
    await trickplayPrefetchHover(30);
    await trickplayPrefetchHover(20);
    assert.deepEqual(prefetch.at(-1), [20, 18, 16, 14, 22]);
    await trickplayWarm(20, 100, false);
    const count = prefetch.length;
    await trickplayPrefetchHover(40);
    assert.equal(prefetch.length, count);
    assert.deepEqual(prefetch.at(-1), []);
    for (let bucket = 0; bucket < 513; bucket++) thumbCacheSet(bucket, "frame");
    assert.equal(thumbCacheGet(0), undefined);
    assert.equal(thumbCacheReceivedAt(0), undefined);
    await trickplayStop();
    assert.equal(thumbCacheGet(512), undefined);
    assert.equal(thumbCacheReceivedAt(512), undefined);
  } finally {
    unsubscribe();
    await trickplayStop();
    clearMocks();
    Object.assign(globalThis, { window: originalWindow });
  }
});
