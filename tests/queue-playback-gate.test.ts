import assert from "node:assert/strict";
import test from "node:test";
import { hookHarness } from "./helpers/hook-harness.ts";
import { queueSessionIndex } from "../src/lib/queue-session.ts";
import { isNaturalEnd } from "../src/lib/player/playback-end.ts";

const item = {
  id: "entry",
  meta: { id: "show", type: "series", name: "Show" },
  episode: { season: 1, episode: 1 },
  addedAt: 1,
};
const src = { url: "url", meta: item.meta, episode: item.episode, queueItemId: item.id };
const nextEp = { season: 1, episode: 2 };

function gate() {
  return hookHarness("src/views/player/hooks/use-queue-playback.ts", "useQueuePlayback", {
    "@/lib/queue-session": { queueSessionIndex },
  });
}

test("Queue identity must match the current entry and episode", () => {
  assert.equal(queueSessionIndex(src, [item]), 0);
  assert.equal(queueSessionIndex({ ...src, queueItemId: undefined }, [item]), -1);
  assert.equal(queueSessionIndex({ ...src, queueItemId: "stale" }, [item]), -1);
  assert.equal(queueSessionIndex({ ...src, episode: nextEp }, [item]), -1);
});

test("Normal autoplay remains enabled for empty queues and unrelated or manual playback", () => {
  for (const [source, queue] of [
    [{ ...src, queueItemId: undefined }, []],
    [{ ...src, queueItemId: undefined }, [item]],
    [{ ...src, meta: { ...item.meta, id: "other" } }, [item]],
  ] as const) {
    const queueGate = gate();
    const calls: unknown[] = [];
    const auto = hookHarness(
      "src/views/player/hooks/use-auto-next-episode.ts",
      "useAutoNextEpisode",
      {
        "@/lib/player/playback-clock": { getPlaybackPosition: () => 600 },
        "@/lib/player/playback-end": { isNaturalEnd },
      },
    );
    try {
      const active = queueGate.render({ src: source, queue, enabled: true, status: "ended" });
      assert.equal(active, false);
      auto.render({
        src: source,
        snap: { status: "ended", durationSec: 600 },
        nextEp: active ? null : nextEp,
        canChangeEpisode: true,
        cancelled: false,
        startedNearEndRef: { current: false },
        goToEpisode: (ep: unknown) => calls.push(ep),
      });
      assert.deepEqual(calls, [nextEp]);
    } finally {
      queueGate.unmount();
      auto.unmount();
    }
  }
});

test("Completed queue playback stays in control after removal until the source changes", () => {
  const hook = gate();
  try {
    assert.equal(hook.render({ src, queue: [item], enabled: true, status: "playing" }), true);
    assert.equal(hook.render({ src, queue: [item], enabled: true, status: "ended" }), true);
    assert.equal(hook.render({ src, queue: [], enabled: true, status: "ended" }), true);
    assert.equal(
      hook.render({
        src: { ...src, queueItemId: undefined, url: "manual" },
        queue: [item],
        enabled: true,
        status: "ended",
      }),
      false,
    );
  } finally {
    hook.unmount();
  }
});

test("Clearing an active queue or selecting This show restores normal episode behavior", () => {
  const hook = gate();
  try {
    assert.equal(hook.render({ src, queue: [item], enabled: true, status: "playing" }), true);
    assert.equal(hook.render({ src, queue: [], enabled: true, status: "playing" }), false);
    assert.equal(hook.render({ src, queue: [item], enabled: false, status: "playing" }), false);
  } finally {
    hook.unmount();
  }
});
