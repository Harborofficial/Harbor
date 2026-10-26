import assert from "node:assert/strict";
import test from "node:test";
import { createGameCompletionGate } from "../src/lib/games/game-completion-gate.ts";
import { downloadIdentity } from "../src/lib/games/download-group-identity.ts";
import type { DownloadCompletionRecord } from "../src/lib/games/download-completions.ts";

type RecordValue = DownloadCompletionRecord & { batchId?: string | null };
function record(id: string, status: string, game = "one", kind = "game"): RecordValue {
  return {
    id,
    profile: "alice",
    status,
    name: id,
    updatedAt: 100,
    game: { id: game, name: game, contentKind: kind as "game" },
  };
}
function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("a game with multiple files notifies only after the last file finishes", async () => {
  const files = [record("a", "downloading"), record("b", "queued")];
  const other = [record("t", "downloading", "two")];
  const notices: string[] = [];
  const store = memory();
  const gate = createGameCompletionGate(
    "alice",
    async (kind) => (kind === "http" ? files : other),
    async (_kind, item) => {
      notices.push(item.game!.name);
    },
    store,
  );
  files[0] = { ...files[0], status: "complete" };
  await gate.check("http", files[0]);
  assert.deepEqual(notices, []);
  files[1] = { ...files[1], status: "complete" };
  await gate.check("http", files[1]);
  assert.deepEqual(notices, ["one"]);
  await gate.check("http", files[0]);
  const restored = createGameCompletionGate(
    "alice",
    async (kind) => (kind === "http" ? files : other),
    async () => {
      notices.push("duplicate");
    },
    store,
  );
  await restored.check("http", files[1]);
  assert.deepEqual(notices, ["one"]);
});

test("mixed torrent and direct files share a game completion", async () => {
  const files = [record("a", "complete")],
    torrents = [record("t", "downloading")];
  const notices: string[] = [];
  const gate = createGameCompletionGate(
    "alice",
    async (kind) => (kind === "http" ? files : torrents),
    async (kind) => {
      notices.push(kind);
    },
    memory(),
  );
  await gate.check("http", files[0]);
  assert.deepEqual(notices, []);
  torrents[0] = { ...torrents[0], status: "complete" };
  await gate.check("torrent", torrents[0]);
  assert.deepEqual(notices, ["torrent"]);
});

test("simultaneous last-file completions cannot send duplicate notices", async () => {
  const files = [record("a", "complete"), record("b", "downloading")];
  const notices: string[] = [];
  let release!: () => void;
  let count = 0;
  const list = async (kind: "http" | "torrent") => {
    if (kind === "torrent") return [];
    if (count++ === 0)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return files.map((item) => ({ ...item }));
  };
  const gate = createGameCompletionGate(
    "alice",
    list,
    async () => {
      notices.push("one");
    },
    memory(),
  );
  const a = gate.check("http", files[0]);
  await tick();
  files[1] = { ...files[1], status: "complete" };
  const b = gate.check("http", files[1]);
  release();
  await Promise.all([a, b]);
  assert.deepEqual(notices, ["one"]);
});

test("groups without game metadata fall back to batch IDs and independent files", async () => {
  const files = [
    { ...record("a", "complete"), game: undefined, batchId: "batch" },
    { ...record("b", "queued"), game: undefined, batchId: "batch" },
    { ...record("c", "complete"), game: undefined },
  ];
  const notices: string[] = [];
  const gate = createGameCompletionGate(
    "alice",
    async (kind) => (kind === "http" ? files : []),
    async (_kind, value) => {
      notices.push(value.id);
    },
    memory(),
  );
  await gate.check("http", files[0]);
  assert.deepEqual(notices, []);
  await gate.check("http", files[2]);
  assert.deepEqual(notices, ["c"]);
  files[1] = { ...files[1], status: "complete" };
  await gate.check("http", files[1]);
  assert.deepEqual(notices, ["c", "b"]);
});

test("same game ID in separate profiles or content categories stays separate", () => {
  assert.notEqual(
    downloadIdentity("direct", record("a", "downloading", "one", "game")),
    downloadIdentity("direct", record("a", "downloading", "one", "patch")),
  );
  assert.notEqual(
    downloadIdentity("direct", record("a", "downloading")),
    downloadIdentity("direct", { ...record("a", "downloading"), profile: "bob" }),
  );
});
