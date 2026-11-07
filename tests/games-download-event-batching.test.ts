import test from "node:test";
import assert from "node:assert/strict";
import {
  DOWNLOAD_PROGRESS_UI_INTERVAL,
  isImportantDownloadEvent,
} from "../src/lib/games/download-event-batching.ts";
test("important status changes are instant", () => {
  assert.equal(isImportantDownloadEvent(undefined, { status: "queued" }), true);
  assert.equal(isImportantDownloadEvent({ status: "downloading" }, { status: "failed" }), true);
  assert.equal(
    isImportantDownloadEvent(
      { status: "downloading", error: null },
      { status: "downloading", error: "network" },
    ),
    true,
  );
});
test("progress may be coalesced", () => {
  assert.equal(
    isImportantDownloadEvent({ status: "downloading" }, { status: "downloading" }),
    false,
  );
  assert.ok(DOWNLOAD_PROGRESS_UI_INTERVAL >= 500 && DOWNLOAD_PROGRESS_UI_INTERVAL <= 1500);
});
