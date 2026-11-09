// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  READER_BACKGROUND_KEY,
  writeReaderBackground,
} from "../src/components/reader-background/reader-background-storage.ts";

class ReplacingStorage {
  data = new Map<string, string>([[READER_BACKGROUND_KEY, "old"]]);

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.data.has(key)) throw new Error("quota");
    this.data.set(key, value);
  }

  removeItem(key: string) {
    this.data.delete(key);
  }
}

class FailingNewStorage extends ReplacingStorage {
  setItem(key: string, value: string) {
    if (value === "new") throw new Error("quota");
    this.data.set(key, value);
  }
}

test("replacing a reader background frees the old value first", () => {
  const storage = new ReplacingStorage();
  writeReaderBackground(storage, "new");
  assert.equal(storage.getItem(READER_BACKGROUND_KEY), "new");
});

test("a failed replacement restores the previous background", () => {
  const storage = new FailingNewStorage();
  assert.throws(() => writeReaderBackground(storage, "new"), /quota/);
  assert.equal(storage.getItem(READER_BACKGROUND_KEY), "old");
});

test("resetting removes the stored background", () => {
  const storage = new ReplacingStorage();
  writeReaderBackground(storage, null);
  assert.equal(storage.getItem(READER_BACKGROUND_KEY), null);
});

test("keeps ebook and manga backgrounds under separate keys", () => {
  const storage = new ReplacingStorage();
  writeReaderBackground(storage, "manga", "harbor.manga.reader.background.v1");
  assert.equal(storage.getItem("harbor.manga.reader.background.v1"), "manga");
  assert.equal(storage.getItem(READER_BACKGROUND_KEY), "old");
});
