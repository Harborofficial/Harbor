import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const DETAIL = readFileSync("src/views/detail.tsx", "utf8");
const MAPPING = readFileSync("src/lib/providers/anime-mapping.ts", "utf8");
const KITSU = readFileSync("src/lib/providers/kitsu.ts", "utf8");

test("anime identity is independent of the metadata source", () => {
  assert.match(DETAIL, /const animeIdentity = idAnime \|\| detectedKitsu != null;/);
  assert.match(
    DETAIL,
    /const isAnime = !prioritizeMetadataAddons && animeIdentity;/,
    "content keeps the addon-first episode source while identity stays true",
  );
});

test("a detected Kitsu entry supplies the canonical tracker id without loading anime metadata", () => {
  assert.match(
    DETAIL,
    /setAnimeCanonicalId\(\(current\) => current \?\? `kitsu:\$\{detectedKitsu\}`\)/,
  );
  assert.match(DETAIL, /\{actionStage < 2 && animeIdentity && \(\s*<AddToAnilistButton/);
  assert.match(DETAIL, /\{actionStage < 2 && animeIdentity && \(\s*<AddToMalButton/);
});

test("addon-only anime detection can resolve external ids without reading built-in metadata", () => {
  assert.match(MAPPING, /aniZipByImdb\(imdbId, true\)/);
  assert.match(MAPPING, /aniZipByTmdbTv\(tmdbId, true\)/);
  assert.match(MAPPING, /kitsuAnime\(kitsuId, undefined, true\)/);
  assert.match(MAPPING, /kitsuMainTvSeries\(kitsuId, true\)/);
  assert.match(DETAIL, /kitsuSearchAnime\(name, 8, true\)/);
  assert.match(KITSU, /async function get<T>\(path: string, maxAge\?: number, identity = false\)/);
  assert.match(KITSU, /if \(addonOnlyMetadata\(\) && !identity\) return null;/);
});
