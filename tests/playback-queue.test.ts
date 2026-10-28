import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { Meta } from "../src/lib/cinemeta";

type QueueModule = typeof import("../src/lib/queue");

const source = readFileSync(new URL("../src/lib/queue.ts", import.meta.url), "utf8");

const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

function harness(storage = new Map<string, string>()) {
  const module = { exports: {} };

  const mocks: Record<string, unknown> = {
    react: {},
    "@/lib/storage-recovery": {
      persistCritical: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  };

  new Function("require", "module", "exports", "localStorage", output)(
    (name: string) => {
      assert.ok(name in mocks, `Unexpected dependency: ${name}`);
      return mocks[name];
    },
    module,
    module.exports,
    {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  );

  return {
    queue: module.exports as QueueModule,
    storage,
  };
}

const movie = (id: string): Meta => ({
  id,
  type: "movie",
  name: id,
});

test("queue contents and resume position survive reloading", () => {
  const first = harness();
  const a = movie("tt100");
  const b = movie("tt200");

  first.queue.queueAdd(a);
  first.queue.queueAdd(b);
  first.queue.setQueuePlaying(b);
  first.queue.setQueuePlaying(null);

  const restored = harness(first.storage);

  assert.equal(restored.queue.queueIndexOf(a), 0);
  assert.equal(restored.queue.queueIndexOf(b), 1);
  assert.equal(restored.queue.getQueueStartItem()?.meta.id, a.id);
  assert.equal(restored.queue.getQueueStartItem(true)?.meta.id, b.id);
});

test("removing the resume item selects its surviving successor", () => {
  const { queue } = harness();
  const a = movie("tt100");
  const b = movie("tt200");
  const c = movie("tt300");

  queue.queueAdd(a);
  queue.queueAdd(b);
  queue.queueAdd(c);
  queue.setQueuePlaying(b);

  const current = queue.getQueueStartItem(true);
  assert.ok(current);
  queue.queueRemove(current.id);

  assert.equal(queue.getQueueStartItem(true)?.meta.id, c.id);
  assert.equal(queue.queueIndexOf(b), -1);
});

test("reordering preserves the saved resume item", () => {
  const { queue } = harness();
  const a = movie("tt100");
  const b = movie("tt200");

  queue.queueAdd(a);
  queue.queueAdd(b);
  queue.setQueuePlaying(b);

  const first = queue.getQueueStartItem();
  const second = queue.getQueueStartItem(true);
  assert.ok(first);
  assert.ok(second);

  queue.queueReorder([second.id, first.id]);

  assert.equal(queue.getQueueStartItem()?.meta.id, b.id);
  assert.equal(queue.getQueueStartItem(true)?.id, second.id);
});

test("adding the same episode twice does not duplicate it", () => {
  const { queue } = harness();
  const series: Meta = {
    id: "tt400",
    type: "series",
    name: "Series",
  };
  const episode = { season: 1, episode: 2 };

  queue.queueAdd(series, episode);
  queue.queueAdd(series, episode);

  assert.equal(queue.queueIndexOf(series, episode), 0);
  assert.equal(queue.queueItemAfter(series, episode), null);
});

test("playing an unrelated title preserves the queue resume position", () => {
  const { queue } = harness();
  const a = movie("tt100");
  const b = movie("tt200");

  queue.queueAdd(a);
  queue.queueAdd(b);
  queue.setQueuePlaying(b);
  queue.setQueuePlaying(movie("tt999"));
  queue.setQueuePlaying(null);

  assert.equal(queue.getQueueStartItem(true)?.meta.id, b.id);
});

test("clearing the queue also clears its saved resume position", () => {
  const { queue, storage } = harness();
  const a = movie("tt100");

  queue.queueAdd(a);
  queue.setQueuePlaying(a);
  queue.queueClear();

  const restored = harness(storage);

  assert.equal(restored.queue.getQueueStartItem(), null);
  assert.equal(restored.queue.getQueueStartItem(true), null);

  restored.queue.queueAdd(movie("tt200"));
  assert.equal(restored.queue.getQueueStartItem(true)?.meta.id, "tt200");
});
