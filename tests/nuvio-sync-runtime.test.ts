import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadRuntime() {
  const requests: boolean[] = [];
  const intervals = new Map<number, () => void>();
  const windowListeners = new Map<string, () => void>();
  const documentListeners = new Map<string, () => void>();
  const effects: Array<{ fn: () => (() => void) | undefined; deps?: unknown[] }> = [];
  let nextTimer = 1;

  const windowStub = {
    setInterval: (callback: () => void) => {
      const id = nextTimer++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id: number) => {
      intervals.delete(id);
    },
    addEventListener: (name: string, callback: () => void) => {
      windowListeners.set(name, callback);
    },
    removeEventListener: (name: string, callback: () => void) => {
      if (windowListeners.get(name) === callback) windowListeners.delete(name);
    },
  };
  const documentStub = {
    visibilityState: "visible",
    addEventListener: (name: string, callback: () => void) => {
      documentListeners.set(name, callback);
    },
    removeEventListener: (name: string, callback: () => void) => {
      if (documentListeners.get(name) === callback) documentListeners.delete(name);
    },
  };
  const coordinator = {
    request: (force = false) => {
      requests.push(force);
      return Promise.resolve();
    },
    isRunning: () => false,
  };
  const require = (name: string) => {
    switch (name) {
      case "react":
        return {
          useEffect: (fn: () => (() => void) | undefined, deps?: unknown[]) => {
            effects.push({ fn, deps });
          },
        };
      case "@/lib/active-profile-id":
        return { isNuvioProviderActive: () => true };
      case "@/lib/feed/external-cw":
        return { refreshExternalCw: async () => {} };
      case "./nuvio-client":
        return { isNuvioSignedIn: () => true };
      case "./nuvio-sync":
        return { reconcileNuvioWatched: async () => {} };
      case "./nuvio-sync-coordinator":
        return { createNuvioSyncCoordinator: () => coordinator };
      default:
        throw new Error(`unexpected import ${name}`);
    }
  };

  const source = readFileSync("src/lib/nuvio/nuvio-sync-runtime.ts", "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", "window", "document", code)(
    require,
    module,
    module.exports,
    windowStub,
    documentStub,
  );

  return {
    hook: module.exports.useNuvioSyncLoop as (enabled?: boolean) => void,
    request: module.exports.requestNuvioSync as (force?: boolean) => Promise<void>,
    requests,
    intervals,
    windowListeners,
    documentListeners,
    effects,
  };
}

test("the loop starts only when enabled and uses the requested cadence", async () => {
  const runtime = loadRuntime();

  runtime.hook(false);
  const disabled = runtime.effects.at(-1)!;
  assert.deepEqual(disabled.deps, [false]);
  assert.equal(disabled.fn(), undefined);
  assert.deepEqual(runtime.requests, []);
  assert.equal(runtime.intervals.size, 0);
  assert.equal(runtime.windowListeners.size, 0);

  runtime.hook(true);
  const enabled = runtime.effects.at(-1)!;
  assert.deepEqual(enabled.deps, [true]);
  const cleanup = enabled.fn();
  assert.deepEqual(runtime.requests, [true]);
  assert.equal(runtime.intervals.size, 1);

  runtime.intervals.values().next().value?.();
  assert.deepEqual(runtime.requests, [true, false]);

  runtime.windowListeners.get("focus")?.();
  assert.deepEqual(runtime.requests, [true, false, true]);

  runtime.documentListeners.get("visibilitychange")?.();
  assert.deepEqual(runtime.requests, [true, false, true, true]);

  cleanup?.();
  assert.equal(runtime.intervals.size, 0);
  assert.equal(runtime.windowListeners.size, 0);
  assert.equal(runtime.documentListeners.size, 0);
});

test("requestNuvioSync delegates to the shared coordinator", async () => {
  const runtime = loadRuntime();
  await runtime.request(true);
  await runtime.request();
  assert.deepEqual(runtime.requests, [true, false]);
});

test("NuvioSyncLoopRunner pauses while a player is mounted", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  assert.match(
    app,
    /function NuvioSyncLoopRunner\(\) \{[\s\S]*?const \{ player \} = useView\(\);[\s\S]*?useNuvioSyncLoop\(!player\);/,
  );
});
