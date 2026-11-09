import assert from "node:assert/strict";
import test from "node:test";
import "./_indexeddb-stub.ts";
import { idbCacheGet } from "../src/lib/idb-cache.ts";
import {
  membershipSavedAtKey,
  mirrorMembershipSnapshot,
  readMembershipMirror,
} from "../src/lib/membership-durable.ts";
import {
  addToCollection,
  createCollection,
  hydrateCollectionsFromDurable,
  readCollections,
  resetCollectionsSessionCache,
} from "../src/lib/collections.ts";

const COLLECTIONS = "harbor.collections.v1";

function installStorage(full = false) {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem(key: string, value: string) {
      if (full && key.startsWith("harbor.collections")) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      store.set(key, String(value));
    },
    removeItem: (key: string) => void store.delete(key),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  return store;
}

function waitForMirror() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

test("a collection kept in memory during a full localStorage survives reopening", async () => {
  const full = installStorage(true);
  resetCollectionsSessionCache();
  const id = createCollection("Survives the restart");
  assert.ok(id);
  assert.equal(readCollections()[0]?.name, "Survives the restart");

  await waitForMirror();
  assert.equal(full.get(COLLECTIONS), undefined);
  const mirror = await readMembershipMirror<unknown[]>(COLLECTIONS);
  assert.equal(Array.isArray(mirror?.data), true);

  // Reopen: a fresh writable store, no session memory.
  const reopened = installStorage(false);
  resetCollectionsSessionCache();
  await hydrateCollectionsFromDurable();

  assert.equal(readCollections()[0]?.name, "Survives the restart");
  assert.equal(JSON.parse(reopened.get(COLLECTIONS)!)[0].name, "Survives the restart");
});

test("an immediate close after creating and renaming a collection keeps the name", () => {
  const store = installStorage(false);
  resetCollectionsSessionCache();
  const id = createCollection("Immediate collection");
  assert.ok(id);

  // No await: localStorage must already hold the edit when the window closes.
  assert.equal(JSON.parse(store.get(COLLECTIONS)!)[0].name, "Immediate collection");
  resetCollectionsSessionCache();
  assert.equal(readCollections()[0]?.name, "Immediate collection");
});

test("an immediate close after a full-storage collection edit survives reopening", async () => {
  installStorage(true);
  resetCollectionsSessionCache();
  assert.ok(createCollection("Immediate full storage"));

  // Reopen without waiting for a separate save step.
  installStorage(false);
  resetCollectionsSessionCache();
  await hydrateCollectionsFromDurable();
  assert.equal(readCollections()[0]?.name, "Immediate full storage");
});

test("ordinary closing keeps a collection in localStorage", () => {
  const store = installStorage(false);
  resetCollectionsSessionCache();
  const id = createCollection("Ordinary close");
  assert.ok(id);
  resetCollectionsSessionCache();

  assert.equal(readCollections()[0]?.name, "Ordinary close");
  assert.equal(JSON.parse(store.get(COLLECTIONS)!)[0].name, "Ordinary close");
});

test("a marker-less older local snapshot is replaced by the newer mirror", async () => {
  const store = installStorage(false);
  store.set(
    COLLECTIONS,
    JSON.stringify([{ id: "old", name: "Old local", items: [], createdAt: 1, updatedAt: 1 }]),
  );
  mirrorMembershipSnapshot(
    COLLECTIONS,
    [{ id: "new", name: "Newer durable", items: [], createdAt: 2, updatedAt: 2 }],
    100,
    false,
  );

  resetCollectionsSessionCache();
  await hydrateCollectionsFromDurable();
  assert.equal(readCollections()[0]?.name, "Newer durable");
});

test("a newer local snapshot is not replaced by an older IndexedDB copy", async () => {
  const store = installStorage(false);
  const local = [{ id: "local", name: "Local wins", items: [], createdAt: 1, updatedAt: 2 }];
  store.set(COLLECTIONS, JSON.stringify(local));
  store.set(membershipSavedAtKey(COLLECTIONS), "200");
  mirrorMembershipSnapshot(
    COLLECTIONS,
    [{ id: "durable", name: "Older durable", items: [], createdAt: 1, updatedAt: 1 }],
    100,
    false,
  );

  resetCollectionsSessionCache();
  await hydrateCollectionsFromDurable();
  assert.equal(readCollections()[0]?.name, "Local wins");
});

test("collection membership writes are mirrored durably", async () => {
  installStorage(false);
  resetCollectionsSessionCache();
  const id = createCollection("With an item");
  assert.ok(id);
  assert.equal(
    addToCollection(id, { id: "tt-durable", type: "movie", name: "Fixture" }).status,
    "added",
  );

  await waitForMirror();
  const mirror = await readMembershipMirror<{ id: string; items: unknown[] }[]>(COLLECTIONS);
  const collection = mirror?.data.find((entry) => entry.id === id);
  assert.equal(collection?.items.length, 1);
  assert.equal((await idbCacheGet(`harbor.membership.durable.v1:${COLLECTIONS}`)) != null, true);
});

test("profile-isolated collections hydrate only the active profile", async () => {
  const store = installStorage(false);
  store.set(
    "harbor.profiles.v1",
    JSON.stringify({
      activeId: "b",
      profiles: [
        { id: "a", settingsLinked: false },
        { id: "b", settingsLinked: false },
      ],
    }),
  );
  mirrorMembershipSnapshot(
    "harbor.collections.a",
    [{ id: "a", name: "Profile A", items: [], createdAt: 1, updatedAt: 1 }],
    100,
    false,
  );
  mirrorMembershipSnapshot(
    "harbor.collections.b",
    [{ id: "b", name: "Profile B", items: [], createdAt: 1, updatedAt: 1 }],
    100,
    false,
  );

  resetCollectionsSessionCache();
  await hydrateCollectionsFromDurable();
  assert.deepEqual(
    readCollections().map((entry) => entry.name),
    ["Profile B"],
  );
});
