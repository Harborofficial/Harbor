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
  let profile = "primary";
  let nuvio = false;
  let account = "account-a";
  let slot = 1;
  const events = new EventTarget();
  let notifications = 0;
  let failMigrationCopy = false;

  const mocks: Record<string, unknown> = {
    react: {
      useSyncExternalStore: (
        subscribe: (fn: () => void) => () => void,
        snapshot: () => unknown,
      ) => {
        subscribe(() => notifications++);
        return snapshot();
      },
    },
    "@/lib/active-profile-id": {
      activeProfileId: () => profile,
      primaryProfileId: () => "primary",
      isNuvioProviderActive: () => nuvio,
      nuvioWatchedScope: (index = slot) =>
        account ? `nuvio.v2.${account}.slot.${index}` : "nuvio.v2.unowned",
    },
    "@/lib/storage-recovery": {
      persistCritical: (key: string, value: string) => {
        storage.set(key, value);
        return true;
      },
      setItemWithRecovery: (key: string, value: string) => {
        if (failMigrationCopy && key.startsWith("harbor.queue.v2.")) return false;
        storage.set(key, value);
        return true;
      },
    },
  };

  new Function("require", "module", "exports", "localStorage", "window", output)(
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
    events,
  );

  return {
    queue: module.exports as QueueModule,
    storage,
    switchProfile: (id: string, notify = true) => {
      profile = id;
      if (notify) events.dispatchEvent(new Event("harbor:active-profile-changed"));
    },
    switchNuvio: (owner: string, index: number) => {
      nuvio = true;
      account = owner;
      slot = index;
      events.dispatchEvent(new Event("harbor:nuvio-state-changed"));
    },
    notifications: () => notifications,
    storageChanged: (key: string) => {
      const event = new Event("storage");
      Object.defineProperty(event, "key", { value: key });
      events.dispatchEvent(event);
    },
    failMigrationCopy: (fail: boolean) => {
      failMigrationCopy = fail;
    },
  };
}

const movie = (id: string): Meta => ({
  id,
  type: "movie",
  name: id,
});

test("profile switching isolates contents, resume position and sleep-at-end", () => {
  const h = harness();
  h.queue.queueAdd(movie("a"));
  h.queue.queueAdd(movie("b"));
  h.queue.setQueuePlaying(movie("b"));
  h.queue.setSleepAtEnd(true);
  h.queue.useQueue();
  const before = h.notifications();
  h.switchProfile("child");
  assert.ok(h.notifications() > before);
  assert.equal(h.queue.getQueueStartItem(true), null);
  assert.equal(h.queue.useQueueResumeItem(), null);
  assert.equal(h.queue.getSleepAtEnd(), false);
  h.queue.queueAdd(movie("child-only"));
  h.switchProfile("primary");
  assert.equal(h.queue.getQueueStartItem(true)?.meta.id, "b");
  assert.equal(h.queue.queueIndexOf(movie("child-only")), -1);
  assert.equal(h.queue.getSleepAtEnd(), true);
  h.switchProfile("child");
  h.queue.queueClear();
  h.switchProfile("primary");
  assert.equal(h.queue.getQueueStartItem(true)?.meta.id, "b");
});

test("mutations resolve the current profile even before its change event", () => {
  const h = harness();
  h.queue.queueAdd(movie("primary-only"));
  h.switchProfile("child", false);
  h.queue.queueAdd(movie("child-only"));
  assert.equal(h.queue.queueIndexOf(movie("primary-only")), -1);
  h.switchProfile("primary");
  assert.equal(h.queue.queueIndexOf(movie("child-only")), -1);
});

test("legacy queue migrates once to the primary profile with its resume pointer", () => {
  const legacy = JSON.stringify([{ id: "legacy", meta: movie("old"), addedAt: 1 }]);
  const storage = new Map([
    ["harbor.queue.v1", legacy],
    ["harbor.queue.resumeItem.v1", "legacy"],
    ["harbor.queue.sleepAtEnd.v1", "1"],
  ]);
  const h = harness(storage);
  h.switchProfile("child");
  assert.equal(h.queue.getQueueStartItem(true), null);
  h.switchProfile("primary");
  assert.equal(h.queue.useQueueResumeItem()?.id, "legacy");
  assert.equal(h.queue.getSleepAtEnd(), true);
  assert.equal(storage.get("harbor.queue.v1"), legacy);
  h.queue.queueClear();
  assert.equal(harness(storage).queue.getQueueStartItem(true), null);
});

test("Nuvio accounts and slots have separate queues and signed-out storage is not shared", () => {
  const h = harness();
  h.queue.queueAdd(movie("local"));
  h.switchNuvio("account-a", 1);
  assert.equal(h.queue.getQueueStartItem(), null);
  h.queue.queueAdd(movie("a1"));
  h.switchNuvio("account-a", 2);
  assert.equal(h.queue.getQueueStartItem(), null);
  h.queue.queueAdd(movie("a2"));
  h.switchNuvio("account-b", 1);
  assert.equal(h.queue.getQueueStartItem(), null);
  h.queue.queueAdd(movie("b1"));
  h.switchNuvio("", 1);
  h.queue.queueAdd(movie("unowned"));
  assert.equal(h.queue.getQueueStartItem(), null);
  h.switchNuvio("account-a", 1);
  assert.equal(h.queue.getQueueStartItem()?.meta.id, "a1");
  h.switchNuvio("account-a", 2);
  assert.equal(h.queue.getQueueStartItem()?.meta.id, "a2");
});

test("migration failure retains the original data and retries only for its claimed owner", () => {
  const legacy = JSON.stringify([{ id: "old", meta: movie("old"), addedAt: 1 }]);
  const h = harness(new Map([["harbor.queue.v1", legacy]]));
  h.failMigrationCopy(true);
  assert.equal(h.queue.getQueueStartItem(), null);
  assert.equal(h.storage.get("harbor.queue.v1"), legacy);
  h.failMigrationCopy(false);
  h.switchNuvio("account-a", 1);
  assert.equal(h.queue.getQueueStartItem(), null);
  assert.equal(JSON.parse(h.storage.get("harbor.queue.v2.profile.primary")!).items[0].id, "old");
});

test("migration never overwrites an existing scoped queue", () => {
  const storage = new Map([
    ["harbor.queue.v1", JSON.stringify([{ id: "old", meta: movie("old"), addedAt: 1 }])],
    [
      "harbor.queue.v2.profile.primary",
      JSON.stringify({
        items: [{ id: "new", meta: movie("new"), addedAt: 2 }],
        resumeItemId: "new",
        sleepAtEnd: false,
      }),
    ],
  ]);
  const h = harness(storage);
  assert.equal(h.queue.getQueueStartItem(true)?.id, "new");
  h.switchProfile("child");
  assert.equal(h.queue.getQueueStartItem(), null);
  assert.ok(storage.has("harbor.queue.v1"));
});

test("storage events refresh only the affected profile data", () => {
  const h = harness();
  h.queue.queueAdd(movie("primary-only"));
  h.switchProfile("child");
  h.queue.queueAdd(movie("child-old"));
  h.switchProfile("primary");
  const key = "harbor.queue.v2.profile.child";
  h.storage.set(
    key,
    JSON.stringify({
      items: [{ id: "child-new", meta: movie("child-new"), addedAt: 2 }],
      resumeItemId: "child-new",
      sleepAtEnd: false,
    }),
  );
  h.storageChanged(key);
  assert.equal(h.queue.getQueueStartItem()?.meta.id, "primary-only");
  h.switchProfile("child");
  assert.equal(h.queue.getQueueStartItem(true)?.meta.id, "child-new");
});

test("Nuvio legacy migration targets slot one of a known account, not the first viewed slot", () => {
  const storage = new Map([
    ["harbor.queue.v1", JSON.stringify([{ id: "old", meta: movie("old"), addedAt: 1 }])],
  ]);
  const h = harness(storage);
  h.switchNuvio("", 2);
  assert.equal(storage.has("harbor.queue.migration.v2"), false);
  h.switchNuvio("account-a", 2);
  assert.equal(h.queue.getQueueStartItem(), null);
  h.switchNuvio("account-a", 1);
  assert.equal(h.queue.getQueueStartItem()?.id, "old");
  h.switchNuvio("account-b", 1);
  assert.equal(h.queue.getQueueStartItem(), null);
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
