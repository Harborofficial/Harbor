import assert from "node:assert/strict";
import test from "node:test";
import { parseStream } from "../src/lib/streams/parser.ts";
import { applyTrust } from "../src/lib/streams/trust.ts";

const stream = (title: string) =>
  parseStream({
    addonId: "fixture",
    addonName: "Fixture",
    title,
    url: "https://example.invalid/video.m3u8",
    behaviorHints: { videoSize: 2 * 1024 ** 3 },
  });
const check = (
  title: string,
  kind: "movie" | "series",
  expectedTitle: string,
  aliases: string[] = [],
) =>
  applyTrust([stream(title)], {
    kind,
    strict: true,
    expectedTitle,
    expectedTitles: aliases,
    expectedSeason: kind === "series" ? 1 : undefined,
    expectedEpisode: kind === "series" ? 1 : undefined,
    allowSeasonPacks: false,
  });

for (const [language, release, title] of [
  ["English", "Breaking.Bad.S01E01.1080p.WEB-DL.mkv", "Breaking Bad"],
  ["Spanish", "La Casa de Papel S01E01 1080p WEB-DL", "La Casa de Papel"],
  ["French", "Le Bureau des Légendes S01E01 1080p WEB-DL", "Le Bureau des Légendes"],
  ["Arabic", "البيت بيتي S01E01 1080p WEB-DL", "البيت بيتي"],
]) {
  test(`${language} series matches its own name, not an unrelated English series`, () => {
    assert.equal(check(release, "series", title).keep.length, 1);
    assert.equal(check(release, "series", "Totally Different Show").keep.length, 0);
  });
}
test("English movies continue to reject unrelated releases", () => {
  assert.equal(check("The.Matrix.1999.1080p.BluRay.mkv", "movie", "The Matrix").keep.length, 1);
  assert.equal(check("The.Matrix.1999.1080p.BluRay.mkv", "movie", "Inception").keep.length, 0);
});
test("Arabic film requires matching original title or verified alias", () => {
  const release = "[1080p][WEB] فيلم عربي جميل";
  assert.equal(check(release, "movie", "Completely Unrelated").keep.length, 0);
  assert.equal(check(release, "movie", "An Arabic Film", ["فيلم عربي جميل"]).keep.length, 1);
});
test("non-Latin series never pass solely because expected title is English", () => {
  for (const name of ["魔法少女", "어느 날", "中文电视剧", "بيت عربي"]) {
    assert.equal(check(`${name} S01E01 1080p WEB`, "series", "An English Title").keep.length, 0);
  }
});
test("anime is not subject to the live-action strict season pack guard", () => {
  const s = stream("One.Piece.S01.1080p.WEB-DL");
  const result = applyTrust([s], {
    kind: "series",
    isAnime: true,
    strict: true,
    expectedTitle: "One Piece",
    expectedEpisode: 1,
    expectedSeason: 1,
    allowSeasonPacks: false,
  });
  assert.equal(
    result.rejected.some((r) => r.reason === "season-pack-not-episode"),
    false,
  );
});
test("English season packs are blocked for single-episode strict mode", () => {
  assert.equal(
    check("Breaking.Bad.S01.1080p.WEB-DL", "series", "Breaking Bad").rejected[0]?.reason,
    "season-pack-not-episode",
  );
});
