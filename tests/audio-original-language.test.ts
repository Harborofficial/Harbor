import assert from "node:assert/strict";
import test from "node:test";
import { expandOriginalAudioLang, ORIGINAL_AUDIO_LANG } from "../src/lib/player/audio-language";
import { trackPreferences } from "../src/lib/player/track-preferences";

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
