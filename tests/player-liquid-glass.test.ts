import assert from "node:assert/strict";
import test from "node:test";
import { GLASS_DEFAULTS, normalizeGlassOptics } from "../src/lib/player/liquid-glass.ts";

test("player glass keeps MPV glass defaults when old settings have no optical preferences", () => {
  assert.deepEqual(normalizeGlassOptics(undefined), {
    zoom: 1.08,
    refraction: 1,
    dispersion: 1,
    blur: 1,
  });
  assert.deepEqual(normalizeGlassOptics({ zoom: 1.09 }), { ...GLASS_DEFAULTS, zoom: 1.09 });
});

test("neutral optics are retained and invalid saved preferences cannot enter the shader", () => {
  assert.deepEqual(normalizeGlassOptics({ zoom: 1, refraction: 0, dispersion: 0, blur: 0 }), {
    zoom: 1,
    refraction: 0,
    dispersion: 0,
    blur: 0,
  });
  const input = { zoom: Infinity, refraction: -20, dispersion: NaN, blur: 50 };
  assert.deepEqual(normalizeGlassOptics(input), {
    zoom: 1.08,
    refraction: 0,
    dispersion: 1,
    blur: 1.2,
  });
  assert.equal(input.refraction, -20);
  assert.deepEqual(normalizeGlassOptics({ zoom: "1.1", blur: null }), GLASS_DEFAULTS);
});
