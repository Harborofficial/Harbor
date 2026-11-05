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
  // The user's own records are deliberately the biggest things in here: if any of them were
  // ever treated as a disposable cache, they would be the first to go.
  const store = installQuotaStorage([
    ["harbor.playback-history.v1.p_demo", filler(400_000)],
    ["harbor.iptv.stats.v1", filler(300_000)],
    ["harbor.settings", filler(200_000)],
    ["harbor.lastseason.v1", filler(10_000)],
    ["harbor.parental", filler(400)],
    ["harbor.mal.hero.v1", filler(100_000)],
  ]);

  assert.throws(() => localStorage.setItem("harbor.onboarding", "{}"));

  const { proactiveStorageCleanup } = await import("@/lib/storage-recovery");
  proactiveStorageCleanup();

  localStorage.setItem("harbor.onboarding", "{}");
  assert.equal(store.get("harbor.onboarding"), "{}");

  // Derived caches are refetchable, so the largest goes first.
  assert.equal(store.has("harbor.mal.hero.v1"), false);

  // Nothing the user did is evictable, however big it is or however full the store gets:
  // continue watching, the last season picked, live-TV watch counts, the legacy parental pin.
  assert.ok(store.has("harbor.playback-history.v1.p_demo"));
  assert.ok(store.has("harbor.iptv.stats.v1"));
  assert.ok(store.has("harbor.lastseason.v1"));
  assert.ok(store.has("harbor.parental"));
  assert.ok(store.has("harbor.settings"));
});

test("boot cleanup stops as soon as the store takes writes again", async () => {
  // Freeing the one biggest cache is enough here, so the rest must still be there: buying
  // headroom nobody asked for costs the user a refetch of everything it dropped.
  const store = installQuotaStorage([
    ["harbor.settings", filler(300_000)],
    ["harbor.mal.hero.v1", filler(200_000)],
    ["harbor.ebook.openlibrary.v2.anonymous.abc", filler(150_000)],
    ["harbor.sports.board.v3:SOCCER@20261031@day", filler(140_000)],
  ]);

  const { proactiveStorageCleanup } = await import("@/lib/storage-recovery");
  proactiveStorageCleanup();

  localStorage.setItem("harbor.onboarding", "{}");
  assert.equal(store.has("harbor.mal.hero.v1"), false);
  assert.ok(store.has("harbor.ebook.openlibrary.v2.anonymous.abc"));
  assert.ok(store.has("harbor.sports.board.v3:SOCCER@20261031@day"));
});

test("setItemWithRecovery reports failure instead of throwing when nothing is left to prune", async () => {
  installQuotaStorage([["harbor.settings", filler(900)]]);
  const { setItemWithRecovery } = await import("@/lib/storage-recovery");
  assert.equal(setItemWithRecovery("harbor.onboarding", filler(500)), false);
});
