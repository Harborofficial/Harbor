import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("duplicate cards share an in-flight title rating and cache the result", async () => {
  const source = readFileSync(
    new URL("../src/lib/providers/harbor-imdb.ts", import.meta.url),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  let requests = 0;
  let finish;
  const response = new Promise((resolve) => {
    finish = resolve;
  });
  new Function("require", "exports", "fetch", code)(
    (name) => (name === "@/lib/maintenance" ? { registerEvictable: () => {} } : {}),
    exports,
    () => {
      requests++;
      return response;
    },
  );
  const cards = Array.from({ length: 20 }, () => exports.harborImdbTitle("tt123"));
  assert.equal(requests, 1);
  finish({ ok: true, json: async () => ({ rating: 8.2 }) });
  assert.deepEqual(await Promise.all(cards), Array(20).fill(8.2));
  assert.equal(await exports.harborImdbTitle("tt123"), 8.2);
  assert.equal(requests, 1);
});
