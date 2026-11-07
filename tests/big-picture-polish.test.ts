import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bpPosterOverride } from "../src/views/big-picture/bp-poster-override";

const HOME = readFileSync("src/views/big-picture/bp-home.tsx", "utf8");
const TILE = readFileSync("src/views/big-picture/bp-tile.tsx", "utf8");

test("Big Picture home no longer adds an addons rail", () => {
  assert.doesNotMatch(HOME, /BpAddonRow/);
  assert.doesNotMatch(HOME, /band:\s*"addons"/);
});

test("a custom poster is an override only when it differs from the plain poster", () => {
  assert.deepEqual(bpPosterOverride("https://custom/poster.jpg", "https://meta/poster.jpg", true), {
    src: "https://custom/poster.jpg",
    custom: true,
  });
  assert.deepEqual(bpPosterOverride("https://meta/poster.jpg", "https://meta/poster.jpg", true), {
    src: undefined,
    custom: false,
  });
  assert.deepEqual(bpPosterOverride(undefined, "https://meta/poster.jpg", true), {
    src: undefined,
    custom: false,
  });
});

test("a non-custom override keeps the tile title", () => {
  assert.deepEqual(bpPosterOverride("https://tmdb/poster.jpg", "https://meta/poster.jpg", false), {
    src: "https://tmdb/poster.jpg",
    custom: false,
  });
});

test("the tile suppresses its title only for a custom poster override", () => {
  assert.match(TILE, /const \{ src: override, custom \} = useBpPosterChain\(meta, shape, boxRef\)/);
  assert.match(TILE, /const showTitle = !settings\.hidePosterTitles && !custom;/);
});
