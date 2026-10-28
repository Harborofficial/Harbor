import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  pickTmdbTitle,
  shouldUseEnglishTitle,
  tmdbLanguageBase,
} from "../src/lib/providers/tmdb/tmdb-title-fallback.ts";

function load(mocks: Record<string, unknown>) {
  const output = ts.transpileModule(
    readFileSync("src/lib/providers/tmdb/tmdb-catalogs.ts", "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const module = { exports: {} as any };
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

function harness(options: {
  localized: any[];
  english?: any[];
  settings?: { translateTitles: boolean };
}) {
  const requests: Array<{ path: string; language?: string }> = [];
  const settings = options.settings ?? { translateTitles: true };
  const api = load({
    "./tmdb-client": {
      effectiveTmdbLanguage: () => "ar-SA",
      get: async (_: string, path: string, params: Record<string, string> = {}) => {
        requests.push({ path, language: params.language });
        return params.language === "en-US"
          ? { results: options.english ?? [] }
          : { results: options.localized };
      },
    },
    "./tmdb-meta-mappers": {
      movieMeta: (movie: any, englishName?: string) => ({
        id: `tmdb:movie:${movie.id}`,
        type: "movie",
        name: settings.translateTitles
          ? (englishName ?? movie.title)
          : (movie.original_title ?? movie.title),
      }),
      seriesMeta: (series: any, englishName?: string) => ({
        id: `tmdb:tv:${series.id}`,
        type: "series",
        name: settings.translateTitles
          ? (englishName ?? series.name)
          : (series.original_name ?? series.name),
      }),
    },
    "../../settings/load": { loadStoredSettings: () => settings },
    "./tmdb-title-fallback": { pickTmdbTitle, shouldUseEnglishTitle, tmdbLanguageBase },
  });
  return { api, requests, settings };
}

test("a catalog page with an untranslated title fetches the English page once", async () => {
  const h = harness({
    localized: [
      {
        id: 1,
        title: "No dejes a los niños solos",
        original_title: "No dejes a los niños solos",
        original_language: "es",
      },
    ],
    english: [{ id: 1, title: "Don't Leave the Kids Alone" }],
  });
  const metas = await h.api.tmdbDiscover("key", "movie", {});
  assert.deepEqual(h.requests, [
    { path: "discover/movie", language: undefined },
    { path: "discover/movie", language: "en-US" },
  ]);
  assert.equal(metas[0].name, "Don't Leave the Kids Alone");
});

test("a fully translated page never asks TMDB in English", async () => {
  const h = harness({
    localized: [
      {
        id: 2,
        title: "الشر المقيم",
        original_title: "Resident Evil",
        original_language: "en",
      },
    ],
    english: [{ id: 2, title: "Resident Evil" }],
  });
  const metas = await h.api.tmdbDiscover("key", "movie", {});
  assert.deepEqual(h.requests, [{ path: "discover/movie", language: undefined }]);
  assert.equal(metas[0].name, "الشر المقيم");
});

test("translate titles off never asks TMDB in English", async () => {
  const h = harness({
    localized: [
      {
        id: 3,
        title: "No dejes a los niños solos",
        original_title: "No dejes a los niños solos",
        original_language: "es",
      },
    ],
    english: [
      {
        id: 3,
        title: "Don't Leave the Kids Alone",
        original_title: "No dejes a los niños solos",
      },
    ],
    settings: { translateTitles: false },
  });
  const metas = await h.api.tmdbDiscover("key", "movie", {});
  assert.deepEqual(h.requests, [{ path: "discover/movie", language: "en-US" }]);
  assert.equal(metas[0].name, "No dejes a los niños solos");
});
