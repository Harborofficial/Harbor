import assert from "node:assert/strict";
import test from "node:test";
import { hookHarness } from "./helpers/hook-harness.ts";

const queue = [
  { meta: { id: "queued-before" }, episode: undefined },
  { meta: { id: "current-show" }, episode: { season: 1, episode: 5 } },
  { meta: { id: "queued-after" }, episode: undefined },
];

function setup(queueDrivesNav: boolean, currentIndex = 1) {
  const calls: string[] = [];
  const hook = hookHarness("src/views/player/hooks/use-queue-nav.ts", "useQueueNav", {
    "@/lib/queue": {
      useQueue: () => queue,
      queueIndexOf: () => currentIndex,
    },
  });

  const current = queue[currentIndex];
  const nav = hook.render({
    src: { meta: current.meta, episode: current.episode },
    adjacent: {
      prev: { season: 1, episode: 4 },
      next: { season: 1, episode: 6 },
    },
    canChangeEpisode: true,
    isLiveLike: false,
    queueDrivesNav,
    goToEpisode: (episode: { season: number; episode: number }) => {
      calls.push(`episode:${episode.season}:${episode.episode}`);
    },
    openPicker: (meta: { id: string }) => {
      calls.push(`picker:${meta.id}`);
    },
  });

  return { hook, nav, calls };
}

test("Queue mode navigates to queued items instead of adjacent show episodes", () => {
  const { hook, nav, calls } = setup(true);
  try {
    assert.equal(nav.hasNextEpisodeNow, true);
    assert.equal(nav.hasPrevEpisodeNow, true);
    nav.playNext();
    nav.playPrev();
    assert.deepEqual(calls, ["picker:queued-after", "picker:queued-before"]);
  } finally {
    hook.unmount();
  }
});

test("This show mode navigates to adjacent episodes instead of queued items", () => {
  const { hook, nav, calls } = setup(false);
  try {
    assert.equal(nav.hasNextEpisodeNow, true);
    assert.equal(nav.hasPrevEpisodeNow, true);
    nav.playNext();
    nav.playPrev();
    assert.deepEqual(calls, ["episode:1:6", "episode:1:4"]);
  } finally {
    hook.unmount();
  }
});

test("Queue mode does not fall back to the show at the end of the queue", () => {
  const { hook, nav, calls } = setup(true, 2);
  try {
    assert.equal(nav.hasNextEpisodeNow, false);
    nav.playNext();
    assert.deepEqual(calls, []);
  } finally {
    hook.unmount();
  }
});

test("Queue mode does not fall back to the show at the start of the queue", () => {
  const { hook, nav, calls } = setup(true, 0);
  try {
    assert.equal(nav.hasPrevEpisodeNow, false);
    nav.playPrev();
    assert.deepEqual(calls, []);
  } finally {
    hook.unmount();
  }
});
