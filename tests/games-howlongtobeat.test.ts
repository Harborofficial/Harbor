import test from "node:test";
import assert from "node:assert/strict";
import { parseHowLongToBeatSearch } from "../src/lib/games/howlongtobeat-data.ts";

const row = (id: number, name: string, year: number, overrides: Record<string, unknown> = {}) => ({
  game_id: id, game_name: name, release_world: year, game_type: "game", comp_main: 36000, comp_plus: 54000, comp_100: 90000, ...overrides,
});

test("returns HowLongToBeat's source and original seconds for an exact title", () => {
  assert.deepEqual(parseHowLongToBeatSearch({ data: [row(68151, "Elden Ring", 2022)] }, "Elden Ring", 2022), {
    id: 68151, name: "Elden Ring", main: 36000, extras: 54000, complete: 90000, url: "https://howlongtobeat.com/game/68151",
  });
});

test("does not confuse a base game with sequels or DLC", () => {
  const results = { data: [row(160589, "Elden Ring: Nightreign", 2025), row(139385, "Elden Ring: Shadow of the Erdtree", 2024, { game_type: "dlc" })] };
  assert.equal(parseHowLongToBeatSearch(results, "Elden Ring"), null);
  assert.equal(parseHowLongToBeatSearch(results, "Elden Ring", 2022), null);
  assert.equal(parseHowLongToBeatSearch(results, "Elden Ring: Shadow of the Erdtree", 2024)?.id, 139385);
});

test("requires a matching year for longer title variants and rejects conflicting editions", () => {
  assert.equal(parseHowLongToBeatSearch({ data: [row(10270, "The Witcher 3: Wild Hunt", 2015)] }, "The Witcher 3", 2015)?.id, 10270);
  assert.equal(parseHowLongToBeatSearch({ data: [row(10270, "The Witcher 3: Wild Hunt", 2015)] }, "The Witcher 3"), null);
  assert.equal(parseHowLongToBeatSearch({ data: [row(50, "Example Remaster", 2023)] }, "Example Remaster", 1999), null);
});

test("rejects ambiguous names, missing data and nonnumeric durations", () => {
  assert.equal(parseHowLongToBeatSearch({ data: [row(1, "Same", 2020), row(2, "Same", 2020)] }, "Same", 2020), null);
  assert.equal(parseHowLongToBeatSearch({ data: [row(1, "Empty", 2020, { comp_main: 0, comp_plus: 0, comp_100: 0 })] }, "Empty"), null);
  assert.equal(parseHowLongToBeatSearch({ data: [row(1, "Wrong", 2020, { comp_main: "3600", comp_plus: -1, comp_100: null })] }, "Wrong"), null);
  assert.equal(parseHowLongToBeatSearch({}, "Something"), null);
});
