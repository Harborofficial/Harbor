import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function launch(storage, files, readTextFile = async (path) => files.get(path)) {
  const modules = new Map();
  const timers = new Map();
  let timerId = 0;
  const load = (name) => {
    if (modules.has(name)) return modules.get(name);
    const compiled = ts.transpileModule(
      readFileSync(new URL(`../src/lib/music/${name}.ts`, import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const module = { exports: {} };
    const require = (id) => {
      if (id === "react") return {};
      if (id === "./local-store") return load("local-store");
      if (id === "@tauri-apps/plugin-fs")
        return {
          BaseDirectory: { AppData: 1 },
          exists: async (path) => path === "music-store" || files.has(path),
          mkdir: async () => {},
          readTextFile,
          writeTextFile: async (path, value) => {
            files.set(path, value);
          },
        };
      throw new Error(`Unexpected import ${id}`);
    };
    new Function(
      "require",
      "module",
      "exports",
      "window",
      "localStorage",
      "setTimeout",
      "clearTimeout",
      compiled,
    )(
      require,
      module,
      module.exports,
      { __TAURI_INTERNALS__: {} },
      {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
      (fn) => {
        timers.set(++timerId, fn);
        return timerId;
      },
      (id) => timers.delete(id),
    );
    modules.set(name, module.exports);
    return module.exports;
  };
  return { consent: load("source-consent"), store: load("local-store") };
}

const path = "music-store/source-consent.json";
const saved = JSON.stringify({
  version: 1,
  acceptedAt: "2026-11-07T00:00:00.000Z",
  sources: { youtube: true, spotify: false, soundcloud: false },
});

test("acceptance and revocation survive restart before the delayed file write", async () => {
  const storage = new Map();
  const files = new Map();
  const first = launch(storage, files);
  first.consent.acceptMusicSources(["youtube"]);
  assert.equal(files.size, 0);
  const second = launch(storage, files);
  await second.consent.hydrateMusicSourceConsent();
  assert.equal(second.consent.musicSourceAllowed("youtube"), true);
  assert.equal(second.consent.musicSourceAllowed("spotify"), false);
  await second.store.flushLocalJson();
  second.consent.withdrawMusicSourceConsent();
  const third = launch(storage, files);
  await third.consent.hydrateMusicSourceConsent();
  assert.equal(third.consent.musicSourceAllowed("youtube"), false);
});

test("native acceptance restores and notifies subscribers without a browser copy", async () => {
  const app = launch(new Map(), new Map([[path, saved]]));
  let notifications = 0;
  app.consent.subscribeMusicSourceConsent(() => notifications++);
  await app.consent.hydrateMusicSourceConsent();
  assert.equal(app.consent.musicSourceAllowed("youtube"), true);
  assert.equal(notifications, 1);
});

test("late native reads cannot overwrite a new source selection", async () => {
  let release;
  const app = launch(
    new Map(),
    new Map([[path, saved]]),
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const hydration = app.consent.hydrateMusicSourceConsent();
  await Promise.resolve();
  app.consent.acceptMusicSources(["spotify"]);
  release(saved);
  await hydration;
  assert.equal(app.consent.musicSourceAllowed("youtube"), false);
  assert.equal(app.consent.musicSourceAllowed("spotify"), true);
});

test("legacy browser consent does not override a newer native revocation", async () => {
  const app = launch(
    new Map([["harbor.music.source-consent.v1", saved]]),
    new Map([[path, JSON.stringify({ version: 1, acceptedAt: null, sources: {} })]]),
  );
  await app.consent.hydrateMusicSourceConsent();
  assert.equal(app.consent.musicSourceAllowed("youtube"), false);
});
