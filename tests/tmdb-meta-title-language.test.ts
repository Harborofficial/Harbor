import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  pickTmdbTitle,
  shouldUseEnglishTitle,
  tmdbEnglishTitle,
  tmdbEnglishTranslation,
} from "../src/lib/providers/tmdb/tmdb-title-fallback.ts";

function metaMappers(language: string) {
  const output = ts.transpileModule(
    readFileSync("src/lib/providers/tmdb/tmdb-meta-mappers.ts", "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const module = { exports: {} as any };
  const mocks: Record<string, unknown> = {
    "../../feed/tags": { MOVIE_GENRES: { Animation: 16 }, TV_GENRES: { Animation: 16 } },
    "../../settings/load": { loadStoredSettings: () => ({ translateTitles: true }) },
    "./tmdb-client": { effectiveTmdbLanguage: () => language },
    "./tmdb-image-rungs": { tmdbBackdropUrl: () => undefined, tmdbPosterUrl: () => undefined },
    "./tmdb-title-fallback": { shouldUseEnglishTitle },
  };
  new Function("require", "module", "exports", output)(
    (name: string) => {
      assert.ok(name in mocks, `unexpected import ${name}`);
      return mocks[name];
    },
    module,
    module.exports,
  );
  return module.exports;
}

function detailMapper(language: string, translateTitles = true) {
  const output = ts.transpileModule(
    readFileSync("src/lib/providers/tmdb/tmdb-details.ts", "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const module = { exports: {} as any };
  const mocks: Record<string, unknown> = {
    "./tmdb-client": {
      get: async (_key: string, path: string) => (path === "movie/1" || path === "tv/1" ? raw : {}),
      IMG: "https://image.tmdb.org/t/p",
      effectiveTmdbLanguage: () => language,
    },
    "./tmdb-image-rungs": { tmdbBackdropUrl: () => undefined, tmdbPosterUrl: () => undefined },
    "@/lib/settings/load": { loadStoredSettings: () => ({ translateTitles }) },
    "./tmdb-images": { pickLogo: () => undefined, fetchMovieAssets: async () => null },
    "./tmdb-image-lang": { imageLangParam: () => "ja,en", imageLangRank: () => 0 },
    "./tmdb-trailers": { pickTrailers: () => [] },
    "./tmdb-meta-mappers": { isAnimeItem: metaMappers(language).isAnimeItem },
    "./tmdb-title-fallback": {
      pickTmdbTitle,
      shouldUseEnglishTitle,
      tmdbEnglishTitle,
      tmdbEnglishTranslation,
    },
    "@/lib/storage-recovery": { setItemWithRecovery: () => undefined },
    "@/lib/episode-text-language": { episodeTextLanguage: () => language },
    "@/lib/season-name": { isGenericSeasonName: () => false },
  };
  let raw: Record<string, unknown>;
  new Function("require", "module", "exports", output)(
    (name: string) => {
      assert.ok(name in mocks, `unexpected import ${name}`);
      return mocks[name];
    },
    module,
    module.exports,
  );
  return (value: Record<string, unknown>, type: "movie" | "series") => {
    raw = value;
    return module.exports.tmdbDetails(
      "key",
      { id: type === "movie" ? "tmdb:movie:1" : "tmdb:tv:1", type },
      language,
    );
  };
}

test("Japanese metadata keeps Japanese anime titles even when an English name is available", () => {
  const { movieMeta, seriesMeta } = metaMappers("ja-JP");
  const movie = {
    id: 1,
    title: "君の名は。",
    original_title: "君の名は。",
    original_language: "ja",
    genre_ids: [16],
  };
  const series = {
    id: 2,
    name: "進撃の巨人",
    original_name: "進撃の巨人",
    original_language: "ja",
    genre_ids: [16],
  };
  assert.equal(movieMeta(movie, "Your Name").name, movie.title);
  assert.equal(seriesMeta(series, "Attack on Titan").name, series.name);
  assert.equal(
    movieMeta(
      {
        id: 3,
        title: "No dejes a los niños solos",
        original_title: "No dejes a los niños solos",
        original_language: "es",
      },
      "Don't Leave the Kids Alone",
    ).name,
    "Don't Leave the Kids Alone",
  );
});

test("untranslated anime titles still use English in a different metadata language", () => {
  const { movieMeta, seriesMeta } = metaMappers("fr-FR");
  const movie = {
    id: 1,
    title: "君の名は。",
    original_title: "君の名は。",
    original_language: "ja",
    genre_ids: [16],
  };
  const series = {
    id: 2,
    name: "進撃の巨人",
    original_name: "進撃の巨人",
    original_language: "ja",
    genre_ids: [16],
  };
  assert.equal(movieMeta(movie, "Your Name").name, "Your Name");
  assert.equal(seriesMeta(series, "Attack on Titan").name, "Attack on Titan");
});

test("anime detail titles respect Japanese metadata and fall back for Arabic metadata", async () => {
  for (const [type, original, english] of [
    ["movie", "君の名は。", "Your Name"],
    ["series", "進撃の巨人", "Attack on Titan"],
  ] as const) {
    const raw = {
      id: 1,
      ...(type === "movie"
        ? { title: original, original_title: original }
        : { name: original, original_name: original }),
      original_language: "ja",
      genres: [{ id: 16, name: "Animation" }],
      translations: {
        translations: [{ iso_639_1: "en", data: { title: english, name: english } }],
      },
    };
    assert.equal((await detailMapper("ja-JP")(raw, type)).title, original);
    assert.equal((await detailMapper("ar-SA")(raw, type)).title, english);
    assert.equal((await detailMapper("ja-JP", false)(raw, type)).title, english);
  }
});
