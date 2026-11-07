import assert from "node:assert/strict";
import test from "node:test";
import {
  bundleDownloads,
  groupArtworkItem,
  groupDownloadAction,
  groupVerification,
  groupStatusKey,
  groupSectionStatusKey,
} from "../src/lib/games/download-game-groups.ts";
import type { GameTransfer } from "../src/lib/games/transfers.ts";
import type { GameTorrent } from "../src/lib/games/torrents.ts";
import type { DownloadItem } from "../src/lib/games/download-presentation.ts";

function item(id: string, options: Partial<GameTransfer> = {}): DownloadItem {
  return {
    kind: "direct",
    record: {
      id,
      profile: "owner",
      name: id,
      url: "https://example.test/file",
      destination: "C:\\\\Games\\\\" + id,
      status: "downloading",
      received: 100,
      total: 1000,
      expectedBytes: 1000,
      expectedSha256: null,
      sha256: null,
      validator: null,
      createdAt: 1,
      updatedAt: 1,
      error: null,
      bytesPerSecond: 20,
      ...options,
    } as GameTransfer,
  };
}

test("files for a known game share one identity and weighted progress", () => {
  const groups = bundleDownloads([
    item("setup.exe", { game: { id: "game-1", name: "Example Game" }, received: 100, total: 1000 }),
    item("part2.bin", { game: { id: "game-1", name: "Example Game" }, received: 500, total: 9000 }),
    item("other.bin", { game: { id: "game-2", name: "Another Game" }, received: 20, total: 100 }),
  ]);
  assert.equal(groups.length, 2);
  const game = groups.find((value) => value.name === "Example Game")!;
  assert.equal(game.items.length, 2);
  assert.equal(game.received, 600);
  assert.equal(game.total, 10000);
  assert.equal(game.rate, 40);
});

test("unidentified downloads only group by explicit batch ID", () => {
  const groups = bundleDownloads([
    item("a", { batchId: "same" }),
    item("b", { batchId: "same" }),
    item("c"),
    item("d"),
  ]);
  assert.deepEqual(groups.map((value) => value.items.length).sort(), [1, 1, 2]);
});

test("profiles, content kinds and unrelated game IDs never merge", () => {
  const groups = bundleDownloads([
    item("a", { game: { id: "one", name: "Game" } }),
    item("b", { game: { id: "one", name: "Game", contentKind: "patch" } }),
    item("c", { game: { id: "one", name: "Game" }, profile: "another" }),
  ]);
  assert.equal(groups.length, 3);
});

test("completed files contribute their full size and incomplete unknown totals stay unknown", () => {
  const group = bundleDownloads(
    [
      item("a", { status: "complete", received: 900, total: 900 }),
      item("b", { status: "downloading", received: 10, total: null, expectedBytes: null }),
    ].map((value) => ({
      ...value,
      record: { ...value.record, game: { id: "one", name: "Game" } },
    })),
  )[0];
  assert.equal(group.state, "active");
  assert.equal(group.total, null);
  assert.equal(group.completed, 1);
});

test("group action pauses only active and queued files, keeping completed and already paused files intact", () => {
  const group = bundleDownloads([
    item("downloading", { status: "downloading", game: { id: "group", name: "Game" } }),
    item("queued", { status: "queued", game: { id: "group", name: "Game" } }),
    item("paused", { status: "paused", game: { id: "group", name: "Game" } }),
    item("done", { status: "complete", game: { id: "group", name: "Game" } }),
  ])[0];
  const command = groupDownloadAction(group);
  assert.equal(command?.action, "pause");
  assert.deepEqual(
    command?.items.map((item) => item.record.id),
    ["downloading", "queued"],
  );
});

test("group action resumes paused and failed items but never completed or canceled", () => {
  const group = bundleDownloads([
    item("paused", { status: "paused", game: { id: "group", name: "Game" } }),
    item("failed", { status: "failed", game: { id: "group", name: "Game" } }),
    item("done", { status: "complete", game: { id: "group", name: "Game" } }),
    item("canceled", { status: "canceled", game: { id: "group", name: "Game" } }),
  ])[0];
  const command = groupDownloadAction(group);
  assert.equal(command?.action, "resume");
  assert.deepEqual(
    command?.items.map((item) => item.record.id),
    ["paused", "failed"],
  );
});

test("completed and canceled groups have no pause/resume action", () => {
  const group = bundleDownloads([
    item("done", { status: "complete", game: { id: "group", name: "Game" } }),
    item("canceled", { status: "canceled", game: { id: "group", name: "Game" } }),
  ])[0];
  assert.equal(groupDownloadAction(group), null);
});

test("mixed torrent and direct downloads can be paused from one group", () => {
  const direct = item("direct", { status: "downloading", game: { id: "group", name: "Game" } });
  const torrent: DownloadItem = {
    kind: "torrent",
    record: {
      id: "torrent",
      profile: "owner",
      name: "Example",
      status: "checking",
      createdAt: 1,
      updatedAt: 2,
      game: { id: "group", name: "Game" },
      received: 20,
      totalBytes: 1000,
      bytesPerSecond: 0,
    } as GameTorrent,
  };
  const group = bundleDownloads([direct, torrent]);
  assert.equal(group.length, 1);
  assert.equal(groupDownloadAction(group[0])?.items.length, 2);
});

test("featured banners use artwork from any file in a game group", () => {
  const group = bundleDownloads([
    item("setup.exe", { game: { id: "game-1", name: "Example" } }),
    item("data.bin", {
      game: {
        id: "game-1",
        name: "Example",
        artwork: "https://cdn.example.test/hero.jpg",
        logo: "https://cdn.example.test/logo.png",
      },
    }),
  ])[0];
  assert.equal(groupArtworkItem(group).record.id, "data.bin");
  assert.equal(groupArtworkItem(group).record.game?.artwork, "https://cdn.example.test/hero.jpg");
});

test("featured banner selection falls back to first file when artwork is absent", () => {
  const group = bundleDownloads([
    item("setup.exe", { game: { id: "game-1", name: "Example" } }),
    item("data.bin", { game: { id: "game-1", name: "Example" } }),
  ])[0];
  assert.equal(groupArtworkItem(group).record.id, "setup.exe");
});

test("relinked direct download retains saved progress during prefix verification and counts checking bandwidth", () => {
  const source = { id: "test", name: "Test", contentKind: "game" as const };
  const groups = bundleDownloads([
    item("fg-01.bin", {
      game: source,
      status: "checking",
      checkingPartial: 0,
      received: 2000,
      total: 4000,
      bytesPerSecond: 512,
    }),
    item("fg-02.bin", {
      game: source,
      status: "paused",
      received: 1500,
      total: 6000,
      bytesPerSecond: 0,
    }),
    item("fg-03.bin", {
      game: source,
      status: "complete",
      received: 1000,
      total: 1000,
      bytesPerSecond: 0,
    }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].state, "active");
  assert.equal(groups[0].received, 4500);
  assert.equal(groups[0].total, 11000);
  assert.equal(groups[0].rate, 512);
  const verificationStep = bundleDownloads([
    item("fg-01.bin", {
      game: source,
      status: "checking",
      checkingPartial: 1600,
      received: 2000,
      total: 4000,
      bytesPerSecond: 3072,
    }),
    item("fg-02.bin", {
      game: source,
      status: "paused",
      received: 1500,
      total: 6000,
      bytesPerSecond: 0,
    }),
    item("fg-03.bin", {
      game: source,
      status: "complete",
      received: 1000,
      total: 1000,
      bytesPerSecond: 0,
    }),
  ])[0];
  assert.equal(
    verificationStep.received,
    4500,
    "verification does not reduce or inflate downloaded bytes",
  );
  assert.equal(verificationStep.rate, 3072, "verification traffic has nonzero download speed");
  const paused = bundleDownloads([
    item("fg-01.bin", {
      game: source,
      status: "paused",
      checkingPartial: 1600,
      received: 2000,
      total: 4000,
      bytesPerSecond: 0,
    }),
    item("fg-02.bin", {
      game: source,
      status: "paused",
      received: 1500,
      total: 6000,
      bytesPerSecond: 0,
    }),
    item("fg-03.bin", {
      game: source,
      status: "complete",
      received: 1000,
      total: 1000,
      bytesPerSecond: 0,
    }),
  ])[0];
  assert.equal(paused.received, 4500, "pausing has no apparent progress jump");
  assert.equal(paused.rate, 0);
});

test("featured game uses verifying status and percentage without touching downloaded bytes", () => {
  const source = { id: "cdntest", name: "Example" };
  const game = bundleDownloads([
    item("part1", {
      game: source,
      status: "checking",
      checkingPartial: 250,
      received: 1000,
      total: 5000,
      bytesPerSecond: 800,
    }),
    item("part2", { game: source, status: "paused", received: 300, total: 2000 }),
  ])[0];
  assert.equal(groupStatusKey(game), "games.download.relink.checking");
  assert.deepEqual(groupVerification(game), { count: 1, total: 1000, received: 250, speed: 800 });
  assert.equal(game.received, 1300);
  assert.equal(game.total, 7000);
  const mixed = bundleDownloads([
    item("part1", {
      game: source,
      status: "checking",
      checkingPartial: 250,
      received: 1000,
      total: 5000,
      bytesPerSecond: 800,
    }),
    item("part2", { game: source, status: "downloading", received: 300, total: 2000 }),
  ])[0];
  assert.equal(groupStatusKey(mixed), "games.download.relink.downloadingAndVerifying");
  assert.equal(
    groupStatusKey(
      bundleDownloads([
        item("part1", { game: source, status: "downloading", received: 1000, total: 5000 }),
      ])[0],
    ),
    "games.download.center.active",
  );
});

test("active Downloads section says verifying when a refreshed link is checked", () => {
  const source = { id: "x", name: "Game" };
  const checks = bundleDownloads([
    item("piece", {
      game: source,
      status: "checking",
      checkingPartial: 500,
      received: 1000,
      total: 2000,
    }),
  ]);
  assert.equal(groupSectionStatusKey("active", checks), "games.download.relink.checking");
  const final = bundleDownloads([
    item("piece", {
      game: source,
      status: "checking",
      checkingPartial: null,
      received: 1000,
      total: 2000,
    }),
  ]);
  assert.equal(groupStatusKey(final[0]), "games.download.relink.finalVerification");
  const downloading = bundleDownloads([item("piece", { game: source, status: "downloading" })]);
  assert.equal(groupSectionStatusKey("active", downloading), "games.download.center.active");
  assert.equal(groupSectionStatusKey("queue", checks), "games.download.center.queue");
});
