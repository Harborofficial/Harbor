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

const response = (result) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ result }),
});

const createFixture = () => {
  const data = new Map();
  const state = {
    nuvio: true,
    nuvioIds: [],
    sanitized: 0,
    requests: [],
    fetch: async () => {
      throw new Error("unexpected network call");
    },
  };
  const api = load(
    "src/lib/stremio.ts",
    {
      "@/lib/safe-fetch": {
        safeFetch: (url, init) => state.fetch(url, init),
      },
      "@/lib/active-profile-id": {
        isNuvioProviderActive: () => state.nuvio,
      },
      "@/lib/nuvio/nuvio-client": {
        collectAllNuvioItemIds: () => new Set(state.nuvioIds),
      },
      "@/lib/local-cw": {
        sanitizeStremioLocalCw: () => {
          state.sanitized += 1;
        },
      },
      "@/lib/resume": {},
      "./anime-detect": {},
      "@/lib/manual-watched": {},
    },
    storageFrom(data),
  );
  return { data, state, api };
};

test("Nuvio mode records expunge targets without touching the Stremio cloud", async () => {
  const { data, state, api } = createFixture();
  state.nuvioIds = ["tt111"];

  await api.expungeLeachedNuvioItemsFromStremio();

  assert.equal(state.requests.length, 0, "no Stremio request may run while Nuvio is active");
  assert.deepEqual(JSON.parse(data.get("harbor.stremio.expunge-targets.v1")), ["tt111"]);
  assert.equal(state.sanitized, 1);
});

test("Stremio activation drains deferred targets and removes the cloud items", async () => {
  const { data, state, api } = createFixture();
  state.nuvioIds = ["tt111"];
  await api.expungeLeachedNuvioItemsFromStremio();

  state.nuvio = false;
  state.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    state.requests.push({ path: String(url).split("/").pop(), body });
    if (String(url).endsWith("/datastoreGet")) {
      return response([
        {
          _id: "tt111",
          type: "movie",
          name: "Leaked",
          removed: false,
          temp: false,
          _ctime: "2026-01-01T00:00:00.000Z",
          _mtime: "2026-01-01T00:00:00.000Z",
        },
      ]);
    }
    return response(null);
  };

  await api.expungeLeachedNuvioItemsFromStremio("ak");

  assert.deepEqual(
    state.requests.map((request) => request.path),
    ["datastoreGet", "datastorePut"],
  );
  const put = state.requests[1].body;
  assert.equal(put.collection, "libraryItem");
  assert.equal(put.changes[0]._id, "tt111");
  assert.equal(put.changes[0].removed, true);
  assert.equal(data.has("harbor.stremio.expunge-targets.v1"), false);
});

test("deferred targets survive when no Stremio auth key is available", async () => {
  const { data, state, api } = createFixture();
  state.nuvioIds = ["tt222"];
  await api.expungeLeachedNuvioItemsFromStremio();

  state.nuvio = false;
  await api.expungeLeachedNuvioItemsFromStremio();

  assert.equal(state.requests.length, 0);
  assert.deepEqual(JSON.parse(data.get("harbor.stremio.expunge-targets.v1")), ["tt222"]);
});
