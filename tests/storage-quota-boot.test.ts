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
    ["harbor.playback-history.v1.p_demo", filler(400_000)],
    ["harbor.streamBadges.v1", filler(250_000)],
    ["harbor.libraryNameRepair.v1.p_demo", "1699999999999"],
    [
      "harbor.omdb.budget",
      JSON.stringify({
        used: 920,
        limit: 1000,
        resetAt: 2000000000000,
        exhausted: false,
        keyInvalid: false,
      }),
    ],
    ["harbor.settings", filler(200_000)],
    ["harbor.mal.hero.v1", filler(100_000)],
  ]);

  assert.throws(() => localStorage.setItem("harbor.onboarding", "{}"));

  const { proactiveStorageCleanup } = await import("@/lib/storage-recovery");
  proactiveStorageCleanup();

  localStorage.setItem("harbor.onboarding", "{}");
  assert.equal(store.get("harbor.onboarding"), "{}");

  // The cache goes; the 400k of continue watching next to it does not, however full we are.
  assert.equal(store.has("harbor.mal.hero.v1"), false);
  assert.ok(store.has("harbor.playback-history.v1.p_demo"));
  assert.ok(store.has("harbor.streamBadges.v1"));
  assert.equal(store.get("harbor.libraryNameRepair.v1.p_demo"), "1699999999999");
  assert.equal(JSON.parse(store.get("harbor.omdb.budget")!).used, 920);
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

/**
 * The ordering in the tests above means a wrongly listed key may simply never be reached, so
 * guard the list itself with the sweep that spares nothing prunable.
 */
test("the full sweep evicts caches and nothing the user did", async () => {
  const store = installQuotaStorage([
    ["harbor.playback-history.v1.p_demo", filler(1_000)],
    ["harbor.iptv.stats.v1", filler(1_000)],
    ["harbor.iptv.epgmap.v1", filler(1_000)],
    ["harbor.discover.v1", filler(1_000)],
    ["harbor.lastseason.v1", filler(1_000)],
    ["harbor.parental", filler(1_000)],
    ["harbor.build.rating.v1", filler(1_000)],
    ["harbor.streamBadges.v1", filler(1_000)],
    ["harbor.libraryNameRepair.v1.p_demo", "1699999999999"],
    ["harbor.libraryNameRepair.v99.p_demo", "1699999999999"],
    [
      "harbor.omdb.budget",
      JSON.stringify({
        used: 920,
        limit: 1000,
        resetAt: 2000000000000,
        exhausted: false,
        keyInvalid: false,
      }),
    ],
    ["harbor.settings", filler(1_000)],
    ["harbor.omdb.v1", filler(1_000)],
    ["harbor.omdb.misses", filler(1_000)],
    ["harbor.mal.hero.v1", filler(1_000)],
    ["harbor.tvdbo.tt0903747", filler(1_000)],
  ]);

  const { freeStorageSpace } = await import("@/lib/storage-recovery");
  freeStorageSpace();

  assert.deepEqual([...store.keys()].sort(), [
    "harbor.build.rating.v1",
    "harbor.discover.v1",
    "harbor.iptv.epgmap.v1",
    "harbor.iptv.stats.v1",
    "harbor.lastseason.v1",
    "harbor.libraryNameRepair.v1.p_demo",
    "harbor.libraryNameRepair.v99.p_demo",
    "harbor.omdb.budget",
    "harbor.parental",
    "harbor.playback-history.v1.p_demo",
    "harbor.settings",
    "harbor.streamBadges.v1",
  ]);
});

test("a cache stays prunable after its owner bumps the version", async () => {
  // Pinning versions in the list is how harbor.jikancatalog2, harbor.armkitsucache.v3 and five
  // others quietly became unreachable: the list still named the version before.
  const store = installQuotaStorage([
    ["harbor.jikancatalog2", filler(1_000)],
    ["harbor.armkitsucache.v3", filler(1_000)],
    ["harbor.anidbtvdbcache.v2", filler(1_000)],
    ["harbor.armsrcmalcache.v2", filler(1_000)],
    ["harbor.extkitsucache.v2", filler(1_000)],
    ["harbor.anime_awards.metas.v6", filler(1_000)],
    ["harbor.anime.toppicks.cache.v2", filler(1_000)],
    ["harbor.awards.wikidata.v10", filler(1_000)],
    ["harbor.graph.wikidata.v2", filler(1_000)],
    ["harbor.mal.hero.v1", filler(1_000)],
    ["harbor.ebook.nyt.v1", filler(1_000)],
    ["harbor.anime.art.v2", filler(1_000)],
    ["harbor.anime.hero.hosted.v5", filler(1_000)],
    ["harbor.sports.board.v3:SOCCER@20261031@day", filler(1_000)],
    ["harbor.ebook.openlibrary.v2.anonymous.abc", filler(1_000)],
    ["harbor.manga.cache.v2.one-piece", filler(1_000)],
    // Versions nobody has shipped yet: the next bump must not need this list touched again.
    ["harbor.armkitsucache.v99", filler(1_000)],
    ["harbor.mal.hero.v9", filler(1_000)],
    ["harbor.sports.board.v9:SOCCER@20261031@day", filler(1_000)],
    ["harbor.manga.cache.v9.one-piece", filler(1_000)],
    ["harbor.settings", filler(1_000)],
  ]);

  const { freeStorageSpace } = await import("@/lib/storage-recovery");
  freeStorageSpace();

  assert.deepEqual([...store.keys()], ["harbor.settings"]);
});

test("boot recovery frees room for a real write, not for one character", async () => {
  // Many small caches behind a big record: a one-character probe is satisfied by the first
  // prune, and the settings or profile blob that follows still throws.
  const seed: Array<[string, string]> = [["harbor.settings", filler(500_000)]];
  for (let i = 0; i < 10; i++) seed.push([`harbor.tvdbo.tt${i}`, filler(5_000)]);
  installQuotaStorage(seed);

  const { proactiveStorageCleanup } = await import("@/lib/storage-recovery");
  proactiveStorageCleanup();

  // Four times the largest prunable entry, so only a real headroom target can cover it.
  localStorage.setItem("harbor.profiles.v1", filler(20_000));
});
