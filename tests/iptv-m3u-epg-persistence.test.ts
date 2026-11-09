import assert from "node:assert/strict";
import test from "node:test";

type StorageLike = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
};

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => data.clear(),
  };
}

(globalThis as unknown as { localStorage: StorageLike }).localStorage = memoryStorage();

const store = await import("../src/lib/iptv/playlists-store.ts");

test("stores a header guide URL and marks the M3U entry as checked", () => {
  store.writePlaylists([
    { id: "a", name: "A", url: "https://host.example.com/a.m3u", kind: "m3u" },
    { id: "b", name: "B", url: "https://host.example.com/get.php", kind: "xtream" },
  ]);

  store.recordM3uEpgDiscovery("a", "https://host.example.com/guide.xml");

  const [a, b] = store.readPlaylists();
  assert.equal(a.epgUrl, "https://host.example.com/guide.xml");
  assert.equal(a.epgHeaderChecked, true);
  assert.equal(b.epgUrl, undefined);
  assert.equal(b.epgHeaderChecked, undefined);
});

test("never replaces a user-entered guide URL", () => {
  store.writePlaylists([
    {
      id: "a",
      name: "A",
      url: "https://host.example.com/a.m3u",
      kind: "m3u",
      epgUrl: "https://user.example.com/guide.xml",
    },
  ]);

  store.recordM3uEpgDiscovery("a", "https://host.example.com/guide.xml");

  const [a] = store.readPlaylists();
  assert.equal(a.epgUrl, "https://user.example.com/guide.xml");
  assert.equal(a.epgHeaderChecked, true);
});

test("marks a header-less list as checked without inventing a guide URL", () => {
  store.writePlaylists([{ id: "a", name: "A", url: "https://host.example.com/a.m3u", kind: "m3u" }]);

  store.recordM3uEpgDiscovery("a", null);
  store.recordM3uEpgDiscovery("a", null);

  const [a] = store.readPlaylists();
  assert.equal(a.epgUrl, undefined);
  assert.equal(a.epgHeaderChecked, true);
  assert.equal(
    globalThis.localStorage.getItem("harbor.iptv.playlists.v1"),
    JSON.stringify([{ id: "a", name: "A", url: "https://host.example.com/a.m3u", kind: "m3u", epgHeaderChecked: true }]),
  );
});
