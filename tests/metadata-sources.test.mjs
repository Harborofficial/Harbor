import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const module = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(new URL("../src/lib/metadata-sources.ts", import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText,
  {
    module,
    exports: module.exports,
    require(name) {
      assert.equal(name, "./metadata-addons");
      return { metadataAddonKey: (addon) => addon.manifest.id };
    },
  },
);
const sources = module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

const addons = [
  { manifest: { id: "aiometadata", name: "AIOMetadata" }, transportUrl: "https://a.test" },
  { manifest: { id: "other", name: "Other" }, transportUrl: "https://b.test" },
];
const settings = {
  tmdbKey: "tmdb",
  tvdbKey: "tvdb",
  fanartKey: "fanart",
  omdbKey: "",
  mdblistKey: "",
  rpdbKey: "",
  posterBaseUrl: "",
};

test("source chains start with addon order and only include configured providers", () => {
  assert.deepEqual(plain(sources.defaultMetadataSourceChain("title", addons, settings)), [
    "addon:aiometadata",
    "addon:other",
    "tmdb",
  ]);
  assert.deepEqual(plain(sources.defaultMetadataSourceChain("seasonSynopsis", addons, settings)), [
    "addon:aiometadata",
    "addon:other",
    "tmdb",
    "tvdb",
  ]);
  assert.deepEqual(plain(sources.defaultMetadataSourceChain("poster", addons, settings)), [
    "addon:aiometadata",
    "addon:other",
    "fanart",
    "tmdb",
  ]);
  assert.deepEqual(plain(sources.defaultMetadataSourceChain("seasonPoster", addons, settings)), [
    "addon:aiometadata",
    "addon:other",
    "fanart",
    "tmdb",
  ]);
});

test("saved order survives while removed sources are dropped and new defaults appended", () => {
  assert.deepEqual(
    plain(
      sources.normalizeMetadataSourceChain(
        "title",
        ["tmdb", "addon:removed", "addon:other"],
        addons,
        settings,
      ),
    ),
    ["tmdb", "addon:other", "addon:aiometadata"],
  );
});

test("search and episode reorders keep the moved provider position", () => {
  assert.deepEqual(
    plain(
      sources.normalizeMetadataSourceChain("search", ["tmdb", "addon:other"], addons, settings),
    ),
    ["tmdb", "addon:other", "addon:aiometadata"],
  );
  assert.deepEqual(
    plain(
      sources.normalizeMetadataSourceChain(
        "episodes",
        ["tmdb", "addon:aiometadata"],
        addons,
        settings,
      ),
    ),
    ["tmdb", "addon:aiometadata", "addon:other", "tvdb"],
  );
});

test("labels resolve addons and configured providers", () => {
  assert.equal(sources.metadataSourceName("addon:aiometadata", addons, settings), "AIOMetadata");
  assert.equal(sources.metadataSourceName("tmdb", addons, settings), "TMDB");
  assert.equal(sources.metadataSourceKind("addon:other", addons, settings), "Addon");
  assert.equal(sources.metadataSourceKind("posterService", addons, settings), null);
});

test("the first available poster transform owns the artwork", () => {
  const both = { rpdbKey: "rpdb-key", posterBaseUrl: "https://posters.invalid/{imdb}" };
  assert.deepEqual(plain(sources.firstPosterTransform(["rpdb", "posterService"], both)), {
    id: "rpdb",
    index: 0,
  });
  assert.deepEqual(plain(sources.firstPosterTransform(["posterService", "rpdb"], both)), {
    id: "posterService",
    index: 0,
  });
  assert.deepEqual(
    plain(
      sources.firstPosterTransform(["rpdb", "posterService"], {
        rpdbKey: "",
        posterBaseUrl: both.posterBaseUrl,
      }),
    ),
    { id: "posterService", index: 1 },
  );
});

test("poster transforms only apply when they come before the supplied poster", () => {
  const build = (poster) => ({
    addonOnlyMetadata: true,
    metadataSources: { poster },
  });
  assert.equal(
    sources.posterTransformEnabled(build(["addon:a", "fanart", "posterService"])),
    false,
  );
  assert.equal(sources.posterTransformEnabled(build(["posterService", "fanart"])), true);
  assert.equal(sources.posterTransformEnabled(build(["fanart"])), false);
  assert.equal(
    sources.posterTransformEnabled({ addonOnlyMetadata: false, metadataSources: { poster: [] } }),
    true,
  );
});
