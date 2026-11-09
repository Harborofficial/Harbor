import assert from "node:assert/strict";
import test from "node:test";
import {
  loadReaderBackground,
  readerBackgroundAuthorityKey,
  removeReaderBackground,
  saveReaderBackground,
} from "../src/components/reader-background/reader-background-store.ts";
import { READER_BACKGROUND_KEY } from "../src/components/reader-background/reader-background-storage.ts";

const rows = new Map<string, string>();
let fail: "put" | "delete" | null = null;

const db = {
  objectStoreNames: { contains: (name: string) => name === "backgrounds" },
  createObjectStore: () => {},
  transaction(_name: string, _mode: string) {
    const tx: Record<string, unknown> = { error: null };
    const complete = () => queueMicrotask(() => (tx.oncomplete as (() => void) | null)?.());
    const abort = () =>
      queueMicrotask(() => {
        (tx.onerror as (() => void) | null)?.();
        (tx.onabort as (() => void) | null)?.();
      });
    tx.objectStore = () => ({
      get(key: string) {
        const request: Record<string, unknown> = { result: undefined };
        queueMicrotask(() => {
          request.result = rows.get(key);
          (request.onsuccess as (() => void) | null)?.();
        });
        return request;
      },
      put(value: string, key: string) {
        if (fail === "put") abort();
        else {
          rows.set(key, value);
          complete();
        }
        return {};
      },
      delete(key: string) {
        if (fail === "delete") abort();
        else {
          rows.delete(key);
          complete();
        }
        return {};
      },
    });
    return tx;
  },
};

(globalThis as { indexedDB?: unknown }).indexedDB = {
  open() {
    const request: Record<string, unknown> = { result: db };
    queueMicrotask(() => {
      (request.onupgradeneeded as (() => void) | null)?.();
      (request.onsuccess as (() => void) | null)?.();
    });
    return request;
  },
};

const local = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => local.get(key) ?? null,
  setItem: (key: string, value: string) => void local.set(key, String(value)),
  removeItem: (key: string) => void local.delete(key),
  key: (index: number) => [...local.keys()][index] ?? null,
  get length() {
    return local.size;
  },
};

function reset() {
  rows.clear();
  local.clear();
  fail = null;
}

test("a failed IndexedDB replacement keeps the newer localStorage copy", async () => {
  reset();
  rows.set(READER_BACKGROUND_KEY, "data:image/old");
  fail = "put";

  await saveReaderBackground(READER_BACKGROUND_KEY, "data:image/new");
  assert.equal(local.get(READER_BACKGROUND_KEY), "data:image/new");
  assert.equal(local.get(readerBackgroundAuthorityKey(READER_BACKGROUND_KEY)), "local");
  assert.equal(await loadReaderBackground(READER_BACKGROUND_KEY), "data:image/new");
  assert.equal(rows.get(READER_BACKGROUND_KEY), "data:image/old");
});

test("reopening migrates the newer fallback back to IndexedDB", async () => {
  reset();
  rows.set(READER_BACKGROUND_KEY, "data:image/old");
  fail = "put";
  await saveReaderBackground(READER_BACKGROUND_KEY, "data:image/new");

  fail = null;
  assert.equal(await loadReaderBackground(READER_BACKGROUND_KEY), "data:image/new");
  assert.equal(rows.get(READER_BACKGROUND_KEY), "data:image/new");
  assert.equal(local.get(READER_BACKGROUND_KEY), undefined);
  assert.equal(local.get(readerBackgroundAuthorityKey(READER_BACKGROUND_KEY)), undefined);
});

test("a later IndexedDB save clears the fallback only after it succeeds", async () => {
  reset();
  rows.set(READER_BACKGROUND_KEY, "data:image/old");
  local.set(READER_BACKGROUND_KEY, "data:image/old-local");
  local.set(readerBackgroundAuthorityKey(READER_BACKGROUND_KEY), "local");

  await saveReaderBackground(READER_BACKGROUND_KEY, "data:image/new");
  assert.equal(rows.get(READER_BACKGROUND_KEY), "data:image/new");
  assert.equal(local.get(READER_BACKGROUND_KEY), undefined);
  assert.equal(local.get(readerBackgroundAuthorityKey(READER_BACKGROUND_KEY)), undefined);
});

test("a failed reset cannot resurrect the older image", async () => {
  reset();
  rows.set(READER_BACKGROUND_KEY, "data:image/old");
  local.set(READER_BACKGROUND_KEY, "data:image/old-local");
  fail = "delete";

  await assert.rejects(removeReaderBackground(READER_BACKGROUND_KEY));
  assert.equal(local.get(readerBackgroundAuthorityKey(READER_BACKGROUND_KEY)), "deleted");
  assert.equal(await loadReaderBackground(READER_BACKGROUND_KEY), null);
  assert.equal(rows.get(READER_BACKGROUND_KEY), "data:image/old");

  fail = null;
  assert.equal(await loadReaderBackground(READER_BACKGROUND_KEY), null);
  assert.equal(rows.get(READER_BACKGROUND_KEY), undefined);
  assert.equal(local.get(readerBackgroundAuthorityKey(READER_BACKGROUND_KEY)), undefined);
});

test("a successful reset removes both copies", async () => {
  reset();
  rows.set(READER_BACKGROUND_KEY, "data:image/old");
  local.set(READER_BACKGROUND_KEY, "data:image/old-local");

  await removeReaderBackground(READER_BACKGROUND_KEY);
  assert.equal(rows.get(READER_BACKGROUND_KEY), undefined);
  assert.equal(local.get(READER_BACKGROUND_KEY), undefined);
  assert.equal(local.get(readerBackgroundAuthorityKey(READER_BACKGROUND_KEY)), undefined);
});

test("a localStorage-only save migrates when IndexedDB becomes available", async () => {
  reset();
  const indexed = (globalThis as { indexedDB?: unknown }).indexedDB;
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
  try {
    await saveReaderBackground(READER_BACKGROUND_KEY, "data:image/local-only");
  } finally {
    (globalThis as { indexedDB?: unknown }).indexedDB = indexed;
  }
  assert.equal(local.get(READER_BACKGROUND_KEY), "data:image/local-only");
  assert.equal(local.get(readerBackgroundAuthorityKey(READER_BACKGROUND_KEY)), "local");

  assert.equal(await loadReaderBackground(READER_BACKGROUND_KEY), "data:image/local-only");
  assert.equal(rows.get(READER_BACKGROUND_KEY), "data:image/local-only");
  assert.equal(local.get(READER_BACKGROUND_KEY), undefined);
  assert.equal(local.get(readerBackgroundAuthorityKey(READER_BACKGROUND_KEY)), undefined);
});
