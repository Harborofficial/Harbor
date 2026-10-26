import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function harness() {
  const data = new Map();
  const events = new EventTarget();
  let parses = 0;
  let reads = 0;
  const storage = {
    getItem: (key) => {
      reads += 1;
      return data.get(key) ?? null;
    },
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  function load(file, mocks = {}) {
    const source = readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    new Function("module", "exports", "require", "localStorage", "JSON", "window", output)(
      module,
      module.exports,
      (name) => {
        assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
        return mocks[name];
      },
      storage,
      {
        ...JSON,
        stringify: JSON.stringify,
        parse: (...args) => {
          parses += 1;
          return JSON.parse(...args);
        },
      },
      events,
    );
    return module.exports;
  }
  const profiles = load("active-profile-id");
  return { data, load, profiles, events, parses: () => parses, reads: () => reads };
}

test("a large episode scan reads storage once and a fresh snapshot follows profile and watched changes", () => {
  const h = harness();
  const roster = (activeId) =>
    JSON.stringify({
      activeId,
      profiles: [
        { id: "primary", isPrimary: true },
        { id: "alice", shareStremioWith: "primary" },
        { id: "bob", shareStremioWith: "primary" },
      ],
    });
  h.data.set("harbor.profiles.v1", roster("alice"));
  h.data.set("harbor.settings.shared", '{"cwPerProfile":true,"accountProvider":"stremio"}');
  h.data.set("harbor.resume.private.v1.alice", '{"kitsu:12|s1e1":{"ms":600000,"t":100}}');
  h.data.set("harbor.resume.private.v1.bob", '{"kitsu:12|s1e1":{"ms":120000,"t":200}}');
  h.data.set("harbor.manualwatched.v1.primary", '["kitsu:12|1|2"]');
  const cw = h.load("cw-profile");
  const resume = h.load("resume", { "./cw-profile": cw, "./active-profile-id": h.profiles });
  const manual = h.load("manual-watched", {
    "./active-profile-id": h.profiles,
    "@/lib/render-cause": { noteNotify: () => {} },
    "@/lib/storage-recovery": { persistCritical: (key, value) => h.data.set(key, value) },
  });
  const progress = h.load("episode-progress", {
    "@/lib/manual-watched": manual,
    "@/lib/resume": resume,
  });
  const old = progress.createEpisodeProgressSnapshot();
  const before = h.reads();
  const read = (episode, snapshot) =>
    progress.getEpisodeProgress(
      "kitsu:12",
      1,
      episode,
      20,
      null,
      new Set(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      snapshot,
    );
  for (let ep = 1; ep <= 1400; ep++) read(ep, old);
  assert.equal(
    h.reads(),
    before,
    "an episode scan must not re-read profile and storage for every row",
  );
  assert.equal(read(1, old).ratio, 0.5);
  assert.equal(read(2, old).watched, true);
  h.data.set("harbor.profiles.v1", roster("bob"));
  const current = progress.createEpisodeProgressSnapshot();
  assert.equal(read(1, current).ratio, 0.1);
  assert.equal(read(1, old).ratio, 0.5, "captured render data stays coherent");
  manual.setManualWatched("kitsu:12", 1, 2, false);
  assert.equal(read(2, progress.createEpisodeProgressSnapshot()).watched, false);
});

test("selected profiles stay independent while watched state follows Stremio sharing", () => {
  const h = harness();
  h.data.set(
    "harbor.profiles.v1",
    JSON.stringify({
      activeId: "alice",
      profiles: [
        { id: "primary", isPrimary: true },
        { id: "alice", shareStremioWith: "primary" },
      ],
    }),
  );
  assert.equal(h.profiles.activeProfileId(), "alice");
  assert.equal(h.profiles.stremioProfileId(), "primary");
  assert.equal(h.profiles.primaryProfileId(), "primary");
  const resume = h.load("resume", {
    "./cw-profile": { privateCwProfileId: () => "alice" },
    "./active-profile-id": h.profiles,
  });
  resume.saveResumeMs(
    "tt1",
    90_000,
    1,
    4,
    undefined,
    undefined,
    undefined,
    h.profiles.activeProfileId(),
  );
  assert.equal(resume.readResumeMs("tt1", 1, 4), 90_000);
  const count = h.parses();
  for (let i = 0; i < 100; i += 1) {
    assert.equal(h.profiles.activeProfileId(), "alice");
    assert.equal(h.profiles.stremioProfileId(), "primary");
  }
  assert.equal(h.parses(), count);
  h.data.set(
    "harbor.profiles.v1",
    JSON.stringify({ activeId: "bob", profiles: [{ id: "bob", isPrimary: true }] }),
  );
  assert.equal(h.profiles.activeProfileId(), "bob");
  assert.equal(h.profiles.stremioProfileId(), "bob");
  h.data.delete("harbor.profiles.v1");
  assert.equal(h.profiles.activeProfileId(), "default");
  assert.equal(h.profiles.stremioProfileId(), "");
  assert.equal(h.profiles.primaryProfileId(), "");
});

test("reading legacy movie watches before roster initialization defers migration", () => {
  const h = harness();
  h.data.set("harbor.moviewatched.v1", '["tt1"]');
  const movies = h.load("movie-watched", {
    "./active-profile-id": h.profiles,
    react: {},
    "./storage-recovery": {},
  });
  assert.equal(movies.isMovieWatchedLocal("tt1"), true);
  assert.equal(h.data.has("harbor.moviewatched.v1"), true);
  h.data.set(
    "harbor.profiles.v1",
    JSON.stringify({ activeId: "primary", profiles: [{ id: "primary", isPrimary: true }] }),
  );
  assert.equal(movies.isMovieWatchedLocal("tt1"), true);
  assert.equal(h.data.get("harbor.moviewatched.v1.primary"), '["tt1"]');
  assert.equal(h.data.has("harbor.moviewatched.v1.default"), false);
});

test("provider fallback remains cached and reacts to legacy settings and explicit overrides", () => {
  const h = harness();
  const resume = h.load("resume", {
    "./cw-profile": { privateCwProfileId: () => null },
    "./active-profile-id": h.profiles,
  });
  h.data.set("harbor.settings.shared", '{"theme":"dark"}');
  h.data.set("harbor.settings", '{"accountProvider":"nuvio"}');
  assert.equal(h.profiles.isNuvioProviderActive(), true);
  resume.saveResumeMs("tt1", 1000);
  assert.ok(h.data.has("harbor.resume.private.v1.anon.nuvio-1"));
  const count = h.parses();
  for (let i = 0; i < 100; i += 1) {
    assert.equal(h.profiles.isNuvioProviderActive(), true);
    resume.saveResumeMs("tt1", 1000);
  }
  assert.equal(h.parses(), count);
  h.data.set("harbor.settings", '{"accountProvider":"stremio"}');
  assert.equal(h.profiles.isNuvioProviderActive(), false);
  resume.saveResumeMs("tt2", 2000);
  assert.ok(h.data.has("harbor.resume"));
  h.data.set("harbor.account-provider", "nuvio");
  assert.equal(h.profiles.isNuvioProviderActive(), true);
  h.data.set("harbor.account-provider", "stremio");
  assert.equal(h.profiles.isNuvioProviderActive(), false);
});

test("resume and watched flags use the same provider when legacy settings disagree", () => {
  const h = harness();
  h.data.set("harbor.settings.shared", '{"accountProvider":"stremio"}');
  h.data.set("harbor.settings", '{"accountProvider":"nuvio"}');
  const resume = h.load("resume", {
    "./cw-profile": { privateCwProfileId: () => null },
    "./active-profile-id": h.profiles,
  });
  assert.equal(h.profiles.isNuvioProviderActive(), false);
  resume.saveResumeMs("tt-order", 1234);
  assert.ok(h.data.has("harbor.resume"));
  assert.equal(h.data.has("harbor.resume.private.v1.anon.nuvio-1"), false);
});

test("bulk Nuvio watched flags are isolated and updated with one storage write", () => {
  const h = harness();
  h.data.set(
    "harbor.nuvio.state.v1",
    JSON.stringify({ session: { user: { id: "bulk-account" } }, activeProfileIndex: 1 }),
  );
  h.data.set("harbor.account-provider", "nuvio");
  let writes = 0;
  const flags = h.load("watched-flag", {
    "./active-profile-id": h.profiles,
    "./movie-watched": { isMovieWatchedLocal: () => false, subscribeMovieWatched: () => () => {} },
    "./storage-recovery": {
      persistCritical: (key, value) => {
        writes += 1;
        h.data.set(key, value);
      },
    },
    react: {},
  });
  const ids = new Set(Array.from({ length: 1400 }, (_, i) => `tt-watch-${i}`));
  flags.reconcileNuvioWatchedFlags(1, ids, "bulk-account");
  assert.equal(writes, 1);
  assert.equal(flags.isWatchedFlagged("tt-watch-1399"), true);
  flags.reconcileNuvioWatchedFlags(1, ids, "bulk-account");
  assert.equal(writes, 1, "same snapshot should not write twice");
  h.data.set("harbor.account-provider", "stremio");
  assert.equal(flags.isWatchedFlagged("tt-watch-1399"), false);
  h.data.set("harbor.account-provider", "nuvio");
  assert.equal(flags.isWatchedFlagged("tt-watch-1399"), true);
});

test("Nuvio watched stores isolate accounts offline, retain both owners, and never adopt unowned legacy data", () => {
  const h = harness();
  h.data.set("harbor.account-provider", "nuvio");
  h.data.set("harbor.watchedFlag.nuvio.v1.1", '["legacy"]');
  h.data.set("harbor.watchedFlag.v1", '["legacy-stremio"]');
  const persistCritical = (key, value) => h.data.set(key, value);
  const deps = {
    "./active-profile-id": h.profiles,
    react: {},
    "./storage-recovery": { persistCritical },
  };
  const movies = h.load("movie-watched", deps);
  const flags = h.load("watched-flag", { ...deps, "./movie-watched": movies });
  const manual = h.load("manual-watched", {
    "./active-profile-id": h.profiles,
    "@/lib/storage-recovery": { persistCritical },
    "@/lib/render-cause": { noteNotify() {} },
  });
  const activate = (id, slot = 1) => {
    h.data.set(
      "harbor.nuvio.state.v1",
      JSON.stringify({ session: id ? { user: { id } } : null, activeProfileIndex: slot }),
    );
    h.events.dispatchEvent(new Event("harbor:nuvio-state-changed"));
  };
  let notifications = 0;
  movies.subscribeMovieWatched(() => notifications++);
  activate("account-A");
  assert.equal(flags.isWatchedFlagged("legacy"), false);
  assert.equal(flags.isWatchedFlagged("legacy-stremio"), false);
  flags.setWatchedFlag("movie-A", true);
  movies.setMovieWatchedLocal("movie-A", true);
  manual.setManualWatched("show", 1, 1, true);
  manual.setManualWatched("show", 1, 2, false);
  manual.recordManualWatchedMeta("show", { type: "series", name: "A's show" });
  manual.dismissManualWatched("dismissed-A");
  const beforeSwitch = notifications;
  activate("account-B");
  assert.ok(notifications > beforeSwitch, "same-slot account changes notify subscribed views");
  assert.equal(flags.isWatchedFlagged("movie-A"), false);
  assert.equal(movies.isMovieWatchedLocal("movie-A"), false);
  assert.equal(manual.manualWatchedState("show", 1, 1), undefined);
  assert.equal(manual.manualWatchedState("show", 1, 2), undefined);
  assert.equal(manual.unwatchedAt("show", 1, 2), undefined);
  assert.equal(manual.isManualWatchedDismissed("dismissed-A"), false);
  assert.equal(manual.manualWatchedLibraryItems().length, 0);
  flags.setWatchedFlag("movie-B", true);
  activate("account-A", 2);
  assert.equal(flags.isWatchedFlagged("movie-A"), false);
  activate("account-A");
  assert.equal(flags.isWatchedFlagged("movie-A"), true);
  assert.equal(flags.isWatchedFlagged("movie-B"), false);
  assert.equal(movies.isMovieWatchedLocal("movie-A"), true);
  assert.equal(manual.manualWatchedState("show", 1, 1), true);
  assert.equal(manual.manualWatchedState("show", 1, 2), false);
  assert.equal(manual.manualWatchedLibraryItems()[0].name, "A's show");
  activate(null);
  const before = h.data.size;
  flags.setWatchedFlag("unowned", true);
  movies.setMovieWatchedLocal("unowned", true);
  manual.setManualWatched("unowned", 1, 1, true);
  assert.equal(flags.isWatchedFlagged("movie-A"), false);
  assert.equal(h.data.size, before);
  assert.equal(h.data.has("harbor.watchedFlag.nuvio.v1.1"), true);
});
