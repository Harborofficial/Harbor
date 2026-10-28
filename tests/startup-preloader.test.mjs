import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("view warmup starts one import per idle turn, recovers from failure and cancels on unmount", async () => {
  const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const hook = source.slice(
    source.indexOf("function useViewPreloader("),
    source.indexOf("const KEEP_ALIVE_MS"),
  );
  const names = [...new Set(hook.match(/\bimport[A-Z]\w+/g))];
  const idle = new Map();
  const started = [];
  let handle = 0;
  let cleanup;
  const code = ts.transpileModule(hook, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("useRef", "useEffect", "window", ...names, `${code}\nuseViewPreloader("");`)(
    (value) => ({ current: value }),
    (effect) => {
      cleanup = effect();
    },
    {
      requestIdleCallback: (callback) => {
        idle.set(++handle, callback);
        return handle;
      },
      cancelIdleCallback: (id) => idle.delete(id),
    },
    ...names.map((name, i) => async () => {
      started.push(name);
      if (i === 0) throw new Error("fixture");
    }),
  );
  const turn = async () => {
    const [id, callback] = idle.entries().next().value;
    idle.delete(id);
    callback();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  assert.equal(started.length, 0);
  await turn();
  assert.equal(started.length, 1);
  await turn();
  assert.equal(started.length, 2, "failed optional warmup does not stop the queue");
  cleanup();
  assert.equal(idle.size, 0);
});
