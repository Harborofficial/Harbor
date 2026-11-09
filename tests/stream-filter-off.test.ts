import { streamKey } from "../src/lib/streams/identity.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { parseStream } from "../src/lib/streams/parser.ts";
import { applyTrust } from "../src/lib/streams/trust.ts";
import { partitionByExactAnimeEpisode } from "../src/lib/streams/anime-identity-core.ts";
import { applyStreamPriority } from "../src/lib/streams/priority-partition.ts";
import * as scoring from "../src/lib/streams/scoring.ts";
import type { PipelineInput, PipelineResult } from "../src/lib/streams/pipeline.ts";
import type { Stream } from "../src/lib/streams/types.ts";

const streams: Stream[] = [19, 69, 70].map((ep, index) => ({
  addonId: "fixture-addon",
  addonName: "Fixture addon",
  addonReturnIdx: index,
  title: `Fixture.Anime.S04E${ep}.1080p.WEB-DL.AAC.mkv`,
  url: `https://fixture.invalid/episode-${ep}.mkv`,
  behaviorHints: { videoSize: 1024 ** 3 },
}));

function fixture(native = false, supplied = streams) {
  const partials: PipelineResult[] = [];
  const coreCalls: any[] = [];
  const mocks: Record<string, any> = {
    "./identity": { streamKey },
    "@/lib/debug": { dlog() {} },
    "./addons": {
      fetchAddonStreams: async (
        _: unknown,
        __: unknown,
        ___: unknown,
        progress: (s: Stream[]) => void,
      ) => {
        progress(supplied);
        return supplied;
      },
    },
    "./priority-partition": { applyStreamPriority },
    "./anitomy": { enhanceAnimeStreams: async () => {} },
    "./anime-identity-core": { partitionByExactAnimeEpisode },
    "./library": { fetchLibraryStreams: async () => [] },
    "./parser": { parseStream },
    "./trust": { applyTrust },
    "./scoring": scoring,
    "@tauri-apps/api/core": {
      invoke: async (name: string, args: any) => {
        assert.equal(name, "streams_run_pipeline");
        coreCalls.push(args);
        const { keep, rejected } = applyTrust(args.streams, args.trustOpts);
        const corpus = scoring.computeCorpusStats(keep, args.scoreOpts);
        return {
          picker: scoring.rankAndPick(
            keep.map((s) => scoring.scoreStream(s, args.scoreOpts, corpus)),
            [],
            false,
            args.scoreOpts.respectAddonOrder,
          ),
          rejected,
        };
      },
    },
  };
  const code = ts.transpileModule(readFileSync("src/lib/streams/pipeline.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", "window", "performance", code)(
    (id: string) => {
      assert.ok(id in mocks, `Unexpected dependency: ${id}`);
      return mocks[id];
    },
    exports,
    native ? { __TAURI_INTERNALS__: {} } : {},
    { now: () => 1000 },
  );
  return {
    coreCalls,
    partials,
    async run(overrides: Partial<PipelineInput> = {}) {
      const result: PipelineResult = await exports.runPipeline(
        {
          request: { type: "series", ids: ["kitsu:123:19"] },
          query: {},
          addons: [],
          debrids: [],
          isAnime: true,
          animeAbsoluteEpisode: 19,
          trust: { disabled: true, isAnime: true, expectedEpisode: 19 },
          score: { activeDebrids: [], respectAddonOrder: true },
          ...overrides,
        },
        new AbortController().signal,
        (partial: PipelineResult) => partials.push(partial),
      );
      for (let i = 0; i < 10; i++) await Promise.resolve();
      return result;
    },
  };
}

for (const native of [false, true]) {
  test(`filters Off retains alternate episode numbers in partial and final ${native ? "native-bound" : "browser"} results`, async () => {
    const h = fixture(native);
    const result = await h.run();
    assert.equal(h.partials.length, 1);
    for (const output of [...h.partials, result]) {
      assert.deepEqual(
        output.picker.all.map((s) => s.url),
        streams.map((s) => s.url),
      );
      assert.deepEqual(output.rejected, []);
    }
    if (native) {
      assert.equal(h.coreCalls.length, 1);
      assert.equal(h.coreCalls[0].streams.length, 3, "all addon results reach the native pipeline");
      assert.equal(h.coreCalls[0].trustOpts.disabled, true);
    }
  });
}

for (const strict of [false, true]) {
  test(`${strict ? "Strict" : "Balanced"} keeps the existing mismatched-episode rejection`, async () => {
    const h = fixture();
    const result = await h.run({ trust: { disabled: false, strict, allowSeasonPacks: true } });
    for (const output of [...h.partials, result]) {
      assert.deepEqual(
        output.picker.all.map((s) => s.episode),
        [19],
      );
      assert.equal(output.rejected.length, 2);
      assert.ok(output.rejected.every((r) => r.reason.startsWith("anime-episode-mismatch:")));
    }
  });
}

test("enabled filtering still accepts an explicitly mapped episode alias", async () => {
  const h = fixture();
  const result = await h.run({ trust: { strict: false }, animeEpisodeAliases: new Set([69]) });
  assert.deepEqual(
    result.picker.all.map((s) => s.episode),
    [19, 69],
  );
  assert.equal(result.rejected.length, 1);
});

test("Off also preserves embedded/preset anime results", async () => {
  const h = fixture();
  const result = await h.run({ presetStreams: streams });
  assert.equal(result.picker.all.length, 3);
  assert.deepEqual(result.rejected, []);
  assert.ok(h.partials.length <= 1);
});

test("Off preserves each addon and requested addon ordering", async () => {
  const h = fixture(false, [streams[1], { ...streams[1], addonId: "second-addon" }, streams[0]]);
  const result = await h.run();
  assert.deepEqual(
    result.picker.all.map((s) => s.episode),
    [19, 69, 69],
  );
  assert.deepEqual(
    result.picker.all[1].contributors?.map((c) => c.id),
    ["fixture-addon"],
  );
});

test("non-anime results do not acquire the anime episode restriction", async () => {
  const h = fixture();
  const result = await h.run({ isAnime: false, trust: { strict: false } });
  assert.equal(result.picker.all.length, 3);
  assert.deepEqual(result.rejected, []);
});

for (const reverse of [false, true]) {
  test(`adding another addon preserves playback URLs (reverse=${reverse})`, async () => {
    const first = { ...streams[0], infoHash: "a".repeat(40), fileIdx: 0 };
    const second = {
      ...first,
      addonId: "mediafusion",
      url: "https://fixture.invalid/other-provider",
    };
    const alone = await fixture(false, [first]).run();
    const combined = await fixture(false, reverse ? [second, first] : [first, second]).run();
    assert.equal(alone.picker.all.length, 1);
    assert.deepEqual(
      new Set(combined.picker.all.map((s) => s.url)),
      new Set([first.url, second.url]),
    );
  });
}

test("different headers and torrent file selectors remain distinct", () => {
  const base = { ...streams[0], infoHash: "a".repeat(40) };
  assert.notEqual(
    streamKey(base),
    streamKey({ ...base, behaviorHints: { headers: { Referer: "https://fixture.invalid" } } }),
  );
  assert.notEqual(
    streamKey({ ...base, url: undefined, fileMustInclude: "E01" }),
    streamKey({ ...base, url: undefined, fileMustInclude: "E02" }),
  );
  assert.equal(
    streamKey({ ...base, url: undefined }),
    streamKey({ ...base, url: undefined, infoHash: "A".repeat(40) }),
  );
  assert.notEqual(
    streamKey({ addonId: "a", addonName: "a", title: "same" }),
    streamKey({ addonId: "a", addonName: "a", title: "same" }),
  );
});

for (const native of [false, true]) {
  for (const reverse of [false, true]) {
    test(`each installed addon retains shared endpoints (native=${native}, reverse=${reverse})`, async () => {
      const torrentio = {
        ...streams[0],
        addonId: "torrentio",
        addonUrl: "https://torrentio.invalid/manifest.json",
      };
      const aio = {
        ...torrentio,
        addonId: "aiostreams",
        addonUrl: "https://aio.invalid/manifest.json",
        title: "Fixture.Anime.S04E19.720p.WEB-DL.mkv",
      };
      const secondInstall = {
        ...torrentio,
        addonUrl: "https://torrentio.invalid/second/manifest.json",
      };
      const supplied = [torrentio, aio, secondInstall];
      const h = fixture(native, reverse ? supplied.toReversed() : supplied);
      const result = await h.run();
      for (const output of [...h.partials, result]) {
        assert.equal(output.picker.all.length, 3);
        for (const source of supplied) {
          const rows = output.picker.all.filter((s) => s.addonUrl === source.addonUrl);
          assert.equal(rows.length, 1);
          assert.equal(rows[0].title, source.title);
          assert.equal(rows[0].url, source.url);
        }
      }
    });
  }
}
