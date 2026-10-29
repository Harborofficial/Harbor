// @ts-expect-error Node-only tests
import assert from "node:assert/strict";
// @ts-expect-error Node-only tests
import test from "node:test";
// @ts-expect-error Node-only tests
import { readFileSync } from "node:fs";
import ts from "typescript";

function resolver() {
  const calls: string[] = [];
  const catalog = [
    {
      transportUrl: "https://first.test/manifest.json",
      manifest: {
        id: "first",
        name: "First",
        types: ["series"],
        resources: [{ name: "meta", types: ["series"], idPrefixes: ["tmdb:"] }],
      },
    },
    {
      transportUrl: "https://second.test/manifest.json",
      manifest: {
        id: "second",
        name: "Second",
        types: ["series"],
        resources: [{ name: "meta", types: ["series"], idPrefixes: ["tmdb:"] }],
      },
    },
  ];
  const responses: Record<string, unknown> = {
    "https://first.test/meta/series/tmdb:326565.json": {
      meta: { id: "tmdb:326565", type: "series", name: "Preferred title", poster: "/first.png" },
    },
    "https://second.test/meta/series/tmdb:tv:326565.json": {
      meta: {
        id: "tmdb:tv:326565",
        type: "series",
        name: "Second title",
        videos: [{ season: 1, episode: 1, title: "Episode 1" }],
      },
    },
  };
  const metadataExports: Record<string, any> = {};
  const metadataCode = ts.transpileModule(readFileSync("src/lib/metadata-addons.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("require", "exports", metadataCode)((name: string) => {
    if (name === "./addon-configuration-key") return { addonConfigurationKey: () => undefined };
    if (name === "./addons-store/reorder")
      return { applyOrderToItems: (items: unknown[]) => items, loadDisplayOrder: () => [] };
    throw new Error(`Unexpected dependency: ${name}`);
  }, metadataExports);
  const mocks: Record<string, any> = {
    "./metadata-addons": metadataExports,
    "./cinemeta": {
      cinemetaEnabled: () => true,
      meta: async (_type: string, id: string) => {
        calls.push("cinemeta:" + id);
        return null;
      },
    },
    "./safe-fetch": {
      safeFetch: async (url: string) => {
        calls.push(url);
        return { ok: true, json: async () => responses[url] ?? {} };
      },
    },
    "./addons": {
      addonAccepts: (a: any, resource: string, type: string, id: string) =>
        a.manifest.resources.some(
          (r: any) =>
            r.name === resource &&
            r.types.includes(type) &&
            r.idPrefixes.some((p: string) => id.startsWith(p)),
        ),
      userAddons: async () => [],
      gatherCatalogAddons: async () => catalog,
    },
    "./addon-store": { loadInstalled: () => catalog, filterEnabled: (items: unknown[]) => items },
    "./auth": { readActiveStremioAuthKey: () => null },
    "./cache": {
      lruSet: (map: Map<string, unknown>, key: string, value: unknown) => map.set(key, value),
    },
  };
  const code = ts.transpileModule(readFileSync("src/lib/meta-resource.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", "localStorage", code)(
    (key: string) => {
      if (key === "@/lib/metadata-policy" || key === "./metadata-policy")
        return { addonOnlyMetadata: () => false };
      assert.ok(key in mocks, "Unexpected import: " + key);
      return mocks[key];
    },
    exports,
    { getItem: () => null },
  );
  return { resolveMeta: exports.resolveMeta, calls, responses };
}

test("catalog metadata keeps first addon override and fills its missing episodes from the next addon", async () => {
  const h = resolver();
  const result = await h.resolveMeta(null, "series", "tmdb:326565", {
    preferAddons: true,
    requireVideos: true,
  });
  assert.equal(result?.name, "Preferred title");
  assert.equal(result?.poster, "/first.png");
  assert.equal(result?.videos?.length, 1);
  assert.ok(h.calls.some((url: string) => url.includes("tmdb:tv:326565")));
});

test("a bare TMDB catalog ID queries the compatible normalized form", async () => {
  const h = resolver();
  delete h.responses["https://first.test/meta/series/tmdb:326565.json"];
  const result = await h.resolveMeta(null, "series", "tmdb:326565", {
    preferAddons: true,
    requireVideos: true,
  });
  assert.equal(result?.videos?.[0]?.episode, 1);
});

test("no matching metadata is nonfatal", async () => {
  const h = resolver();
  for (const key of Object.keys(h.responses)) delete h.responses[key];
  assert.equal(
    await h.resolveMeta(null, "series", "tmdb:326565", { preferAddons: true, requireVideos: true }),
    null,
  );
});
