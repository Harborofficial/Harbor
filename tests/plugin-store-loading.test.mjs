import assert from "node:assert/strict";
import test from "node:test";
import { createPluginStore } from "../src/lib/manga/plugins/store-factory.ts";

test("plugin store shares concurrent reads and a failed refresh preserves installed plugins", async () => {
  const original = globalThis.indexedDB;
  let reads = 0;
  let pending;
  const db = {
    transaction: () => ({
      objectStore: () => ({
        getAll: () => {
          reads++;
          pending = {};
          return pending;
        },
      }),
    }),
  };
  globalThis.indexedDB = {
    open: () => {
      const request = { result: db };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  };
  try {
    const store = createPluginStore("fixture");
    let notifications = 0;
    store.subscribe(() => notifications++);
    const first = store.loadPlugins();
    assert.equal(store.loadPlugins(), first);
    await Promise.resolve();
    await Promise.resolve();
    pending.result = [{ id: "installed" }];
    pending.onsuccess();
    assert.deepEqual(await first, [{ id: "installed" }]);
    assert.equal(reads, 1);
    assert.equal(notifications, 1);
    globalThis.indexedDB = original;
    // Existing open connection fails before starting the next transaction.
    db.transaction = () => {
      throw new Error("offline");
    };
    assert.deepEqual(await store.loadPlugins(), [{ id: "installed" }]);
    assert.equal(notifications, 1);
  } finally {
    globalThis.indexedDB = original;
  }
});
