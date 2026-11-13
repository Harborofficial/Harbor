import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture({ quality = "fast", installed = true, cached = false, local = null } = {}) {
  const calls = [];
  const releases = [];
  const source = readFileSync(
    new URL("../src/lib/manga/upscale/chapter.ts", import.meta.url),
    "utf8",
  );
  const dependencies = {
    "../api": {
      chapterPages: async (id) => {
        calls.push(["pages", id]);
        return ["mono", "color"];
      },
    },
    "../plugins/adapter": { pageHeadersFor: () => ({ Referer: "reader" }) },
    "../../manga-downloads": { downloadedPages: async () => local },
    "@/views/manga/manga-reader/manga-upscale": {
      readBlob: async (url, headers) => {
        calls.push(["read", url, headers]);
        return url;
      },
      isColorPage: async (blob) => blob === "color",
    },
    "./index": {
      cachedMangaPage: async () => cached,
      mangaUpscaleStatus: async () => ({ installed }),
      downloadMangaModel: async () => {
        installed = true;
        calls.push(["download"]);
      },
      retainMangaUpscaler: () => () => releases.push("fast"),
      upscaleMangaPage: async (key) => calls.push(["fast", key]),
    },
    "./best": {
      cachedBestPage: async () => cached,
      bestModelInstalled: async () => installed,
      downloadBestModel: async () => {
        installed = true;
        calls.push(["download-best"]);
      },
      retainBestUpscaler: () => () => releases.push("best"),
      upscaleBestPage: async (key) => calls.push(["best", key]),
    },
    "./model": { nearestBestHeight: () => 1600 },
    "./eligibility": { MAX_GPU_PAGE_PIXELS: 9_000_000 },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
      createImageBitmap: async () => ({ width: 800, height: 1200, close() {} }),
    },
  );
  return {
    calls,
    releases,
    run: (options) =>
      exports.preUpscaleChapter("manga", "chapter", {
        quality,
        autoDownload: false,
        sourceId: "owner",
        ...options,
      }),
  };
}

test("pre-upscale uses the owning source and reader cache keys, and coalesces duplicate requests", async () => {
  const f = fixture();
  const first = f.run();
  assert.equal(f.run(), first);
  await first;
  assert.deepEqual(
    f.calls.filter((call) => call[0] === "pages"),
    [["pages", "owner::chapter"]],
  );
  assert.deepEqual(
    f.calls.filter((call) => call[0] === "fast"),
    [
      ["fast", "manga:chapter:0"],
      ["fast", "manga:chapter:1"],
    ],
  );
  assert.deepEqual(f.releases, ["fast", "best"]);
});

test("best quality uses the fast model for color pages", async () => {
  const f = fixture({ quality: "best" });
  await f.run();
  assert.deepEqual(
    f.calls.filter((call) => ["fast", "best"].includes(call[0])),
    [
      ["best", "manga:chapter:0"],
      ["fast", "manga:chapter:1"],
    ],
  );
});

test("cached downloaded chapters need neither page requests nor model work", async () => {
  const f = fixture({ cached: true, local: ["local-page"] });
  await f.run();
  assert.deepEqual(f.calls, []);
});

test("missing models report failure, release workers and permit retry with auto-download", async () => {
  const f = fixture({ installed: false });
  await assert.rejects(f.run(), /Install the manga upscale model/);
  assert.deepEqual(f.releases, ["fast", "best"]);
  await f.run({ autoDownload: true });
  assert.equal(f.calls.filter((call) => call[0] === "download").length, 1);
  assert.equal(f.calls.filter((call) => call[0] === "fast").length, 2);
});
