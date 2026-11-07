import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueuePreDownloadToast, dismissPreDownloadToast, preDownloadToastDurationMs, visiblePreDownloadToast,
} from "../src/components/player/episode-panel/pre-download-toast-queue.ts";

const enabled = { id: 1, kind: "enabled", label: "Automatic downloads on" };
const downloading = { id: 2, kind: "downloading", label: "Pre-downloading episode 6" };
const completed = { id: 3, kind: "completed", label: "Episode 6 saved" };
const disabled = { id: 4, kind: "disabled", label: "Automatic downloads off" };

test("enabling is shown first and fast download events queue behind it", () => {
  let queue = enqueuePreDownloadToast([], enabled);
  queue = enqueuePreDownloadToast(queue, downloading);
  queue = enqueuePreDownloadToast(queue, completed);
  assert.deepEqual(queue.map((x) => x.kind), ["enabled", "downloading", "completed"]);
  // The enabled icon remains active for its complete display interval.
  assert.equal(queue[0].id, enabled.id);
  queue = dismissPreDownloadToast(queue, enabled.id);
  assert.equal(queue[0].id, downloading.id);
  queue = dismissPreDownloadToast(queue, downloading.id);
  assert.equal(queue[0].id, completed.id);
});

test("a stale fade-out timer never dismisses the next icon", () => {
  const queue = [downloading, completed];
  assert.deepEqual(dismissPreDownloadToast(queue, enabled.id), queue);
  assert.equal(dismissPreDownloadToast(queue, downloading.id)[0].id, completed.id);
});

test("disabling takes priority and flushes stale download notifications", () => {
  const queue = enqueuePreDownloadToast([enabled, downloading, completed], disabled);
  assert.deepEqual(queue, [disabled]);
});

test("duplicate download notifications do not occupy the queue twice", () => {
  assert.deepEqual(
    enqueuePreDownloadToast([enabled, downloading], { ...downloading, id: 5 }),
    [enabled, downloading],
  );
});

test("individual events retain distinct IDs to remount and replay their animation", () => {
  const queue = enqueuePreDownloadToast([enabled], { ...downloading, id: 7 });
  assert.notEqual(queue[0].id, queue[1].id);
  assert.equal(dismissPreDownloadToast(queue, enabled.id)[0].id, 7);
});

test("toggle confirmations are shorter than downloading and completion feedback", () => {
  assert.equal(preDownloadToastDurationMs("enabled"), 1200);
  assert.equal(preDownloadToastDurationMs("disabled"), 1200);
  assert.equal(preDownloadToastDurationMs("downloading"), 2800);
  assert.equal(preDownloadToastDurationMs("completed"), 2800);
  assert.equal(preDownloadToastDurationMs("error"), 2800);
});

test("pre-download notifications are on by default and hide immediately when disabled", () => {
  const queue = [enabled, downloading];
  assert.equal(visiblePreDownloadToast(queue, true)?.id, enabled.id);
  assert.equal(visiblePreDownloadToast(queue, false), null);
  // Switching notifications off doesn't modify the download or selection state.
  assert.deepEqual(queue, [enabled, downloading]);
});

test("re-enabling notifications does not invent a new event", () => {
  assert.equal(visiblePreDownloadToast([], true), null);
  assert.equal(visiblePreDownloadToast([], false), null);
});
