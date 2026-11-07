import assert from "node:assert/strict";
import test from "node:test";
import {
  firstUsableHeroBackdrop,
  isHighQualityHeroArt,
  nextUsableHeroBackdrop,
  rememberHeroArtQuality,
} from "../src/lib/hero-art-quality";

test("hero art must be large and close to 16:9", () => {
  assert.equal(isHighQualityHeroArt(1920, 1080), true);
  assert.equal(isHighQualityHeroArt(3840, 2160), true);
  assert.equal(isHighQualityHeroArt(2000, 1000), true);
  assert.equal(isHighQualityHeroArt(1464, 365), false, "Kitsu wide cover");
  assert.equal(isHighQualityHeroArt(1900, 400), false, "AniList banner");
  assert.equal(isHighQualityHeroArt(1280, 720), false, "720p is soft on a full-screen hero");
  assert.equal(isHighQualityHeroArt(3000, 900), false, "too wide for a hero crop");
  assert.equal(isHighQualityHeroArt(0, 0), false);
});

test("a measured banner is skipped once better artwork is available", () => {
  const banner = "https://s4.anilist.co/file/anilistcdn/media/anime/banner/skip-me.jpg";
  const cover = "https://media.kitsu.app/anime/12/cover_image/skip-me.jpg";
  const tvdb = "https://artworks.thetvdb.com/banners/skip-me.jpg";
  rememberHeroArtQuality(banner, 1900, 400);
  rememberHeroArtQuality(cover, 1464, 365);
  assert.equal(firstUsableHeroBackdrop([banner, cover]), undefined);
  assert.equal(firstUsableHeroBackdrop([banner, tvdb, cover]), tvdb);
  assert.equal(
    firstUsableHeroBackdrop([banner, "https://example.test/unknown.jpg"]),
    "https://example.test/unknown.jpg",
  );
});

test("advancing walks past measured-low artwork without losing unknown candidates", () => {
  const banner = "https://s4.anilist.co/file/anilistcdn/media/anime/banner/advance.jpg";
  const tvdb = "https://artworks.thetvdb.com/banners/advance.jpg";
  rememberHeroArtQuality(banner, 1900, 400);
  const list = [banner, tvdb];
  assert.equal(nextUsableHeroBackdrop(list, banner), tvdb);
  assert.equal(nextUsableHeroBackdrop(list, tvdb), undefined);
  rememberHeroArtQuality(tvdb, 1920, 1080);
  assert.equal(firstUsableHeroBackdrop(list), tvdb);
});
