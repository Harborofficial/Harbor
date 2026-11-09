import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyFeaturedState,
  featuredStatusSignature,
  reconcileFeaturedSlots,
  placeFeaturedDownloads,
  restoreFeaturedSlots,
  serializeFeaturedSlots,
} from "../src/lib/games/download-featured.ts";
import type { GameDownloadBundle } from "../src/lib/games/download-game-groups.ts";
import type { DownloadItem } from "../src/lib/games/download-presentation.ts";
import type { GameTransfer } from "../src/lib/games/transfers.ts";

function game(
  id: string,
  status: GameTransfer["status"],
  created: number,
  updated = created,
): GameDownloadBundle {
  const item: DownloadItem = {
    kind: "direct",
    record: {
      id,
      profile: "profile-a",
      name: id,
      game: { id, name: id },
      status,
      url: "https://example.test/" + id,
      destination: "C:\\\\Games\\\\" + id,
      createdAt: created,
      updatedAt: updated,
      received: 50,
      total: 100,
      expectedBytes: 100,
      expectedSha256: null,
      sha256: null,
      validator: null,
      bytesPerSecond: status === "downloading" ? 25 : 0,
      error: null,
    },
  };
  return {
    key: JSON.stringify(["game", "profile-a", id, "game"]),
    name: id,
    items: [item],
    state: status === "downloading" ? "active" : status === "complete" ? "complete" : "queue",
    received: 50,
    total: 100,
    rate: status === "downloading" ? 25 : 0,
    latestAt: updated,
    completed: 0,
  };
}
function labels(state: ReturnType<typeof emptyFeaturedState>) {
  return state.slots.map((pin) => (pin?.key ? JSON.parse(pin.key)[2] : null));
}

test("two featured games retain left and right positions across progress and pause events", () => {
  const a = game("A", "downloading", 100),
    b = game("B", "downloading", 200);
  let state = reconcileFeaturedSlots(emptyFeaturedState(), [a, b]);
  assert.deepEqual(labels(state), ["A", "B"]);
  const previousSignature = featuredStatusSignature([a, b]);
  const afterProgress = [
    game("B", "downloading", 200, 100000),
    game("A", "downloading", 100, 100001),
  ];
  assert.equal(featuredStatusSignature(afterProgress), previousSignature);
  state = reconcileFeaturedSlots(state, afterProgress);
  assert.deepEqual(labels(state), ["A", "B"]);
  state = reconcileFeaturedSlots(state, [
    game("A", "paused", 100, 100002),
    game("B", "paused", 200, 100003),
  ]);
  assert.deepEqual(labels(state), ["A", "B"]);
});

test("a third game replaces only the oldest slot and the displaced game remains in downloads", () => {
  const a = game("A", "paused", 100),
    b = game("B", "paused", 200);
  let state = reconcileFeaturedSlots(emptyFeaturedState(), [a, b]);
  const c = game("C", "queued", 300);
  state = reconcileFeaturedSlots(state, [a, b, c]);
  assert.deepEqual(labels(state), ["C", "B"]);
  const runningA = game("A", "downloading", 100, 99999);
  // A third-party progress update or queue transition for an existing download
  // does not swap cards unless it actually transitions into a new run.
  state = reconcileFeaturedSlots(state, [runningA, b, c]);
  assert.deepEqual(labels(state), ["C", "A"]);
  const d = game("D", "downloading", 400);
  state = reconcileFeaturedSlots(state, [runningA, b, c, d]);
  assert.deepEqual(labels(state), ["D", "A"]);
  assert.ok([runningA, b, c, d].some((group) => group.name === "A"));
});

test("new download replaces the older featured side, never forces both cards to swap", () => {
  let state = reconcileFeaturedSlots(emptyFeaturedState(), [
    game("A", "downloading", 100),
    game("B", "downloading", 200),
  ]);
  state = reconcileFeaturedSlots(state, [
    game("A", "paused", 100),
    game("B", "downloading", 200),
    game("C", "downloading", 300),
  ]);
  assert.deepEqual(labels(state), ["C", "B"]);
  state = reconcileFeaturedSlots(state, [
    game("A", "paused", 100),
    game("B", "downloading", 200),
    game("C", "paused", 300),
  ]);
  assert.deepEqual(labels(state), ["C", "B"]);
  state = reconcileFeaturedSlots(state, [
    game("A", "paused", 100),
    game("B", "downloading", 200),
    game("C", "paused", 300),
    game("D", "downloading", 400),
  ]);
  assert.deepEqual(labels(state), ["C", "D"]);
});

test("save and restore maintain card positions across page reloads", () => {
  let state = reconcileFeaturedSlots(emptyFeaturedState(), [
    game("A", "downloading", 100),
    game("B", "paused", 200),
  ]);
  state = reconcileFeaturedSlots(state, [
    game("A", "downloading", 100),
    game("B", "paused", 200),
    game("C", "downloading", 300),
  ]);
  const saved = serializeFeaturedSlots(state);
  const restored = restoreFeaturedSlots(saved);
  assert.equal(restored.initialized, false);
  state = reconcileFeaturedSlots(restored, [
    game("B", "paused", 200),
    game("C", "paused", 300),
    game("A", "downloading", 100),
  ]);
  assert.deepEqual(labels(state), ["C", "B"]);
});

test("new game waits until a distinct start event, rather than being promoted on progress", () => {
  let state = reconcileFeaturedSlots(emptyFeaturedState(), [
    game("A", "downloading", 100),
    game("B", "downloading", 200),
    game("C", "paused", 300),
  ]);
  assert.deepEqual(labels(state), ["B", "C"]);
  state = reconcileFeaturedSlots(state, [
    game("A", "downloading", 100, 30000),
    game("B", "downloading", 200, 30002),
    game("C", "paused", 300, 30003),
  ]);
  assert.deepEqual(labels(state), ["B", "C"]);
  state = reconcileFeaturedSlots(state, [
    game("A", "downloading", 100),
    game("B", "downloading", 200),
    game("C", "complete", 300),
  ]);
  assert.deepEqual(labels(state), ["B", "A"]);
});

test("malformed saved keys cannot install duplicate or invalid pin state", () => {
  assert.deepEqual(restoreFeaturedSlots("{bad"), emptyFeaturedState());
  assert.deepEqual(
    restoreFeaturedSlots(
      JSON.stringify({
        version: 1,
        slots: [
          { key: "x", order: 1 },
          { key: "x", order: 2 },
        ],
      }),
    ),
    emptyFeaturedState(),
  );
  assert.deepEqual(
    restoreFeaturedSlots(JSON.stringify({ version: 1, slots: [{ key: "x", order: -2 }, null] })),
    emptyFeaturedState(),
  );
});

test("displaced downloads continue in the list and only the clicked-slot games are featured", () => {
  const a = game("A", "downloading", 100),
    b = game("B", "paused", 200),
    c = game("C", "downloading", 300);
  let state = reconcileFeaturedSlots(emptyFeaturedState(), [a, b]);
  state = reconcileFeaturedSlots(state, [a, b, c]);
  const keys = state.slots.flatMap((pin) => (pin ? [pin.key] : []));
  const placed = placeFeaturedDownloads([c, a, b], keys);
  assert.deepEqual(
    placed.featured.map((group) => group.name),
    ["C", "B"],
  );
  assert.deepEqual(
    placed.list.map((group) => group.name),
    ["A"],
  );
  assert.equal(placed.list[0].items[0].record.status, "downloading");
});

test("a third download created on the Sources tab promotes after the Downloads tab remounts", () => {
  const first = game("First", "paused", 100);
  const second = game("Second", "paused", 200);
  const before = reconcileFeaturedSlots(emptyFeaturedState(), [first, second]);
  const storageValue = serializeFeaturedSlots(before);
  // GameDownloads unmounts when the user opens Sources. Start the third game
  // there: no React featured-hook reconciliation occurs until the user returns.
  const newGame = game("Third", "queued", 300);
  const resumedPage = restoreFeaturedSlots(storageValue);
  const after = reconcileFeaturedSlots(resumedPage, [first, second, newGame]);
  assert.deepEqual(labels(after), ["Third", "Second"]);
  const shown = placeFeaturedDownloads(
    [first, second, newGame],
    after.slots.flatMap((pin) => (pin ? [pin.key] : [])),
  );
  assert.deepEqual(
    shown.featured.map((g) => g.name),
    ["Third", "Second"],
  );
  assert.deepEqual(
    shown.list.map((g) => g.name),
    ["First"],
  );
  assert.equal(shown.list[0].items[0].record.status, "paused");
});

test("a third game created in the same second is detected across a remount", () => {
  const first = game("First", "paused", 100);
  const second = game("Second", "paused", 200);
  const before = reconcileFeaturedSlots(emptyFeaturedState(), [first, second]);
  const after = reconcileFeaturedSlots(restoreFeaturedSlots(serializeFeaturedSlots(before)), [
    first,
    second,
    game("Third", "downloading", 200),
  ]);
  assert.deepEqual(labels(after), ["Third", "Second"]);
});

test("restoring old slot storage migrates to a newer download without losing slot order", () => {
  const first = game("First", "paused", 100);
  const second = game("Second", "paused", 200);
  const legacy = JSON.stringify({
    version: 1,
    slots: [
      { key: first.key, order: 1 },
      { key: second.key, order: 2 },
    ],
  });
  const after = reconcileFeaturedSlots(restoreFeaturedSlots(legacy), [
    first,
    second,
    game("Third", "downloading", 300),
  ]);
  assert.deepEqual(labels(after), ["Third", "Second"]);
  assert.equal(JSON.parse(serializeFeaturedSlots(after)).version, 3);
});

test("restoration does not treat older unfinished downloads as newly started games", () => {
  const old = game("Old", "paused", 80);
  const first = game("First", "paused", 100);
  const second = game("Second", "paused", 200);
  const before = reconcileFeaturedSlots(emptyFeaturedState(), [old, first, second]);
  assert.deepEqual(labels(before), ["First", "Second"]);
  const after = reconcileFeaturedSlots(restoreFeaturedSlots(serializeFeaturedSlots(before)), [
    old,
    first,
    second,
  ]);
  assert.deepEqual(labels(after), ["First", "Second"]);
});

test("a completed group or progress-only event never replaces the pinned pair on remount", () => {
  const first = game("First", "paused", 100);
  const second = game("Second", "paused", 200);
  const before = reconcileFeaturedSlots(emptyFeaturedState(), [first, second]);
  const after = reconcileFeaturedSlots(restoreFeaturedSlots(serializeFeaturedSlots(before)), [
    game("First", "paused", 100, 10000),
    game("Second", "paused", 200, 11000),
    game("Third", "complete", 300),
  ]);
  assert.deepEqual(labels(after), ["First", "Second"]);
});

test("a newer game replaces stale featured slots even if an earlier UI already marked it seen", () => {
  // This reproduces the saved-state bug after a third game had already been
  // seen while it was incorrectly left below the featured pair.
  const oldest = game("First", "paused", 1792971405);
  const middle = game("Second", "paused", 1792975663);
  const newest = game("Third", "paused", 1792980597);
  const before = reconcileFeaturedSlots(emptyFeaturedState(), [oldest, middle]);
  const stale = restoreFeaturedSlots(
    JSON.stringify({
      version: 2,
      slots: before.slots,
      known: [oldest.key, middle.key, newest.key],
      lastSeenCreatedAt: 1792980597 * 1000,
    }),
  );
  assert.equal(stale.seen[newest.key], "waiting");
  const promoted = reconcileFeaturedSlots(stale, [oldest, middle, newest]);
  assert.deepEqual(labels(promoted), ["Third", "Second"]);
  const rerender = reconcileFeaturedSlots(promoted, [newest, middle, oldest]);
  assert.deepEqual(labels(rerender), ["Third", "Second"]);
  assert.deepEqual(
    placeFeaturedDownloads(
      [newest, middle, oldest],
      rerender.slots.flatMap((pin) => (pin ? [pin.key] : [])),
    ).list.map((g) => g.name),
    ["First"],
  );
});

test("a newly appended file does not make an older repack outrank a newer game", () => {
  const first = game("First", "paused", 100);
  const second = game("Second", "paused", 200);
  const third = game("Third", "paused", 300);
  let state = reconcileFeaturedSlots(emptyFeaturedState(), [first, second, third]);
  assert.deepEqual(labels(state), ["Second", "Third"]);
  first.items.push({
    kind: "direct",
    record: {
      ...first.items[0].record,
      id: "new-bonus-file",
      createdAt: 900,
      updatedAt: 900,
      status: "paused",
    },
  } as (typeof first.items)[number]);
  state = reconcileFeaturedSlots(state, [first, second, third]);
  assert.deepEqual(labels(state), ["Second", "Third"]);
});

test("an already-seen newly created game gets promoted while Downloads remains open", () => {
  const first = game("First", "paused", 100);
  const second = game("Second", "paused", 200);
  const third = game("Third", "paused", 300);
  const base = reconcileFeaturedSlots(emptyFeaturedState(), [first, second]);
  const stale = { ...base, seen: { ...base.seen, [third.key]: "waiting" as const } };
  const result = reconcileFeaturedSlots(stale, [first, second, third]);
  assert.deepEqual(labels(result), ["Third", "Second"]);
});

test("resuming the older third game replaces the oldest slot even during CDN verification", () => {
  const first = game("First", "paused", 100),
    second = game("Second", "paused", 200),
    third = game("Third", "paused", 50);
  let state = reconcileFeaturedSlots(emptyFeaturedState(), [first, second, third]);
  assert.deepEqual(labels(state), ["First", "Second"]);
  state = reconcileFeaturedSlots(state, [first, second, game("Third", "queued", 50)]);
  assert.deepEqual(labels(state), ["Third", "Second"]);
  state = reconcileFeaturedSlots(state, [first, second, game("Third", "checking", 50, 50000)]);
  assert.deepEqual(labels(state), ["Third", "Second"]);
  state = reconcileFeaturedSlots(state, [first, second, game("Third", "downloading", 50, 60000)]);
  assert.deepEqual(labels(state), ["Third", "Second"]);
  state = reconcileFeaturedSlots(state, [first, second, game("Third", "paused", 50, 70000)]);
  assert.deepEqual(labels(state), ["Third", "Second"]);
});

test("saved paused state detects a resume between Games tabs", () => {
  const first = game("First", "paused", 100),
    second = game("Second", "paused", 200),
    third = game("Third", "paused", 50);
  const selected = reconcileFeaturedSlots(emptyFeaturedState(), [first, second, third]);
  const restored = restoreFeaturedSlots(serializeFeaturedSlots(selected));
  assert.equal(restored.seen[third.key], "paused");
  const resumed = reconcileFeaturedSlots(restored, [first, second, game("Third", "checking", 50)]);
  assert.deepEqual(labels(resumed), ["Third", "Second"]);
  assert.deepEqual(
    labels(reconcileFeaturedSlots(resumed, [first, second, game("Third", "checking", 50, 9999)])),
    ["Third", "Second"],
  );
});
