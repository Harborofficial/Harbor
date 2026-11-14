import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { parseRefractHistoryId } from "../src/lib/refract/identity.ts";

function harness() {
  const db = new Map();
  const calls = [];
  let primary = true;
  let enabled = true;
  let key = "rfk_fixture";
  let offline = false;
  const storage = {
    getItem: (name) => db.get(name) ?? null,
    setItem: (name, value) => db.set(name, value),
    removeItem: (name) => db.delete(name),
  };
  const oldStorage = globalThis.localStorage;
  const oldWindow = globalThis.window;
  globalThis.localStorage = storage;
  globalThis.window = new EventTarget();
  const client = {
    getRefractKey: () => key,
    refractEnabled: () => enabled,
    lookupRefract: async (_key, _idType, _id, type, season, episode) =>
      type === "movie"
        ? [{ ids: { refract: "movie-ref" } }]
        : [{ show: { ids: { refract: "show-ref" } }, episode: { season, number: episode } }],
    writeRefractMovie: async (...args) => {
      if (offline) throw new Error("offline");
      calls.push({ kind: "movie", args });
    },
    writeRefractEpisode: async (...args) => {
      if (offline) throw new Error("offline");
      calls.push({ kind: "episode", args });
    },
    RefractApiError: class RefractApiError extends Error {},
  };
  const file = readFileSync(new URL("../src/lib/refract/sync.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(file, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    (id) => {
      if (id === "@/lib/active-profile-id") return { activeProfileIsPrimary: () => primary };
      if (id === "./client") return client;
      if (id === "./identity") return { parseRefractHistoryId };
      throw new Error(`Unexpected import: ${id}`);
    },
    module,
    module.exports,
  );
  return {
    sync: module.exports,
    db,
    calls,
    setPrimary: (v) => {
      primary = v;
    },
    setEnabled: (v) => {
      enabled = v;
    },
    setKey: (v) => {
      key = v;
    },
    setLookup: (v) => {
      client.lookupRefract = v;
    },
    setOffline: (v) => {
      offline = v;
    },
    cleanup: () => {
      globalThis.localStorage = oldStorage;
      globalThis.window = oldWindow;
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const movieEvent = (id = "tmdb:movie:55") => ({
  id,
  type: "movie",
  name: "Fixture movie",
  at: Date.parse("2026-11-12T21:15:00Z"),
});
const episodeEvent = (id = "tt11280740") => ({
  id,
  type: "series",
  name: "Fixture show",
  season: 2,
  episode: 4,
  at: Date.parse("2026-11-12T21:15:00Z"),
});

test("completed movie is queued and sent once, with repeat watch event deduplicated", async () => {
  const h = harness();
  try {
    h.sync.enqueueRefractWatch(movieEvent());
    await tick();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].kind, "movie");
    assert.equal(h.calls[0].args[1], "movie-ref");
    assert.equal(h.sync.refractStatus().pending, 0);
    h.sync.enqueueRefractWatch(movieEvent());
    await tick();
    assert.equal(h.calls.length, 1);
  } finally {
    h.cleanup();
  }
});

test("completed episode resolves and sends its exact original season and number", async () => {
  const h = harness();
  try {
    h.sync.enqueueRefractWatch(episodeEvent());
    await tick();
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0].args.slice(1), [
      "show-ref",
      2,
      4,
      Date.parse("2026-11-12T21:15:00Z"),
    ]);
  } finally {
    h.cleanup();
  }
});

test("a TV show TMDB ID must not be treated as a movie", async () => {
  const h = harness();
  try {
    h.sync.enqueueRefractWatch(movieEvent("tmdb:tv:55"));
    await tick();
    assert.equal(h.calls.length, 0);
    assert.equal(h.sync.refractStatus().failed, 1);
  } finally {
    h.cleanup();
  }
});

test("nonprimary Harbor profiles never upload another profile's history", async () => {
  const h = harness();
  try {
    h.setPrimary(false);
    h.sync.enqueueRefractWatch(movieEvent());
    await tick();
    assert.equal(h.calls.length, 0);
    assert.equal(h.sync.refractStatus().pending, 0);
  } finally {
    h.cleanup();
  }
});

test("offline queue persists and retries without losing the viewing time", async () => {
  const h = harness();
  try {
    h.setOffline(true);
    h.sync.enqueueRefractWatch(episodeEvent());
    await tick();
    assert.equal(h.sync.refractStatus().pending, 1);
    const raw = JSON.parse(h.db.get("harbor.refract.sync.v1"));
    assert.equal(raw.pending[0].watchedAt, Date.parse("2026-11-12T21:15:00Z"));
    h.setOffline(false);
    h.sync.retryRefractSync();
    await tick();
    assert.equal(h.sync.refractStatus().pending, 0);
    assert.equal(h.calls.length, 1);
  } finally {
    h.cleanup();
  }
});

test("disabling sync during a lookup preserves the queued watch without sending it", async () => {
  const h = harness();
  try {
    let finish;
    h.setLookup(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    h.sync.enqueueRefractWatch(movieEvent());
    h.setEnabled(false);
    finish([{ ids: { refract: "movie-ref" } }]);
    await tick();
    assert.equal(h.calls.length, 0);
    assert.equal(h.sync.refractStatus().pending, 1);
    assert.equal(h.sync.refractStatus().failed, 0);
  } finally {
    h.cleanup();
  }
});
