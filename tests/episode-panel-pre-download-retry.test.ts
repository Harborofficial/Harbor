import assert from "node:assert/strict";
import test from "node:test";
import { isManuallyStoppedForAutoPreDownload } from "../src/components/player/episode-panel/pre-download-retry.ts";

test("manually canceled download stays stopped for the current toggle activation", () => {
  const canceled = { status: "canceled" as const, canceledAt: 2400 };
  assert.equal(isManuallyStoppedForAutoPreDownload(canceled, 2000), true);
  assert.equal(isManuallyStoppedForAutoPreDownload(canceled, 2400), true);
  // Re-reading the same canceled item on remount has the same result.
  assert.equal(isManuallyStoppedForAutoPreDownload({ ...canceled }, 2000), true);
});

test("turning auto pre-download off and on again permits a new download", () => {
  const canceled = { status: "canceled" as const, canceledAt: 2400 };
  assert.equal(isManuallyStoppedForAutoPreDownload(canceled, 2401), false);
});

test("the next episode is not blocked by the previous episode's cancel", () => {
  const cancelledPrevious = { status: "canceled" as const, canceledAt: 2400 };
  const newNextEpisode = null;
  assert.equal(isManuallyStoppedForAutoPreDownload(cancelledPrevious, 2000), true);
  assert.equal(isManuallyStoppedForAutoPreDownload(newNextEpisode, 2000), false);
});

test("active, paused, and completed downloads do not count as manual cancellation", () => {
  for (const status of ["downloading", "paused", "done", "error"] as const) {
    assert.equal(isManuallyStoppedForAutoPreDownload({ status }, 2000), false);
  }
});

test("automatic AbortError without an explicit cancel timestamp does not block an enabled toggle", () => {
  assert.equal(isManuallyStoppedForAutoPreDownload({ status: "canceled" }, 2000), false);
  // Legacy canceled downloads remain stopped until the user explicitly toggles on.
  assert.equal(isManuallyStoppedForAutoPreDownload({ status: "canceled" }, 0), true);
});
