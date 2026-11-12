// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { animeTopMatch, sameSearchTitle } from "../src/lib/search-top-match.ts";
import type { AnimeHit } from "../src/lib/search.ts";

function hit(name: string, kitsuId: number, year: string): AnimeHit {
  return {
    malId: kitsuId,
    kitsuId,
    format: "TV",
    name,
    year,
    poster: null,
    background: null,
    overview: "",
    score: 8.5,
  };
}

test("an exact or prefix anime title becomes the top match", () => {
  const hits = [
    hit("Rascal Does Not Dream of Santa Claus", 48917, "2025"),
    hit("Rascal Does Not Dream of Bunny Girl Senpai", 41056, "2018"),
    hit("Bleach: Thousand-Year Blood War", 41467, "2022"),
    hit("Bleach: Thousand-Year Blood War - The Separation", 49900, "2023"),
  ];

  assert.equal(animeTopMatch(hits, "Rascal Does Not Dream of Santa Claus")?.meta.id, "kitsu:48917");
  assert.equal(animeTopMatch(hits, "rascal does not dream of")?.meta.id, "kitsu:41056");
  assert.equal(animeTopMatch(hits, "santa claus")?.meta.id, "kitsu:48917");
  assert.equal(
    animeTopMatch(hits, "bleach thousand")?.meta.name,
    "Bleach: Thousand-Year Blood War",
  );
});

test("an exact top match keeps its source", () => {
  assert.equal(sameSearchTitle("Bleach", "bleach"), true);
  assert.equal(sameSearchTitle("Bleach", "bleach thousand"), false);
  assert.equal(
    sameSearchTitle("Rascal Does Not Dream of Bunny Girl Senpai", "rascal santa claus"),
    false,
  );
});
