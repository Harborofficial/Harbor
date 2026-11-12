import assert from "node:assert/strict";
import test from "node:test";
import {
  PdfDocumentCache,
  type PdfDocumentSource,
  type PdfLoadTask,
} from "../src/lib/ebook/pdf-cache.ts";

type Doc = { id: string; destroyed: boolean };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeSource implements PdfDocumentSource<Doc> {
  readonly keys = new Map<string, string>();
  readonly destroyed: string[] = [];
  readonly cancelled: string[] = [];
  activeLoads = 0;
  maxActiveLoads = 0;
  private next = 0;

  stat(path: string): Promise<string> {
    return Promise.resolve(this.keys.get(path) ?? "1");
  }

  load(path: string, signal: AbortSignal): PdfLoadTask<Doc> {
    const id = `${path}:${++this.next}`;
    const doc = { id, destroyed: false };
    this.activeLoads += 1;
    this.maxActiveLoads = Math.max(this.maxActiveLoads, this.activeLoads);
    let settled = false;
    let reject!: (error: unknown) => void;
    const cancelled = new Promise<never>((_, rejectPending) => {
      reject = rejectPending;
    });
    const onAbort = () => {
      if (settled) return;
      settled = true;
      this.activeLoads -= 1;
      this.cancelled.push(id);
      reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const loaded = Promise.resolve().then(() => {
      if (settled) return cancelled;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      this.activeLoads -= 1;
      return doc;
    });
    return {
      promise: loaded,
      cancel: onAbort,
    };
  }

  destroy(document: Doc): void {
    document.destroyed = true;
    this.destroyed.push(document.id);
  }
}

test("five concurrent documents never exceed the loading limit", async () => {
  const source = new FakeSource();
  const cache = new PdfDocumentCache(source, { maxDocuments: 5, maxLoading: 2 });
  const leases = await Promise.all(["a", "b", "c", "d", "e"].map((path) => cache.acquire(path)));
  assert.equal(leases.length, 5);
  assert.ok(source.maxActiveLoads <= 2);
  for (const lease of leases) lease.release();
  await cache.trim();
  await cache.disposeAll();
});

test("eviction never removes a document while a lease is active", async () => {
  const source = new FakeSource();
  const cache = new PdfDocumentCache(source, { maxDocuments: 2, maxLoading: 3 });
  const a = await cache.acquire("a");
  const b = await cache.acquire("b");
  const c = await cache.acquire("c");
  await cache.trim();
  assert.equal(a.document.destroyed, false);
  assert.equal(source.destroyed.includes(a.document.id), false);
  a.release();
  await cache.trim();
  assert.equal(source.destroyed.includes(a.document.id), true);
  b.release();
  c.release();
  await cache.trim();
});

test("a failed load is removed and can be retried", async () => {
  const source = new FakeSource();
  let attempts = 0;
  source.load = (path) => {
    attempts += 1;
    const pending = deferred<Doc>();
    if (attempts === 1) pending.reject(new Error("invalid pdf"));
    else pending.resolve({ id: path, destroyed: false });
    return { promise: pending.promise };
  };
  const cache = new PdfDocumentCache(source, { maxDocuments: 2, maxLoading: 1 });
  await assert.rejects(cache.acquire("x"));
  const lease = await cache.acquire("x");
  assert.equal(lease.document.id, "x");
  lease.release();
  await cache.trim();
});

test("aborting an acquire cancels the pending load", async () => {
  const source = new FakeSource();
  source.load = (path) => {
    const pending = deferred<Doc>();
    return {
      promise: pending.promise,
      cancel: () => {
        source.cancelled.push(path);
        pending.reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
      },
    };
  };
  const cache = new PdfDocumentCache(source, { maxDocuments: 2, maxLoading: 1 });
  const controller = new AbortController();
  const pending = cache.acquire("x", controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(pending, (error: Error) => error.name === "AbortError");
  assert.equal(source.cancelled.length, 1);
  await cache.disposeAll();
});

test("a changed file invalidates idle and active documents safely", async () => {
  const source = new FakeSource();
  const cache = new PdfDocumentCache(source, { maxDocuments: 2, maxLoading: 2 });
  source.keys.set("x", "old");
  const old = await cache.acquire("x");
  old.release();
  source.keys.set("x", "new");
  const next = await cache.acquire("x");
  assert.notEqual(next.document.id, old.document.id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(source.destroyed.includes(old.document.id), true);
  next.release();
  await cache.trim();
  await cache.disposeAll();

  source.keys.set("y", "old");
  const held = await cache.acquire("y");
  source.keys.set("y", "new");
  const replacement = await cache.acquire("y");
  assert.notEqual(held.document.id, replacement.document.id);
  assert.equal(held.document.destroyed, false);
  held.release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(held.document.destroyed, true);
  replacement.release();
  await cache.trim();
});

test("loading is bounded even when every acquire is immediate", async () => {
  const source = new FakeSource();
  source.load = (path) => {
    const doc = { id: path, destroyed: false };
    source.activeLoads += 1;
    source.maxActiveLoads = Math.max(source.maxActiveLoads, source.activeLoads);
    return {
      promise: Promise.resolve().then(() => {
        source.activeLoads -= 1;
        return doc;
      }),
    };
  };
  const cache = new PdfDocumentCache(source, { maxDocuments: 5, maxLoading: 2 });
  const leases = await Promise.all(["a", "b", "c", "d", "e"].map((path) => cache.acquire(path)));
  assert.ok(source.maxActiveLoads <= 2);
  for (const lease of leases) lease.release();
  await cache.trim();
  await cache.disposeAll();
});
