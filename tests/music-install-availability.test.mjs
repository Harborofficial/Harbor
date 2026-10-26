import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function store(invoke) {
  const source = readFileSync(new URL("../src/lib/features/install.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const subscriptions = [];
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (id) => {
      if (id === "@tauri-apps/api/core") return { invoke };
      if (id === "react")
        return {
          useSyncExternalStore(subscribe, snapshot) {
            subscriptions.push(subscribe);
            return snapshot();
          },
        };
      throw new Error(`Unexpected import: ${id}`);
    },
    module,
    module.exports,
  );
  return { api: module.exports, subscriptions };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("Music availability stays pending until the native installation is read", async () => {
  let finish;
  let reads = 0;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const { api, subscriptions } = store(() => {
    reads++;
    return pending;
  });
  assert.equal(api.useInstallFeaturesReady(), false);
  let notifications = 0;
  const unsubscribe = subscriptions[0](() => {
    notifications++;
  });
  api.getInstallFeatures();
  assert.equal(reads, 1);
  assert.equal(api.useInstallFeaturesReady(), false);
  finish({ music: false });
  await flush();
  assert.equal(api.useInstallFeaturesReady(), true);
  assert.equal(api.getInstallFeatures().music, false);
  assert.equal(api.getInstallFeatures().games, true);
  assert.equal(notifications, 1);
  unsubscribe();
});

test("web previews retain compatibility when native installation lookup is unavailable", async () => {
  const { api, subscriptions } = store(async () => {
    throw new Error("no native host");
  });
  assert.equal(api.useInstallFeaturesReady(), false);
  const unsubscribe = subscriptions[0](() => {});
  await flush();
  assert.equal(api.useInstallFeaturesReady(), true);
  assert.equal(api.useInstallFeatures().music, true);
  unsubscribe();
});
