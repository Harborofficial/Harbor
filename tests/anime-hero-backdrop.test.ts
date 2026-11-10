import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isAnilistBannerBackdrop,
  pickAnimeHeroBackdrop,
  reusableAnimeBackdrop,
} from "../src/lib/providers/anime-art-quality";

const HOME_HERO = readFileSync("src/components/anime-hero.tsx", "utf8");
const SHARED_HERO = readFileSync("src/components/hero-backdrop.tsx", "utf8");
const BP_AMBIENT = readFileSync("src/views/big-picture/bp-ambient.tsx", "utf8");

const BANNER = "https://s4.anilist.co/file/anilistcdn/media/anime/banner/16498-8jpFCOcDmneX.jpg";
const KITSU = "https://media.kitsu.app/anime/cover_images/7442/original.png";
const TMDB = "https://image.tmdb.org/t/p/original/abc.jpg";
const TVDB = "https://artworks.thetvdb.com/banners/fanart/original/123.jpg";

test("AniList banners are recognised as low-resolution hero art", () => {
  assert.equal(isAnilistBannerBackdrop(BANNER), true);
  assert.equal(
    isAnilistBannerBackdrop("https://s4.anilist.co/file/anilistcdn/media/anime/banner/1-x.png"),
    true,
  );
  for (const url of [KITSU, TMDB, TVDB, undefined, ""]) {
    assert.equal(isAnilistBannerBackdrop(url), false, String(url));
  }
});

test("curated and real 16:9 artwork outrank an AniList banner", () => {
  const CURATED = "https://assets.fanart.tv/fanart/curated.jpg";
  assert.equal(
    pickAnimeHeroBackdrop({
      curated: CURATED,
      tvdb: TVDB,
      tmdb: TMDB,
      kitsu: KITSU,
      banner: BANNER,
    }),
    CURATED,
  );
  assert.equal(
    pickAnimeHeroBackdrop({ tvdb: TVDB, tmdb: TMDB, kitsu: KITSU, banner: BANNER }),
    TMDB,
  );
  assert.equal(pickAnimeHeroBackdrop({ tmdb: TMDB, kitsu: KITSU, banner: BANNER }), TMDB);
  assert.equal(pickAnimeHeroBackdrop({ kitsu: KITSU, banner: BANNER }), KITSU);
  assert.equal(pickAnimeHeroBackdrop({ banner: BANNER }), BANNER);
  assert.equal(pickAnimeHeroBackdrop({}), undefined);
});

test("a banner that is itself passed as a 16:9 source is still demoted", () => {
  assert.equal(pickAnimeHeroBackdrop({ tmdb: BANNER, kitsu: KITSU }), KITSU);
  assert.equal(pickAnimeHeroBackdrop({ tvdb: "", kitsu: BANNER }), BANNER);
});

test("the anime home hero uses the measured shared hero backdrop", () => {
  assert.match(HOME_HERO, /import \{ HeroBackdrop \} from "\.\/hero-backdrop"/);
  assert.match(
    HOME_HERO,
    /<HeroBackdrop\s+url=\{m\.background \?\? m\.poster \?\? ""\}\s+fallbacks=\{m\.poster \? \[m\.poster\] : \[\]\}/,
  );
  assert.match(
    SHARED_HERO,
    /rememberHeroArtQuality\(\s*url,\s*suitable \? Math\.max\(width, 1600\) : width,\s*suitable \? Math\.max\(\s*height,\s*800,?\s*\) : height,?\s*\)/,
  );
  assert.match(SHARED_HERO, /onUnavailable=\{\(\) => advance\(layer\.url\)\}/);
});

test("Big Picture anime filters unreliable cached art and has pool fallbacks", () => {
  assert.match(BP_AMBIENT, /route\.kind === "anime"/);
  assert.match(BP_AMBIENT, /reusableAnimeBackdrop\(url\)/);
  assert.match(BP_AMBIENT, /\.slice\(0, 6\)/);
  assert.match(BP_AMBIENT, /bpHeroCandidates\(meta \? own : fallback/);
});

test("cached hero art ignores banners and wide Kitsu strips", () => {
  assert.equal(reusableAnimeBackdrop(BANNER), undefined);
  assert.equal(reusableAnimeBackdrop(KITSU), undefined);
  assert.equal(
    reusableAnimeBackdrop("https://media.kitsu.app/anime/12/cover_image/21ecb556.jpg"),
    undefined,
  );
  assert.equal(reusableAnimeBackdrop(TMDB), TMDB);
  assert.equal(reusableAnimeBackdrop(undefined), undefined);
});
