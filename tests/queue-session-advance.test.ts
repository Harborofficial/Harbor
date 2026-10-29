import assert from "node:assert/strict";
import test from "node:test";
import { hookHarness } from "./helpers/hook-harness.ts";
import { isNaturalEnd } from "../src/lib/player/playback-end.ts";
import { queueSessionIndex } from "../src/lib/queue-session.ts";

const first = { id: "a", meta: { id: "movie-a", type: "movie", name: "A" }, addedAt: 1 };
const second = { id: "b", meta: { id: "movie-b", type: "movie", name: "B" }, addedAt: 2 };

function setup() {
  const calls: unknown[] = [];
  let queue = [first, second];
  const hook = hookHarness("src/views/player/hooks/use-queue-advance.ts", "useQueueAdvance", {
    "@/lib/queue-session": { queueSessionIndex },
    "@/lib/player/playback-clock": { getPlaybackPosition: () => 600 },
    "@/lib/player/playback-end": { isNaturalEnd },
    "@/lib/queue": {
      getSleepAtEnd: () => false,
      setSleepAtEnd: (value: boolean) => calls.push(["sleep", value]),
      queueIndexOf: (meta: { id: string }) => queue.findIndex((item) => item.meta.id === meta.id),
      queueRemove: (id: string) => {
        calls.push(["remove", id]);
        queue = queue.filter((item) => item.id !== id);
      },
    },
  });
  const render = (src: Record<string, unknown>, instantPlay = false) =>
    hook.render({
      src,
      queue,
      snap: { status: "ended", durationSec: 600 },
      isLive: false,
      roomGuest: false,
      queueDrivesNav: true,
      instantPlay,
      startedNearEndRef: { current: false },
      openPicker: (...args: unknown[]) => calls.push(["picker", ...args]),
      closePlayer: () => calls.push(["close"]),
    });
  return { hook, calls, render };
}

test("Finishing unrelated playback neither starts nor consumes the queue", () => {
  const { hook, calls, render } = setup();
  try {
    render({ url: "other", meta: { id: "other" } });
    assert.deepEqual(calls, []);
  } finally {
    hook.unmount();
  }
});

test("Manual playback of a queued title does not consume or advance the queue", () => {
  const { hook, calls, render } = setup();
  try {
    render({ url: "manual", meta: first.meta });
    assert.deepEqual(calls, []);
  } finally {
    hook.unmount();
  }
});

for (const instantPlay of [false, true]) {
  test(`Queue advancement carries the next entry identity and respects instantPlay=${instantPlay}`, () => {
    const { hook, calls, render } = setup();
    try {
      const src = { url: "queued", meta: first.meta, queueItemId: first.id };
      render(src, instantPlay);
      render(src, instantPlay);
      assert.deepEqual(calls, [
        ["remove", first.id],
        [
          "picker",
          second.meta,
          undefined,
          { autoPlay: instantPlay, resume: true, queueItemId: second.id },
        ],
      ]);
    } finally {
      hook.unmount();
    }
  });
}

test("The last queued item closes playback once instead of restarting the queue", () => {
  const { hook, calls, render } = setup();
  try {
    const src = { url: "last", meta: second.meta, queueItemId: second.id };
    render(src);
    render(src);
    assert.deepEqual(calls, [["remove", second.id], ["close"]]);
  } finally {
    hook.unmount();
  }
});
