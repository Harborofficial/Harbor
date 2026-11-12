import test from "node:test";
import assert from "node:assert/strict";
import { addonBaseUrl, addonResourceUrl } from "../src/lib/addon-url.ts";

for (const resource of [
  "stream/movie/tt123.json",
  "meta/series/tt123.json",
  "catalog/movie/top/search=rain%20%26%20snow&skip=100.json",
  "subtitles/series/tt123:1:2/videoHash=abc.json",
]) {
  test(`query-bearing transport routes ${resource} through pathname`, () => {
    const manifest =
      "https://addon.example/myapi/manifest.json?v=version&c=1&token=a%2Fb+z&token=second#ignored";
    const result = new URL(addonResourceUrl(manifest, resource));
    assert.equal(result.pathname, `/myapi/${resource}`);
    assert.equal(result.search, "?v=version&c=1&token=a%2Fb+z&token=second");
    assert.equal(result.hash, "");
    assert.equal(addonResourceUrl(addonBaseUrl(manifest), resource), result.href);
  });
}

test("plain, root, trailing slash and encoded configuration paths remain valid", () => {
  for (const [input, base] of [
    ["https://addon.example/manifest.json", "https://addon.example"],
    ["http://localhost:1234/config/manifest.json", "http://localhost:1234/config"],
    ["https://addon.example/a%2Fb/MANIFEST.JSON/?key=1", "https://addon.example/a%2Fb?key=1"],
    ["https://addon.example/config/", "https://addon.example/config"],
  ]) {
    assert.equal(addonBaseUrl(input), base);
    assert.equal(
      new URL(addonResourceUrl(input, "stream/movie/tt1.json")).pathname,
      `${new URL(base).pathname.replace(/\/$/, "")}/stream/movie/tt1.json`,
    );
  }
});

test("real stream, metadata and catalog callers preserve the manifest query", async () => {
  const { fetchAddonStreams } = await import("../src/lib/streams/addons.ts");
  const { fetchAddonMeta, fetchAddonCatalogPage } = await import("../src/lib/addons.ts");
  const transportUrl = "https://addon.example/myapi/manifest.json?v=version&c=1";
  const requests: URL[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requests.push(
      new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url),
    );
    return new Response(
      JSON.stringify({ streams: [], metas: [], meta: { id: "tt1", name: "Fixture" } }),
    );
  };
  try {
    await fetchAddonStreams(
      [
        {
          transportUrl,
          manifest: { id: "fixture", name: "Fixture", resources: ["stream"], types: ["movie"] },
        },
      ],
      { type: "movie", ids: ["tt1"] },
      new AbortController().signal,
    );
    await fetchAddonMeta(addonBaseUrl(transportUrl), "movie", "tt1");
    await fetchAddonCatalogPage(addonBaseUrl(transportUrl), "movie", "top", 100);
    assert.deepEqual(
      requests.map((u) => u.pathname),
      [
        "/myapi/stream/movie/tt1.json",
        "/myapi/meta/movie/tt1.json",
        "/myapi/catalog/movie/top/skip=100.json",
      ],
    );
    for (const url of requests) assert.equal(url.search, "?v=version&c=1");
  } finally {
    globalThis.fetch = original;
  }
});

test("saved addon origins match both legacy manifest keys and query-aware base keys", async () => {
  const { addonBasesForOrigin } = await import("../src/lib/addons.ts");
  const { addonConfigurationKey } = await import("../src/lib/addon-configuration-key.ts");
  const transportUrl = "https://addon.example/config/manifest.json?key=fixture";
  const addon = { transportUrl, manifest: { id: "fixture", name: "Fixture" } };
  for (const url of [transportUrl, addonBaseUrl(transportUrl)]) {
    assert.deepEqual(
      addonBasesForOrigin([addon], {
        id: "catalog-id",
        configurationKey: addonConfigurationKey(url),
      }),
      [addonBaseUrl(transportUrl)],
    );
  }
});
