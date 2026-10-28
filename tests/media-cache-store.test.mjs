import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture() {
  const transactions = [];
  const db = {
    close() {},
    transaction() {
      const requests = [];
      const request = () => {
        const value = {};
        requests.push(value);
        return value;
      };
      const tx = {
        objectStore: () => ({
          put: request,
          get: request,
          clear: request,
          delete: request,
          getAll: request,
          index: () => ({ getAllKeys: request }),
        }),
        requests,
        abort() {
          tx.onabort?.();
        },
      };
      transactions.push(tx);
      return tx;
    },
  };
  const indexedDB = {
    open() {
      const request = { result: db };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  const module = { exports: {} };
  const source = ts.transpileModule(
    readFileSync(new URL("../src/lib/media-cache-store.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    indexedDB,
    IDBKeyRange: { upperBound: (value) => ({ upper: value }) },
  });
  return { store: module.exports.mediaCacheStore, transactions };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("request success followed by a transaction abort reports failed persistence", async () => {
  const f = fixture();
  let completed = false;
  const writing = f.store
    .put({
      key: "test",
      value: [1],
      bytes: 3,
      storedAt: 1,
      freshUntil: 2,
      staleUntil: 3,
      accessedAt: 1,
    })
    .then((value) => {
      completed = true;
      return value;
    });
  await tick();
  const tx = f.transactions[0];
  for (const request of tx.requests) request.onsuccess?.();
  await tick();
  assert.equal(completed, false);
  tx.onabort();
  assert.equal(await writing, false);
});

test("writes and clear acknowledge only committed transactions", async () => {
  const f = fixture();
  const clearing = f.store.clear();
  await tick();
  f.transactions[0].oncomplete();
  assert.equal(await clearing, true);
  const writing = f.store.put({ key: "test", value: [1] });
  await tick();
  f.transactions[1].oncomplete();
  assert.equal(await writing, true);
});

test("reads wait for transaction completion and discard aborted results", async () => {
  const f = fixture();
  const reading = f.store.get("test");
  await tick();
  const tx = f.transactions[0];
  tx.requests[0].result = { key: "test", value: [1] };
  tx.requests[0].onsuccess();
  tx.onabort();
  assert.equal(await reading, null);
});

test("expired index keys are removed from both stores", async () => {
  const f = fixture();
  const working = f.store.removeExpired(123);
  await tick();
  const lookup = f.transactions[0];
  lookup.requests[0].result = ["a", "b"];
  lookup.requests[0].onsuccess();
  lookup.oncomplete();
  await tick();
  const remove = f.transactions[1];
  assert.equal(remove.requests.length, 4);
  remove.oncomplete();
  assert.deepEqual(await working, ["a", "b"]);
});
