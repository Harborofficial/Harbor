import assert from "node:assert/strict";
import test from "node:test";
import { setItemWithRecovery, setItemWithRecoveryDetailed } from "../src/lib/storage-recovery.ts";

const REBUILDABLE_MANGA_CACHES = [
  "harbor.manga.catalog.v1",
  "harbor.manga.collections.v1",
  "harbor.manga.mangaupdates.v1",
];

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

test("a normal write is not reported as recovery", () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      length: 0,
      key: () => null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  try {
    assert.deepEqual(setItemWithRecoveryDetailed("harbor.mangafav.v1.reader", "saved"), {
      ok: true,
      quota: false,
      recovered: false,
    });
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("detailed recovery reports the cache eviction that made the favorite write succeed", () => {
  const favKey = "harbor.mangafav.v1.reader";
  const progressKey = "harbor.mangaread.v1.reader";
  const originalFavorites = JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }]);
  const updatedFavorites = JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
  const progress = JSON.stringify([{ id: "a", chapter: 3 }]);
  const cacheKey = "harbor.manga.catalog.v1";
  const seed = new Map([
    [favKey, originalFavorites],
    [progressKey, progress],
    [cacheKey, "x".repeat(500)],
  ]);
  const occupied = [...seed].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
  withQuotaStorage(seed, occupied + 5, () => {
    assert.deepEqual(setItemWithRecoveryDetailed(favKey, updatedFavorites), {
      ok: true,
      quota: false,
      recovered: true,
    });
    assert.equal(localStorage.getItem(favKey), updatedFavorites);
    assert.equal(localStorage.getItem(progressKey), progress);
    assert.equal(localStorage.getItem(cacheKey), null);
  });
});

test("a failed favorite write reports quota and preserves the previous value until retry", () => {
  const favKey = "harbor.mangafav.v1.reader";
  const progressKey = "harbor.mangaread.v1.reader";
  const fillerKey = "harbor.unprunable-fixture";
  const originalFavorites = JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }]);
  const updatedFavorites = JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
  const progress = JSON.stringify([{ id: "a", chapter: 3 }]);
  const seed = new Map([
    [favKey, originalFavorites],
    [progressKey, progress],
    [fillerKey, "x".repeat(500)],
  ]);
  const occupied = [...seed].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
  withQuotaStorage(seed, occupied, () => {
    assert.deepEqual(setItemWithRecoveryDetailed(favKey, updatedFavorites), {
      ok: false,
      quota: true,
      recovered: false,
      errorName: "QuotaExceededError",
    });
    assert.equal(localStorage.getItem(favKey), originalFavorites);
    assert.equal(localStorage.getItem(progressKey), progress);
    localStorage.removeItem(fillerKey);
    assert.equal(setItemWithRecoveryDetailed(favKey, updatedFavorites).ok, true);
    assert.equal(localStorage.getItem(favKey), updatedFavorites);
  });
});

test("a fourth manga favorite can evict each rebuildable manga cache without deleting user data", () => {
  for (const cacheKey of REBUILDABLE_MANGA_CACHES) {
    const favKey = "harbor.mangafav.v1.reader";
    const progressKey = "harbor.mangaread.v1.reader";
    const settingsKey = "harbor.settings";
    const settings = JSON.stringify({ theme: "fixture" });
    const originalFavorites = JSON.stringify([
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
    ]);
    const updatedFavorites = JSON.stringify([
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
      { id: "d", title: "D" },
    ]);
    const progress = JSON.stringify([{ id: "a", chapter: 3, page: 10 }]);
    const cache = "x".repeat(500);
    const seed = new Map([
      [favKey, originalFavorites],
      [progressKey, progress],
      [settingsKey, settings],
      [cacheKey, cache],
    ]);
    const occupied = [...seed].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
    withQuotaStorage(seed, occupied + 5, () => {
      assert.equal(setItemWithRecovery(favKey, updatedFavorites), true, cacheKey);
      assert.equal(localStorage.getItem(favKey), updatedFavorites);
      assert.equal(localStorage.getItem(progressKey), progress, "reading progress must survive");
      assert.equal(localStorage.getItem(settingsKey), settings, "settings must survive");
      assert.equal(localStorage.getItem(cacheKey), null, "only the rebuildable cache is evicted");
    });
  }
});
