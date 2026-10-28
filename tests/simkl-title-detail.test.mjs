import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { lruGet, lruSet } from "../src/lib/cache.ts";

test("public SIMKL details share in-flight reads and cached data while failures remain retryable", async () => {
  let calls = 0;
  let reject = false;
  const data = { poster: "fixture", relations: [] };
  const mocks = {
    "@/lib/yield-to-browser": { yieldToBrowser: () => Promise.resolve() },
    "@/lib/cache": { lruGet, lruSet },
    "./client": {
      simklRequest: async (_path, opts) => {
        calls++;
        assert.equal(opts.authed, false);
        if (reject) throw new Error("offline");
        return data;
      },
    },
  };
  const code = ts.transpileModule(
    readFileSync(new URL("../src/lib/simkl/title-detail.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => mocks[name], exports);
  const read = exports.simklTitleDetail;
  const first = read(123);
  assert.equal(read("123"), first);
  assert.equal(await first, data);
  assert.equal(await read(123), data);
  assert.equal(calls, 1);
  await read(123, "movie");
  assert.equal(calls, 2, "movie and anime IDs are separate namespaces");
  reject = true;
  await assert.rejects(read(456));
  reject = false;
  assert.equal(await read(456), data);
  assert.equal(calls, 4);
});
