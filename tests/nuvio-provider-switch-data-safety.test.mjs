import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const load = (path, mocks, storage) => {
  const code = ts.transpileModule(read(path), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "localStorage", code)(
    (id) => mocks[id] ?? {},
    exports,
    storage,
  );
  return exports;
};

const storageFrom = (data) => ({
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, String(value)),
  removeItem: (key) => data.delete(key),
  clear: () => data.clear(),
  key: (index) => [...data.keys()][index] ?? null,
  get length() {
    return data.size;
  },
});

const loadQueue = (data, state) =>
  load(
    "src/lib/stremio-write-queue.ts",
    {
      "@/lib/stremio": {
        libraryGetOneStrict: async () => null,
        libraryPut: async (_authKey, item) => {
          if (state.offline) throw new Error("offline");
          state.writes.push(item);
        },
      },
      "./active-profile-id": {
        isNuvioProviderActive: () => state.nuvio,
      },
    },
    storageFrom(data),
  );

test("pending Stremio writes survive a Nuvio session and replay afterwards", async () => {
  const data = new Map();
  const state = { nuvio: false, offline: true, writes: [] };
  const first = loadQueue(data, state);

  await first.cloudLibraryPut("fixture", {
    _id: "tt1",
    removed: false,
    temp: false,
    _mtime: "2026-01-02",
    state: { timeOffset: 60000 },
  });
  assert.equal(JSON.parse(data.get("harbor.stremio.write-queue.v1")).length, 1);

  state.nuvio = true;
  state.offline = false;
  await first.flushWriteQueue();

  assert.equal(state.writes.length, 0, "Nuvio mode must not write to the Stremio cloud");
  assert.equal(
    JSON.parse(data.get("harbor.stremio.write-queue.v1")).length,
    1,
    "flushing in Nuvio mode must keep the pending write",
  );

  // A fresh module instance reproduces the next launch after switching back.
  state.nuvio = false;
  const second = loadQueue(data, state);
  await second.flushWriteQueue();

  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].state.timeOffset, 60000);
  assert.equal(JSON.parse(data.get("harbor.stremio.write-queue.v1")).length, 0);
});

test("Stremio CW sanitation removes only Nuvio-origin cards", () => {
  const data = new Map();
  const key = "harbor.localcw.v1.primary";
  data.set(
    key,
    JSON.stringify({
      tt111: {
        id: "tt111",
        type: "series",
        name: "Nuvio card",
        positionMs: 1,
        durationMs: 2,
        t: 1,
        external: "nuvio",
      },
      tt222: {
        id: "tt222",
        type: "series",
        name: "Stremio card",
        positionMs: 1,
        durationMs: 2,
        t: 2,
        external: "stremio",
      },
      tt333: {
        id: "tt333",
        type: "series",
        name: "Legacy Stremio card",
        positionMs: 1,
        durationMs: 2,
        t: 3,
      },
    }),
  );
  const cw = load(
    "src/lib/local-cw.ts",
    {
      "./cw-profile": {
        cwProfileScope: () => ({ sharedId: "primary", profileId: "primary" }),
        privateCwProfileId: () => null,
      },
      "./active-profile-id": {
        isNuvioProviderActive: () => false,
        getNuvioActiveSlot: () => 1,
      },
    },
    storageFrom(data),
  );

  cw.sanitizeStremioLocalCw();

  assert.deepEqual(Object.keys(JSON.parse(data.get(key))).sort(), ["tt222", "tt333"]);
});
