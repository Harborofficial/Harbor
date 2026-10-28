// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import "./_localstorage-stub.ts";
import {
  clearPmdbListsCache,
  fetchPmdbLists,
  fetchPmdbListItems,
  getPmdbDefaultListId,
  PmdbListError,
  resolvePmdbList,
  setPmdbDefaultListId,
} from "../src/lib/publicmetadb/lists.ts";
import { getSession, resetForProfile, setSession } from "../src/lib/publicmetadb/session.ts";
import { addToPmdbWatchlist, fetchPmdbWatchlist, removeFromPmdbWatchlist } from "../src/lib/publicmetadb/watchlist.ts";

const json = (data: unknown) => Response.json(data);
const list = (id: string, type = "custom") => ({ id, name: id, type });
const target = { tmdb_id: 603, media_type: "movie" as const };

async function fixture(run: (calls: Array<{ path: string; method: string; body: any }>, server: (fn: (url: URL, init?: RequestInit) => Response | Promise<Response>) => void) => Promise<void>) {
  localStorage.clear();
  resetForProfile();
  setSession({ apiKey: "pm-test-placeholder", validatedAt: 1 });
  clearPmdbListsCache();
  const original = globalThis.fetch;
  const calls: Array<{ path: string; method: string; body: any }> = [];
  let handler = (_url: URL, _init?: RequestInit): Response | Promise<Response> => { throw new Error("Unexpected request"); };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return handler(url, init);
  };
  try { await run(calls, (fn) => { handler = fn; }); }
  finally {
    globalThis.fetch = original;
    setSession(null);
    localStorage.clear();
    resetForProfile();
    setSession(null);
    clearPmdbListsCache();
  }
}

test("owned list discovery paginates and resolves a watchlist after the first page", async () => {
  await fixture(async (calls, server) => {
    server((url) => json({
      items: url.searchParams.get("page") === "1"
        ? Array.from({ length: 100 }, (_, i) => list(`custom-${i}`)) : [list("watch", "watchlist")],
      total: 101,
    }));
    assert.equal((await fetchPmdbLists()).length, 101);
    assert.equal((await resolvePmdbList())?.id, "watch");
    assert.equal(calls.length, 2);
  });
});

test("reads stay read-only and simultaneous first additions create one private watchlist", async () => {
  await fixture(async (calls, server) => {
    let created = false;
    server((url, init) => {
      if (url.pathname === "/api/external/lists") {
        if (init?.method === "POST") {
          created = true;
          return json({ success: true, item: list("watch", "watchlist") });
        }
        return json({ items: created ? [list("watch", "watchlist")] : [], total: created ? 1 : 0 });
      }
      return json({ success: true });
    });
    assert.deepEqual(await fetchPmdbWatchlist({ strict: true }), []);
    assert.equal(calls.some((call) => call.method !== "GET"), false);
    assert.deepEqual(await Promise.all([
      addToPmdbWatchlist(target, { strict: true }),
      addToPmdbWatchlist({ ...target, tmdb_id: 604 }, { strict: true }),
    ]), [true, true]);
    const creations = calls.filter((call) => call.method === "POST" && call.path === "/api/external/lists");
    assert.equal(creations.length, 1);
    assert.deepEqual(creations[0].body, { name: "Watchlist", type: "watchlist", is_public: false });
    assert.equal(calls.filter((call) => call.method === "POST" && call.path.endsWith("/items")).length, 2);
  });
});

test("the saved default survives cache/session reload and explicit browsing does not change it", async () => {
  await fixture(async (_calls, server) => {
    server((url) => url.pathname === "/api/external/lists"
      ? json({ items: [list("watch", "watchlist"), list("weekend"), list("anime")], total: 3 })
      : json({ items: [{ id: "item", list_id: url.pathname.split("/")[4], ...target }], total: 1 }));
    setPmdbDefaultListId("weekend");
    clearPmdbListsCache();
    setSession({ ...getSession()! });
    assert.equal((await resolvePmdbList())?.id, "weekend");
    await fetchPmdbListItems("anime");
    assert.equal(getPmdbDefaultListId(), "weekend");
    assert.equal((await fetchPmdbWatchlist({ strict: true }))[0].list_id, "weekend");
  });
});

test("add captures its destination before async work and remove uses the explicitly browsed list", async () => {
  await fixture(async (calls, server) => {
    setPmdbDefaultListId("weekend");
    server((url, init) => {
      if (url.pathname === "/api/external/lists") {
        setPmdbDefaultListId("anime");
        return json({ items: [list("weekend"), list("anime")], total: 2 });
      }
      if (init?.method === "GET") return json({ items: [{ id: "anime-item", list_id: "anime", ...target }], total: 1 });
      return json({ success: true });
    });
    assert.equal(await addToPmdbWatchlist(target, { strict: true }), true);
    assert.ok(calls.some((call) => call.method === "POST" && call.path.endsWith("/weekend/items")));
    await removeFromPmdbWatchlist(target, { listId: "anime", strict: true });
    assert.ok(calls.some((call) => call.method === "DELETE" && call.path.endsWith("/anime/items/anime-item")));
  });
});

test("a deleted default blocks writes instead of choosing another list", async () => {
  await fixture(async (calls, server) => {
    setPmdbDefaultListId("deleted");
    server(() => json({ items: [list("watch", "watchlist"), list("other")], total: 2 }));
    await assert.rejects(addToPmdbWatchlist(target, { strict: true }), (error: unknown) => error instanceof PmdbListError && error.reason === "missing");
    assert.equal(calls.some((call) => call.method !== "GET"), false);
  });
});

test("a failed lists request never initializes a watchlist", async () => {
  await fixture(async (calls, server) => {
    server(() => new Response("Forbidden", { status: 403 }));
    await assert.rejects(addToPmdbWatchlist(target, { strict: true }), (error: unknown) => error instanceof PmdbListError && error.reason === "read");
    assert.equal(calls.some((call) => call.method !== "GET"), false);
  });
});

test("account changes during list preparation prevent writes and discard cached ownership", async () => {
  await fixture(async (calls, server) => {
    server(() => {
      setSession({ apiKey: "pm-other-placeholder", validatedAt: 2 });
      return json({ items: [list("old", "watchlist")], total: 1 });
    });
    await assert.rejects(addToPmdbWatchlist(target, { strict: true }), /account change/);
    assert.equal(calls.some((call) => call.method !== "GET"), false);
    server(() => json({ items: [list("new", "watchlist")], total: 1 }));
    assert.equal((await resolvePmdbList())?.id, "new");
  });
});

test("default list preferences are scoped to the active Harbor profile", async () => {
  await fixture(async () => {
    setPmdbDefaultListId("primary-list");
    localStorage.setItem("harbor.profiles.v1", JSON.stringify({ activeId: "second" }));
    assert.equal(getPmdbDefaultListId(), null);
    setPmdbDefaultListId("second-list");
    localStorage.removeItem("harbor.profiles.v1");
    assert.equal(getPmdbDefaultListId(), "primary-list");
    assert.equal([...Array(localStorage.length)].map((_, i) => localStorage.key(i)).some((key) => key?.includes("pm-test-placeholder")), false);
  });
});

test("item pagination rejects incomplete or repeated pages instead of reporting an empty list", async () => {
  await fixture(async (_calls, server) => {
    server(() => json({ items: [{ id: "same", list_id: "x", ...target }], total: 2 }));
    await assert.rejects(fetchPmdbListItems("x"), (error: unknown) => error instanceof PmdbListError && error.reason === "read");
  });
});
