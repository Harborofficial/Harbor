import assert from "node:assert/strict";
import test from "node:test";
import { episodePanelQueueMode } from "../src/components/player/episode-panel/queue-mode";

test("ordinary series playback with an empty queue shows the episode list", () => {
  assert.deepEqual(
    episodePanelQueueMode({
      isSeries: true,
      queueSessionAvailable: false,
      queuePlaybackEnabled: false,
    }),
    { followQueue: false, canChooseQueue: false },
  );
});

test("an unrelated populated queue does not switch the series panel into Queue mode", () => {
  assert.deepEqual(
    episodePanelQueueMode({
      isSeries: true,
      queueSessionAvailable: false,
      queuePlaybackEnabled: false,
    }),
    { followQueue: false, canChooseQueue: false },
  );
});

test("an active queue session presents Queue mode and its selector", () => {
  assert.deepEqual(
    episodePanelQueueMode({
      isSeries: true,
      queueSessionAvailable: true,
      queuePlaybackEnabled: true,
    }),
    { followQueue: true, canChooseQueue: true },
  );
});

test("switching a queue session to This show preserves the option to switch back", () => {
  assert.deepEqual(
    episodePanelQueueMode({
      isSeries: true,
      queueSessionAvailable: true,
      queuePlaybackEnabled: false,
    }),
    { followQueue: false, canChooseQueue: true },
  );
});

test("a completed queue session keeps showing the effective mode during its EOF transition", () => {
  assert.deepEqual(
    episodePanelQueueMode({
      isSeries: true,
      queueSessionAvailable: false,
      queuePlaybackEnabled: true,
    }),
    { followQueue: true, canChooseQueue: true },
  );
});

test("movie playback does not expose series-specific mode switching", () => {
  assert.deepEqual(
    episodePanelQueueMode({
      isSeries: false,
      queueSessionAvailable: true,
      queuePlaybackEnabled: true,
    }),
    { followQueue: false, canChooseQueue: false },
  );
});
