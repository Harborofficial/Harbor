import assert from "node:assert/strict";
import test from "node:test";
import { recordMangaChapterRead, removeMangaChapterRead } from "../src/lib/manga-progress.ts";

const READ_KEY = "harbor.mangaread.chapters.v1.reader";
const CACHE_KEY = "harbor.manga.cache.v2.detail";

function withQuotaStorage(seed: Map<string, string>, limit: number, run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map(seed);
  const storage = {
    get length() {
      return values.size;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      const nextSize = [...values].reduce(
        (total, [existingKey, existingValue]) =>
          total + existingKey.length + (existingKey === key ? value.length : existingValue.length),
        values.has(key) ? 0 : key.length + value.length,
      );
      if (nextSize > limit) throw new DOMException("Quota exceeded", "QuotaExceededError");
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  try {
    run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

function occupied(seed: Map<string, string>): number {
  return [...seed].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
}

test("marking a chapter read evicts a rebuildable cache instead of failing", () => {
  const seed = new Map([
    [READ_KEY, JSON.stringify({ other: ["chapter-0"] })],
    [CACHE_KEY, "x".repeat(400)],
  ]);
  withQuotaStorage(seed, occupied(seed) + 5, () => {
    recordMangaChapterRead("reader", "manga", "chapter-1");
    assert.deepEqual(JSON.parse(localStorage.getItem(READ_KEY)!), {
      other: ["chapter-0"],
      manga: ["chapter-1"],
    });
    assert.equal(localStorage.getItem(CACHE_KEY), null);
  });
});

test("marking a chapter unread still writes through the recovered store", () => {
  const seed = new Map([
    [READ_KEY, JSON.stringify({ manga: ["chapter-1", "chapter-2"] })],
    [CACHE_KEY, "x".repeat(400)],
  ]);
  withQuotaStorage(seed, occupied(seed) + 5, () => {
    removeMangaChapterRead("reader", "manga", "chapter-1");
    assert.deepEqual(JSON.parse(localStorage.getItem(READ_KEY)!), { manga: ["chapter-2"] });
  });
});
