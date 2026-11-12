import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function setup(status) {
  const calls = { plugin: 0, harbor: 0 };
  const mocks = {
    "@tauri-apps/api/core": { isTauri: () => true, convertFileSrc: (path) => path },
    "./context-image-policy": requirePolicy(),
    "./safe-fetch": {
      safeFetchBytes: async (_url, _options, timeout, maxBytes) => {
        calls.harbor++;
        assert.equal(timeout, 20000);
        assert.equal(maxBytes, 32 * 1024 * 1024);
        return new Response(png, { headers: { "content-type": "image/png" } });
      },
    },
    "@tauri-apps/plugin-http": {
      fetch: async () => {
        calls.plugin++;
        return status === 200
          ? new Response(png, { headers: { "content-type": "image/png" } })
          : new Response("bad request", { status });
      },
    },
  };
  const code = ts.transpileModule(
    readFileSync(new URL("../src/lib/context-image.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => {
    assert.ok(name in mocks, "unexpected module " + name);
    return mocks[name];
  }, exports);
  return { loadContextImage: exports.loadContextImage, calls };
}
function requirePolicy() {
  // This only validates the network fallback; the existing policy tests
  // separately verify image format signatures and streaming byte limits.
  return {
    MAX_CONTEXT_IMAGE_BYTES: 32 * 1024 * 1024,
    readImageResponse: async (response) => {
      if (!response.ok) throw Error("status " + response.status);
      return { bytes: new Uint8Array(await response.arrayBuffer()) };
    },
  };
}

test("View image recovers from plugin-http 400 through Harbor's bounded image fetch", async () => {
  const fixture = setup(400);
  const result = await fixture.loadContextImage({ src: "https://cdn.atsu.moe/cover.jpg" });
  assert.deepEqual(result.bytes, png);
  assert.deepEqual(fixture.calls, { plugin: 1, harbor: 1 });
});
test("View image does not make redundant requests when plugin-http succeeds", async () => {
  const fixture = setup(200);
  await fixture.loadContextImage({ src: "https://cdn.atsu.moe/cover.jpg" });
  assert.deepEqual(fixture.calls, { plugin: 1, harbor: 0 });
});
test("View image preserves access restrictions on HTTP 403", async () => {
  const fixture = setup(403);
  await assert.rejects(fixture.loadContextImage({ src: "https://cdn.atsu.moe/cover.jpg" }), /403/);
  assert.deepEqual(fixture.calls, { plugin: 1, harbor: 0 });
});
