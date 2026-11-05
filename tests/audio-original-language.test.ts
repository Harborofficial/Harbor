import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { expandOriginalAudioLang, ORIGINAL_AUDIO_LANG } from "../src/lib/player/audio-language";
import { trackPreferences } from "../src/lib/player/track-preferences";
import * as language from "../src/lib/subtitles/language";

test("Original resolves to the title's original language", () => {
  assert.deepEqual(expandOriginalAudioLang([ORIGINAL_AUDIO_LANG, "English"], "ja", false), [
    "Japanese",
    "English",
  ]);
  assert.deepEqual(expandOriginalAudioLang([ORIGINAL_AUDIO_LANG], "fr", false), ["French"]);
  assert.deepEqual(expandOriginalAudioLang(["English", ORIGINAL_AUDIO_LANG], "ko", false), [
    "English",
    "Korean",
  ]);
});

test("anime falls back to Japanese when the original language is missing", () => {
  assert.deepEqual(expandOriginalAudioLang([ORIGINAL_AUDIO_LANG, "English"], undefined, true), [
    "Japanese",
    "English",
  ]);
});

test("an unknown original language is skipped instead of blocking fallbacks", () => {
  assert.deepEqual(expandOriginalAudioLang([ORIGINAL_AUDIO_LANG, "English"], undefined, false), [
    "English",
  ]);
  assert.deepEqual(expandOriginalAudioLang([ORIGINAL_AUDIO_LANG, "English"], "xx", false), [
    "English",
  ]);
  assert.deepEqual(expandOriginalAudioLang([ORIGINAL_AUDIO_LANG], undefined, false), []);
});

test("a resolved original does not duplicate an existing preference", () => {
  assert.deepEqual(
    expandOriginalAudioLang([ORIGINAL_AUDIO_LANG, "Japanese", "English"], "ja", true),
    ["Japanese", "English"],
  );
});

test("lists without Original are returned untouched", () => {
  const langs = ["English", "Japanese"];
  assert.equal(expandOriginalAudioLang(langs, "ja", true), langs);
});

test("playback preferences expand Original for the title, including Japanese originals", () => {
  const settings = {
    preferredAudioLangs: [ORIGINAL_AUDIO_LANG, "English"],
    preferredLanguages: ["English"],
    preferredSubLangs: ["English"],
    trackBlockWords: [],
  } as never;
  const movie = { meta: { id: "tt1", name: "X", type: "movie", originalLanguage: "fr" } };
  assert.deepEqual(trackPreferences(movie as never, settings, null).audioLangs, [
    "French",
    "English",
  ]);
  const anime = { meta: { id: "kitsu:1", name: "X", type: "series" } };
  assert.deepEqual(trackPreferences(anime as never, settings, null).audioLangs, [
    "Japanese",
    "English",
  ]);
  const japaneseFilm = { meta: { id: "tt2", name: "Y", type: "movie", originalLanguage: "ja" } };
  assert.deepEqual(trackPreferences(japaneseFilm as never, settings, null).audioLangs, [
    "Japanese",
    "English",
  ]);
});

test("the settings store keeps the Original sentinel intact", async () => {
  const store = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
  try {
    store.set(
      "harbor.settings.audio-original",
      JSON.stringify({ preferredAudioLangs: [ORIGINAL_AUDIO_LANG, "Japanese"] }),
    );
    const { loadStoredSettings } = await import("../src/lib/settings/load");
    const settings = loadStoredSettings("harbor.settings.audio-original");
    assert.deepEqual(settings.preferredAudioLangs, [ORIGINAL_AUDIO_LANG, "Japanese"]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("the keyless IMDb source only answers when one language is listed", async () => {
  const source = readFileSync(
    new URL("../src/lib/providers/imdbapi/imdbapi-details.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let requests = 0;
  let spokenLanguages: Array<{ code?: string; name?: string }> = [];
  const module = { exports: {} as { imdbapiOriginalLanguage: (id: string) => Promise<string> } };
  new Function("require", "module", "exports", compiled)(
    (id: string) => {
      if (id === "@/lib/metadata-policy") return { addonOnlyMetadata: () => false };
      if (id === "@/lib/safe-fetch")
        return {
          safeFetch: async () => {
            requests += 1;
            return {
              ok: true,
              json: async () => ({
                id: "tt-fixture",
                type: "movie",
                primaryTitle: "Fixture",
                spokenLanguages,
              }),
            };
          },
        };
      throw new Error(`Unexpected module ${id}`);
    },
    module,
    module.exports,
  );
  // Several spoken languages are not evidence of which one is original.
  spokenLanguages = [
    { code: "kor", name: "Korean" },
    { code: "eng", name: "English" },
  ];
  assert.equal(await module.exports.imdbapiOriginalLanguage("tt1"), "");
  assert.equal(await module.exports.imdbapiOriginalLanguage("tt1"), "");
  assert.equal(requests, 1);
  assert.equal(await module.exports.imdbapiOriginalLanguage("kitsu:1"), "");
  // One spoken language is unambiguous.
  spokenLanguages = [{ code: "kor", name: "Korean" }];
  assert.equal(await module.exports.imdbapiOriginalLanguage("tt2"), "kor");
  assert.equal(requests, 2);
});

async function originalLanguageFixture() {
  const source = readFileSync(
    new URL("../src/lib/providers/original-language.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls = { tmdb: 0, wikidata: 0, imdb: 0 };
  let tmdbLanguage = "";
  let wikidataBindings: Array<Record<string, { value?: string }>> = [];
  let imdbLanguage = "";
  const module = {
    exports: {} as {
      resolveOriginalLanguage: (input: {
        meta: { id: string; type: string; originalLanguage?: string };
        imdbId: string | null;
        tmdbKey: string;
      }) => Promise<string>;
    },
  };
  new Function("require", "module", "exports", compiled)(
    (id: string) => {
      if (id === "@/lib/providers/tmdb/tmdb-client")
        return {
          get: async (_key: string, path: string) => {
            calls.tmdb += 1;
            if (!tmdbLanguage) return null;
            return path.startsWith("find/")
              ? { movie_results: [{ original_language: tmdbLanguage }], tv_results: [] }
              : { original_language: tmdbLanguage };
          },
        };
      if (id === "@/lib/safe-fetch")
        return {
          safeFetch: async () => {
            calls.wikidata += 1;
            return {
              ok: true,
              json: async () => ({ results: { bindings: wikidataBindings } }),
            };
          },
        };
      if (id === "@/lib/providers/imdbapi/imdbapi-details")
        return {
          imdbapiOriginalLanguage: async () => {
            calls.imdb += 1;
            return imdbLanguage;
          },
        };
      if (id === "@/lib/subtitles/language") return language;
      throw new Error(`Unexpected module ${id}`);
    },
    module,
    module.exports,
  );
  return {
    resolve: module.exports.resolveOriginalLanguage,
    calls,
    setTmdb(value: string) {
      tmdbLanguage = value;
    },
    setWikidata(rows: Array<Record<string, { value?: string }>>) {
      wikidataBindings = rows;
    },
    setImdb(value: string) {
      imdbLanguage = value;
    },
  };
}

test("Original uses an explicit value, then TMDB, Wikidata, then unambiguous IMDb", async () => {
  const f = await originalLanguageFixture();
  const explicit = await f.resolve({
    meta: { id: "tt1", type: "movie", originalLanguage: "ja" },
    imdbId: "tt1",
    tmdbKey: "key",
  });
  assert.equal(explicit, "ja");
  assert.deepEqual(f.calls, { tmdb: 0, wikidata: 0, imdb: 0 });

  f.setTmdb("ko");
  f.setWikidata([{ iso1: { value: "fr" } }]);
  f.setImdb("eng");
  assert.equal(
    await f.resolve({ meta: { id: "tt2", type: "movie" }, imdbId: "tt2", tmdbKey: "key" }),
    "ko",
  );
  assert.deepEqual(f.calls, { tmdb: 1, wikidata: 0, imdb: 0 });

  // TMDB has no answer: Wikidata's explicit property wins over IMDb's list.
  f.setTmdb("");
  assert.equal(
    await f.resolve({ meta: { id: "tt3", type: "movie" }, imdbId: "tt3", tmdbKey: "key" }),
    "fr",
  );
  assert.deepEqual(f.calls, { tmdb: 2, wikidata: 1, imdb: 0 });

  // Two original languages are ambiguous, so only the unambiguous IMDb value remains.
  f.setWikidata([{ iso1: { value: "en" } }, { iso1: { value: "es" } }]);
  f.setImdb("es");
  assert.equal(
    await f.resolve({ meta: { id: "tt4", type: "movie" }, imdbId: "tt4", tmdbKey: "key" }),
    "es",
  );
  assert.deepEqual(f.calls, { tmdb: 3, wikidata: 2, imdb: 1 });

  f.setImdb("");
  assert.equal(
    await f.resolve({ meta: { id: "tt5", type: "movie" }, imdbId: "tt5", tmdbKey: "key" }),
    "",
  );
});

test("playback resolves Original when the title metadata has no language", () => {
  const hook = readFileSync(
    new URL("../src/views/player/hooks/use-track-autoload.ts", import.meta.url),
    "utf8",
  );
  assert.match(hook, /includes\(ORIGINAL_AUDIO_LANG\)/);
  assert.match(hook, /resolveOriginalLanguage\(\{/);
  assert.match(hook, /originalLanguage: resolvedOriginal/);
  assert.match(hook, /trackPreferences\(playbackSrc, settings, prefs\)/);
  // Continue Watching hydrates from TMDB and used to drop the field.
  const hydrate = readFileSync(
    new URL("../src/views/library/hydrate-meta.ts", import.meta.url),
    "utf8",
  );
  assert.match(hydrate, /originalLanguage: j\.original_language/);
});
