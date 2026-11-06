import assert from "node:assert/strict";
import test from "node:test";
import {
  createMediaCache,
  mediaCacheKey,
  episodeCacheTtl,
  MEDIA_TTL,
} from "../src/lib/media-cache.ts";
import { createObjectUrlCache } from "../src/lib/object-url-cache.ts";

function fixture(options = {}) {
  const records = options.records ?? new Map();
  let now = 1000;
  const store = {
    async get(key) {
      return structuredClone(records.get(key) ?? null);
    },
    async put(record) {
      records.set(record.key, structuredClone(record));
      return true;
    },
    async list() {
      return [...records.values()].map(({ value: _value, ...entry }) => entry);
    },
    async remove(keys) {
      keys.forEach((key) => records.delete(key));
    },
    async clear() {
      records.clear();
      return true;
    },
    ...options.store,
  };
  return {
    records,
    store,
    cache: createMediaCache(store, { now: () => now, ...options }),
    advance(ms) {
      now += ms;
    },
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("persistent snapshots survive restart and cannot be changed by callers", async () => {
  const f = fixture();
  const first = await f.cache.load("show", async () => ({ episodes: [1, 2] }));
  first.value.episodes.pop();
  const restarted = fixture({ records: f.records });
  const hit = await restarted.cache.load("show", async () => {
    throw Error("unexpected network");
  });
  assert.deepEqual(hit.value, { episodes: [1, 2] });
  assert.equal(hit.storedAt, 1000);
  assert.equal((await restarted.cache.stats()).diskHits, 1);
});

test("concurrent misses share the loader and return separate snapshots", async () => {
  const f = fixture();
  const gate = deferred();
  let calls = 0;
  const loader = async () => {
    calls++;
    await gate.promise;
    return [1];
  };
  const a = f.cache.load("show", loader);
  const b = f.cache.load("show", loader);
  gate.resolve();
  const results = await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.notEqual(results[0].value, results[1].value);
});

test(
  "provider results and unrelated lookups do not wait for cache writes",
  { timeout: 2000 },
  async () => {
    const gate = deferred();
    const f = fixture({
      memoryBytes: 0,
      store: {
        put: async () => {
          await gate.promise;
          return true;
        },
      },
    });
    try {
      const first = await f.cache.load("show", async () => ({ episodes: [1] }));
      assert.deepEqual(first.value, { episodes: [1] });
      assert.equal(first.storedAt, 1000);
      assert.deepEqual(
        (await f.cache.load("show", async () => assert.fail("pending snapshot lost"))).value,
        first.value,
      );
      const other = await f.cache.load("other", async () => [2]);
      assert.deepEqual(other.value, [2]);
      assert.equal((await f.cache.peek("show")).storedAt, 1000);
    } finally {
      gate.resolve();
      await f.cache.flush();
    }
  },
);

test("reads during clearing wait for the clear instead of reviving disk snapshots", async () => {
  const gate = deferred();
  const f = fixture({
    store: {
      async clear() {
        await gate.promise;
        f.records.clear();
        return true;
      },
    },
  });
  await f.cache.save("show", [1], {});
  const clearing = f.cache.clear();
  let loaded = false;
  const load = f.cache.load("show", async () => {
    loaded = true;
    return [2];
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loaded, false);
  gate.resolve();
  await clearing;
  assert.deepEqual((await load).value, [2]);
  await f.cache.flush();
  assert.deepEqual(f.records.get("show").value, [2]);
});

test("stale snapshots render immediately and refresh without sliding their timestamp", async () => {
  const f = fixture();
  await f.cache.save("show", [1], { ttl: 10 });
  f.advance(11);
  const gate = deferred();
  const stale = await f.cache.load(
    "show",
    async () => {
      await gate.promise;
      return [1, 2];
    },
    { ttl: 10, staleWhileRevalidate: true },
  );
  assert.deepEqual(stale.value, [1]);
  assert.equal(stale.storedAt, 1000);
  assert.equal(f.records.get("show").storedAt, 1000);
  gate.resolve();
  assert.deepEqual(await stale.refresh, [1, 2]);
  assert.equal(f.records.get("show").storedAt, 1011);
});

test("a failed or rejected refresh cannot replace the last complete catalog", async () => {
  const f = fixture();
  await f.cache.save("show", [1, 2], { ttl: 1 });
  f.advance(2);
  const result = await f.cache.load("show", async () => [1], {
    valid: (rows) => rows.length === 2,
  });
  assert.deepEqual(result.value, [1, 2]);
  assert.deepEqual(f.records.get("show").value, [1, 2]);
  assert.equal(f.records.get("show").storedAt, 1000);
});

test("failed background refreshes return no replacement and retry after a short backoff", async () => {
  const f = fixture();
  await f.cache.save("show", [1], { ttl: 1 });
  f.advance(2);
  let calls = 0;
  const loader = async () => {
    calls++;
    throw Error("offline");
  };
  const result = await f.cache.load("show", loader, { staleWhileRevalidate: true });
  assert.equal(await result.refresh, null);
  assert.deepEqual(result.value, [1]);
  await f.cache.load("show", loader, { staleWhileRevalidate: true });
  assert.equal(calls, 1);
  assert.equal(f.records.get("show").storedAt, 1000);
  f.advance(30_001);
  const retried = await f.cache.load("show", loader, { staleWhileRevalidate: true });
  await retried.refresh;
  assert.equal(calls, 2);
});

test("an explicit maxAge 0 refresh bypasses the failure backoff", async () => {
  const f = fixture();
  let calls = 0;
  const failing = async () => {
    calls++;
    throw Error("offline");
  };
  assert.equal((await f.cache.load("show", failing)).value, null);
  assert.equal((await f.cache.load("show", failing)).value, null);
  assert.equal(calls, 1, "the ordinary retry window still suppresses duplicate requests");
  const refreshed = await f.cache.load(
    "show",
    async () => {
      calls++;
      return [2];
    },
    { maxAge: 0 },
  );
  assert.deepEqual(refreshed.value, [2]);
  assert.equal(calls, 2, "an explicit refresh must run the loader");
});

test("clearing invalidates unfinished loaders and commits", async () => {
  const f = fixture();
  const gate = deferred();
  const loading = f.cache.load("show", async () => {
    await gate.promise;
    return [1];
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(await f.cache.clear(), true);
  gate.resolve();
  await loading;
  assert.equal(f.records.size, 0);
  assert.equal((await f.cache.stats()).memoryBytes, 0);
});

test("quota failures retain usable memory and explicitly report failed persistence", async () => {
  const f = fixture({ store: { put: async () => false } });
  assert.equal(await f.cache.save("show", [1], {}), false);
  assert.deepEqual((await f.cache.load("show", async () => null)).value, [1]);
  assert.equal(f.records.size, 0);
});

test("disk and memory budgets evict old entries", async () => {
  const f = fixture({ diskBytes: 30, memoryBytes: 10 });
  for (let n = 0; n < 10; n++) {
    f.advance(1);
    await f.cache.save(String(n), "12345678", {});
  }
  const stats = await f.cache.stats();
  assert.ok(stats.bytes <= 30);
  assert.ok(stats.memoryBytes <= 10);
  assert.ok(!f.records.has("0"));
  assert.ok(f.records.has("9"));
});

test("corrupt and expired snapshots are ignored", async () => {
  const f = fixture();
  f.records.set("show", { key: "show", value: [1], bytes: -1 });
  assert.deepEqual((await f.cache.load("show", async () => [2])).value, [2]);
  await f.cache.save("expired", [1], { ttl: 1, stale: 2 });
  f.advance(3);
  assert.deepEqual((await f.cache.load("expired", async () => [3])).value, [3]);
});

test("hashed keys isolate provider credentials, language and order without storing secrets", async () => {
  const a = await mediaCacheKey("tvdb", ["secret", 1, "aired", "eng"]);
  assert.match(a, /^v1:tvdb:[a-f0-9]{64}$/);
  assert.ok(!a.includes("secret"));
  for (const scope of [
    ["other", 1, "aired", "eng"],
    ["secret", 1, "dvd", "eng"],
    ["secret", 1, "aired", "tur"],
  ])
    assert.notEqual(a, await mediaCacheKey("tvdb", scope));
});

test("aired placeholders refresh within an hour and upcoming air dates shorten freshness", () => {
  const now = Date.parse("2026-10-24");
  assert.equal(episodeCacheTtl([{ title: "TBA", aired: "1999-01-01" }], now), MEDIA_TTL.recent);
  assert.ok(
    episodeCacheTtl([{ title: "Upcoming", aired: "2026-10-24T00:10:00Z" }], now) <
      MEDIA_TTL.episodes,
  );
});

test("object URL eviction and clearing preserve mounted images until release", () => {
  const original = URL.revokeObjectURL;
  const revoked = [];
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
    original(url);
  };
  try {
    const cache = createObjectUrlCache(2, 1);
    const active = cache.set("a", new Blob(["large"]));
    const release = cache.retain(active);
    const idle = cache.set("b", new Blob(["x"]));
    cache.clear();
    assert.ok(revoked.includes(idle.src));
    assert.ok(!revoked.includes(active.src));
    release();
    release();
    assert.equal(revoked.filter((url) => url === active.src).length, 1);
    assert.deepEqual(cache.stats(), { bytes: 0, entries: 0 });
  } finally {
    URL.revokeObjectURL = original;
  }
});
