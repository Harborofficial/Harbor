import "./_localstorage-stub.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { nuvioAliasVariants } from "../src/lib/nuvio/nuvio-playback";

test("explicit series IDs never manufacture movie aliases", () => {
  const variants = nuvioAliasVariants("tmdb:tv:500");
  assert.ok(variants.includes("tmdb:tv:500"));
  assert.ok(variants.includes("series:500"));
  assert.ok(variants.includes("500"));
  assert.ok(variants.includes("tmdb:500"));
  assert.equal(variants.includes("movie:500"), false);
  assert.equal(variants.includes("tmdb:movie:500"), false);
});

test("explicit movie IDs never manufacture series aliases", () => {
  const variants = nuvioAliasVariants("tmdb:movie:500");
  assert.ok(variants.includes("tmdb:movie:500"));
  assert.ok(variants.includes("movie:500"));
  assert.equal(variants.includes("series:500"), false);
  assert.equal(variants.includes("tmdb:tv:500"), false);
});

test("a bare numeric ID only gains typed aliases when the owner knows its type", () => {
  assert.deepEqual(nuvioAliasVariants("500").sort(), ["500", "tmdb:500"]);

  const series = nuvioAliasVariants("500", "series");
  assert.ok(series.includes("series:500"));
  assert.ok(series.includes("tmdb:tv:500"));
  assert.equal(series.includes("movie:500"), false);

  const movie = nuvioAliasVariants("500", "movie");
  assert.ok(movie.includes("movie:500"));
  assert.ok(movie.includes("tmdb:movie:500"));
  assert.equal(movie.includes("series:500"), false);
});
