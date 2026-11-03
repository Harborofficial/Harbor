import assert from "node:assert/strict";
import test from "node:test";

/**
 * A full localStorage used to brick the boot: every setItem threw, the first unguarded one
 * ran during the initial render, and the tree died before anything cleared the splash.
 * proactiveStorageCleanup() is what has to make the store writable again, so it has to fire
 * on a store that actually rejects writes — not only on one whose prunable half is large.
 */
function installQuotaStorage(seed: Array<[string, string]>) {
  const store = new Map<string, string>();
  const used = () => [...store].reduce((n, [k, v]) => n + k.length + v.length, 0);
  // Seeded right up to the limit, so the store starts out rejecting every write.
  let budget = Number.POSITIVE_INFINITY;
  const stub = {
    getItem: (k: string) => store.get(k) ?? null,
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
    setItem(k: string, v: string) {
      const next =
        used() - (store.get(k)?.length ?? 0) - (store.has(k) ? k.length : 0) + k.length + v.length;
      if (next > budget) throw new DOMException("quota", "QuotaExceededError");
      store.set(k, v);
    },
  };
  for (const [k, v] of seed) store.set(k, v);
  budget = used();
  (globalThis as { localStorage?: unknown }).localStorage = stub;
  return store;
}

const filler = (n: number) => "x".repeat(n);

test("a localStorage that rejects every write is pruned back into a writable state", async () => {
  // Full, but the prunable share stays under PROACTIVE_TOTAL_THRESHOLD, which is exactly the
  // shape that used to slip past the size heuristics and leave the store unwritable.
  const store = installQuotaStorage([
    ["harbor.settings", filler(300_000)],
    ["harbor.installed-addons.p_demo", filler(200_000)],
    ["harbor.mal.hero.v1", filler(200_000)],
    ["harbor.ebook.openlibrary.v2.anonymous.abc", filler(150_000)],
    ["harbor.sports.board.v3:SOCCER@20261031@day", filler(140_000)],
  ]);

  assert.throws(() => localStorage.setItem("harbor.onboarding", "{}"));

  const { proactiveStorageCleanup } = await import("@/lib/storage-recovery");
  proactiveStorageCleanup();

  localStorage.setItem("harbor.onboarding", "{}");
  assert.equal(store.get("harbor.onboarding"), "{}");

  // Derived caches are refetchable; user data is not.
  assert.equal(store.has("harbor.mal.hero.v1"), false);
  assert.equal(store.has("harbor.ebook.openlibrary.v2.anonymous.abc"), false);
  assert.equal(store.has("harbor.sports.board.v3:SOCCER@20261031@day"), false);
  assert.ok(store.has("harbor.settings"));
  assert.ok(store.has("harbor.installed-addons.p_demo"));
});

test("setItemWithRecovery reports failure instead of throwing when nothing is left to prune", async () => {
  installQuotaStorage([["harbor.settings", filler(900)]]);
  const { setItemWithRecovery } = await import("@/lib/storage-recovery");
  assert.equal(setItemWithRecovery("harbor.onboarding", filler(500)), false);
});
