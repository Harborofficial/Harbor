import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function bridge(invoke) {
  const source = readFileSync(
    new URL("../src/lib/streams/plugins/extension/bridge.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (name) => {
      assert.equal(name, "@tauri-apps/api/core");
      return { invoke };
    },
    module,
    module.exports,
  );
  return module.exports;
}

test("extension UI routes all operations through the generic native module host", async () => {
  const calls = [];
  const api = bridge(async (name, args) => {
    calls.push({ name, ...args });
    return {
      providers: [],
      results: [],
      rows: [],
      sections: [],
      note: null,
      success: true,
      links: [],
      subtitles: [],
    };
  });
  await api.warmBridge();
  await api.bridgeProviders();
  await api.bridgeSearch("provider", "query", true, 3);
  await api.bridgeLoad("provider", "https://example.test");
  await api.bridgeLoadLinks("provider", "opaque data");
  await api.bridgeCatalogue("provider");
  await api.bridgeCataloguePage("provider", "row", 2);
  assert.deepEqual(
    calls.map((c) => c.command),
    [
      "capstan_ping",
      "capstan_providers",
      "capstan_search",
      "capstan_load",
      "capstan_load_links",
      "capstan_catalogue",
      "capstan_catalogue_page",
    ],
  );
  assert.ok(calls.every((c) => c.name === "native_module_call" && c.module === "extensions"));
  assert.deepEqual(calls[2].args, { providerId: "provider", query: "query", quick: true, page: 3 });
  assert.deepEqual(calls[4].args, { providerId: "provider", data: "opaque data" });
  assert.deepEqual(calls[6].args, { providerId: "provider", row: "row", page: 2 });
});

test("module errors propagate to the extension caller", async () => {
  const api = bridge(async () => {
    throw new Error("Native module is unavailable");
  });
  await assert.rejects(api.bridgeLoad("provider", "url"), /Native module is unavailable/);
});
