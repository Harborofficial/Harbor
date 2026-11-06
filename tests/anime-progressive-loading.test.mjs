import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("playable anime episodes publish before the full metadata batch settles", async () => {
  const code = ts.transpileModule(
    readFileSync(new URL("../src/lib/providers/anime-detail.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const never = new Promise(() => {});
  const episodes = [
    { id: 1, number: 1, streamId: "kitsu:12:1" },
    { id: 2, number: 2, streamId: "kitsu:12:2" },
  ];
  const mocks = {
    "@/lib/media-cache": { onMediaCacheClear() {}, mediaCacheGeneration: () => 0 },
    "@/lib/providers/kitsu": {
      parseKitsuId: (id) => Number(id.split(":")[1]),
      kitsuAnime: async () => ({ id: 12, subtype: "tv", episodeCount: 1400 }),
      kitsuEpisodes: () => never,
      kitsuCharacters: async () => [],
      kitsuRelated: async () => [],
      kitsuStudios: async () => [],
      kitsuStreamingLinks: async () => [],
    },
    "@/lib/providers/anime-kitsu-addon": {
      animeKitsuMeta: async () => ({ id: "kitsu:12", videos: episodes }),
    },
    "@/lib/providers/anime-episode-build": {
      buildKitsuEpisodes: (addon) => addon.videos,
    },
    "@/lib/providers/anizip": { aniZipByKitsu: async () => null },
    "@/lib/providers/anime-mapping": {
      animeMappingByKitsu: async () => null,
      kitsuToTvdb: async () => null,
    },
    "./anime-recommendations": { animeRecommendations: async () => [] },
  };
  const optional = new Proxy({}, { get: () => async () => null });
  const mod = { exports: {} };
  new Function("module", "exports", "require", code)(
    mod,
    mod.exports,
    (name) => mocks[name] ?? optional,
  );
  let published = null;
  let settled = false;
  const job = mod.exports.animeDetails(
    { tmdbLanguage: "en", uiLanguage: "en", tmdbKey: "" },
    { id: "kitsu:12", name: "One Piece", type: "anime" },
    (items, id) => {
      published = { items, id };
    },
  );
  job.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(published?.id, 12);
  assert.deepEqual(published?.items, episodes);
  assert.equal(settled, false, "TVDB and other metadata must not block playable rows");
});
