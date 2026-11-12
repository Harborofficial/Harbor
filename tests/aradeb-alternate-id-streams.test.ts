import { streamKey } from "../src/lib/streams/identity.ts";
import { addonBaseUrl, addonResourceUrl } from "../src/lib/addon-url.ts";
// @ts-expect-error Node-only test
import assert from "node:assert/strict";
// @ts-expect-error Node-only test
import test from "node:test";
// @ts-expect-error Node-only test
import { readFileSync } from "node:fs";
import ts from "typescript";

function harness(successfulScheme: "tmdb" | "imdb") {
  const calls: string[] = [];
  const code = ts.transpileModule(readFileSync("src/lib/streams/addons.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const api: Record<string, any> = {};
  const mocks: Record<string, any> = {
    "@/lib/addon-url": { addonBaseUrl, addonResourceUrl },
    "@/lib/safe-fetch": {
      safeFetch: async (url: string) => {
        calls.push(url);
        const found =
          successfulScheme === "tmdb"
            ? url.includes("tmdb:326565:1:1")
            : url.includes("tt48434821:1:1");
        return {
          ok: true,
          json: async () => ({
            streams: found
              ? [{ title: "Up and Down S01E01", url: "https://media.invalid/episode.m3u8" }]
              : [],
          }),
        };
      },
    },
    "./prefetch-request": {
      prefetchRequest: async (_key: string, _signal: AbortSignal, _prefetch: boolean, load: any) =>
        load(_signal),
      clearPrefetchedRequests: () => {},
    },
    "./identity": { streamKey },
    "@/lib/debug": { dlog() {}, dwarn() {} },
    "@/lib/fetch-fallback-policy": { isHarborFetchPolicyError: () => false },
    "@/lib/local-network": { isLocalNetworkUrl: () => false },
    "./addon-detect": {
      detectAddonFamily: () => "other",
      isAddonRanked: () => false,
      isRetiredTorboxAddon: () => false,
      isStatusOnlyAddon: () => false,
      isStremioLocalAddon: () => false,
    },
    "./cached": { hasUncachedMarker: () => false },
    "@/lib/torrent/magnet": { infoHashFromSources: () => null, infoHashFromUrl: () => null },
    "./plugins/addon": {
      isPluginAddon: () => false,
      PLUGIN_ADDON_PREFIX: "plugin://",
      pluginIdFromCatalogueBase: () => null,
      runPluginAddon: () => [],
    },
  };
  new Function("require", "exports", code)((key: string) => {
    assert.ok(key in mocks, `Unexpected import: ${key}`);
    return mocks[key];
  }, api);
  const addon = {
    transportUrl: "https://aradeb.invalid/manifest.json",
    manifest: {
      id: "aradeb",
      name: "Aradeb",
      types: ["series"],
      resources: [{ name: "stream", types: ["series"], idPrefixes: ["tt", "tmdb:"] }],
    },
  };
  const ids = ["tmdb:326565:1:1", "tmdb:tv:326565:1:1", "tt48434821:1:1"];
  return { api, calls, addon, ids };
}

test("Aradeb retries TMDB only when the preferred IMDb episode ID is empty", async () => {
  const h = harness("tmdb");
  const results = await h.api.fetchAddonStreams(
    [h.addon],
    { type: "series", ids: h.ids },
    new AbortController().signal,
  );
  assert.equal(results.length, 1);
  assert.ok(h.calls[0].includes("/stream/series/tt48434821:1:1.json"));
  assert.ok(h.calls.some((c) => c.includes("/stream/series/tmdb:326565:1:1.json")));
  assert.equal(h.calls.length, 2);
});

test("Aradeb does not retry TMDB when the preferred IMDb episode ID works", async () => {
  const h = harness("imdb");
  const results = await h.api.fetchAddonStreams(
    [h.addon],
    { type: "series", ids: h.ids },
    new AbortController().signal,
  );
  assert.equal(results.length, 1);
  assert.equal(h.calls.length, 1);
});

test("an addon forced by a catalog retains the specified episode ID", async () => {
  const h = harness("tmdb");
  const results = await h.api.fetchAddonStreams(
    [h.addon],
    { type: "series", ids: h.ids },
    new AbortController().signal,
    undefined,
    undefined,
    undefined,
    undefined,
    [{ base: "https://aradeb.invalid", id: "tmdb:326565:1:1" }],
  );
  assert.equal(results.length, 1);
  assert.equal(h.calls.length, 1);
  assert.ok(h.calls[0].includes("/stream/series/tmdb:326565:1:1.json"));
});
