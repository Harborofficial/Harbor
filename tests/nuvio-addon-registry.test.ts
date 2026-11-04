import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAddonUrl,
  recordAddonOrigins,
  recordNuvioAddons,
  recordStremioAddons,
  resolveAddonOrigin,
} from "../src/lib/nuvio/nuvio-addon-registry.ts";
import {
  readCachedNuvioAddons,
  writeCachedNuvioAddons,
  clearCachedNuvioAddons,
} from "../src/lib/nuvio/nuvio-sync.ts";

test("normalizeAddonUrl standardizes protocol, host and manifest.json suffixes", () => {
  assert.equal(
    normalizeAddonUrl("https://torrentio.strem.fun/manifest.json"),
    "https://torrentio.strem.fun",
  );
  assert.equal(
    normalizeAddonUrl("https://torrentio.strem.fun/sort=quality/manifest.json"),
    "https://torrentio.strem.fun/sort=quality",
  );
  assert.equal(normalizeAddonUrl("https://cyberflix.me/"), "https://cyberflix.me");
});

test("recordAddonOrigins marks stremio, nuvio, and both correctly", () => {
  const stremio = [
    "https://torrentio.strem.fun/manifest.json",
    "https://opensubtitles.org/manifest.json",
  ];
  const nuvio = ["https://cyberflix.me/manifest.json", "https://opensubtitles.org/manifest.json"];

  recordAddonOrigins(
    stremio,
    nuvio,
    ["com.stremio.torrentio", "org.opensubtitles"],
    ["com.cyberflix", "org.opensubtitles"],
  );

  assert.equal(resolveAddonOrigin("https://torrentio.strem.fun/manifest.json"), "stremio");
  assert.equal(resolveAddonOrigin("com.stremio.torrentio"), "stremio");

  assert.equal(resolveAddonOrigin("https://cyberflix.me/manifest.json"), "nuvio");
  assert.equal(resolveAddonOrigin("com.cyberflix"), "nuvio");

  assert.equal(resolveAddonOrigin("https://opensubtitles.org/manifest.json"), "both");
  assert.equal(resolveAddonOrigin("org.opensubtitles"), "both");

  assert.equal(resolveAddonOrigin("https://unknown.addon/manifest.json"), "custom");
  assert.equal(resolveAddonOrigin(null), "custom");
});

test("recordStremioAddons and recordNuvioAddons incrementally update and merge registry", () => {
  recordStremioAddons([
    { transportUrl: "https://addon-a.strem.fun/manifest.json", manifest: { id: "addon.a" } },
    {
      transportUrl: "https://addon-shared.strem.fun/manifest.json",
      manifest: { id: "addon.shared" },
    },
  ]);

  recordNuvioAddons([
    { transportUrl: "https://addon-b.nuvio.app/manifest.json", manifest: { id: "addon.b" } },
    {
      transportUrl: "https://addon-shared.strem.fun/manifest.json",
      manifest: { id: "addon.shared" },
    },
  ]);

  assert.equal(resolveAddonOrigin("addon.a"), "stremio");
  assert.equal(resolveAddonOrigin("https://addon-a.strem.fun/manifest.json"), "stremio");

  assert.equal(resolveAddonOrigin("addon.b"), "nuvio");
  assert.equal(resolveAddonOrigin("https://addon-b.nuvio.app/manifest.json"), "nuvio");

  assert.equal(resolveAddonOrigin("addon.shared"), "both");
  assert.equal(resolveAddonOrigin("https://addon-shared.strem.fun/manifest.json"), "both");
});

test("Nuvio addons cache isolates profile slots and roundtrips items", () => {
  const p1Addons = [
    { url: "https://p1.addon/manifest.json", name: "P1 Addon", enabled: true, sort_order: 1 },
  ];
  const p2Addons = [
    { url: "https://p2.addon/manifest.json", name: "P2 Addon", enabled: true, sort_order: 1 },
  ];

  writeCachedNuvioAddons(1, p1Addons, "acc-test");
  writeCachedNuvioAddons(2, p2Addons, "acc-test");

  assert.deepEqual(readCachedNuvioAddons(1, "acc-test"), p1Addons);
  assert.deepEqual(readCachedNuvioAddons(2, "acc-test"), p2Addons);

  clearCachedNuvioAddons();
  assert.deepEqual(readCachedNuvioAddons(1, "acc-test"), []);
  assert.deepEqual(readCachedNuvioAddons(2, "acc-test"), []);
});
