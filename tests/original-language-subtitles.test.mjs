import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { originalLanguageSubtitlePolicy } from "../src/lib/player/original-language-subtitles.ts";
import * as selection from "../src/lib/subtitles/track-selection.ts";
import * as language from "../src/lib/subtitles/language.ts";

function runTrackEffect({ original, tracks, manual = false, remembered = false }) {
  const meta = { id: "tt1", type: "movie", name: "Fixture", genres: [] };
  const effects = [];
  const writes = [];
  let stateSlot = 0;
  const mocks = {
    react: {
      useRef: (current) => ({ current }),
      useState: (initial) => [stateSlot++ === 3 ? { meta, language: original } : initial, () => {}],
      useEffect: (fn) => effects.push(fn),
    },
    "@/lib/player/original-language-subtitles": { originalLanguageSubtitlePolicy },
    "@/lib/subtitles/track-selection": selection,
    "@/lib/subtitles/language": language,
    "@/lib/player-prefs": { readPlayerPrefs: () => ({ subLang: "fr", subsOff: true }) },
    "@/lib/player/original-audio-language": { audioLanguageOrder: () => ["en"] },
    "@/lib/subtitles/subtitle-memory": {
      subtitleMediaKey: () => "fixture",
      readRememberedSub: () => (remembered ? { off: false } : null),
      rememberedSubAppliesToStream: () => remembered,
    },
    "@/lib/subtitles/autoload-run": { SubtitleAutoloadRunCoordinator: class {} },
  };
  const source = readFileSync(
    new URL("../src/views/player/hooks/use-track-autoload.ts", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name) => mocks[name] ?? {},
    mod,
    mod.exports,
  );
  mod.exports.useTrackAutoload({
    src: { url: "file:///fixture", meta },
    engine: "html5",
    authKey: null,
    settings: {
      englishSubsForForeignOriginal: true,
      preferredAudioLangs: ["en"],
      preferredSubLangs: ["fr"],
      preferredLanguages: ["fr"],
      subtitlesOffByDefault: true,
      forcedSubsWhenNativeAudio: true,
    },
    snap: { subtitleTracks: tracks, audioTracks: [], rate: 1 },
    bridgeRef: {
      current: {
        canAutoSelectSubtitle: () => !manual,
        setSubtitleTrack: (id) => writes.push(id),
        setAudioNormalize: () => {},
        setRate: () => {},
      },
    },
  });
  const trackEffect = effects.find((fn) => fn.toString().includes("audioIdSig"));
  assert.ok(trackEffect);
  trackEffect();
  return writes;
}

test("original language policy accepts English aliases and treats unknown metadata as off", () => {
  for (const lang of ["en", "eng", "English", null, ""])
    assert.equal(originalLanguageSubtitlePolicy(true, lang), "off");
  assert.equal(originalLanguageSubtitlePolicy(true, "ko"), "english");
  assert.equal(originalLanguageSubtitlePolicy(false, "ko"), "normal");
});

test("foreign original chooses embedded English over a stronger external match and saved preferences", () => {
  const tracks = [
    {
      id: "download",
      lang: "en",
      external: true,
      prepared: true,
      autoSelectionEligible: true,
      matchConfidence: "exact",
      selected: true,
    },
    { id: "embedded", lang: "eng", external: false },
  ];
  assert.deepEqual(runTrackEffect({ original: "ko", tracks, remembered: true }), ["embedded"]);
});

test("English originals and unknown metadata disable default enabled tracks", () => {
  for (const original of ["en", null])
    assert.deepEqual(
      runTrackEffect({ original, tracks: [{ id: "default", lang: "en", selected: true }] }),
      [null],
    );
});

test("external English is selected when no embedded English exists", () => {
  const tracks = [
    { id: "download", lang: "en", external: true, prepared: true, autoSelectionEligible: true },
  ];
  assert.deepEqual(runTrackEffect({ original: "fr", tracks }), ["download"]);
});

test("a foreign original does not enable a non-English or forced-only track", () => {
  assert.deepEqual(
    runTrackEffect({
      original: "ko",
      tracks: [
        { id: "wrong", lang: "fr", selected: true },
        { id: "forced", lang: "en", forced: true },
      ],
    }),
    [null],
  );
});

test("manual subtitle selections stay in control for both English and foreign originals", () => {
  for (const original of ["en", "ko"])
    assert.deepEqual(
      runTrackEffect({
        original,
        manual: true,
        tracks: [
          { id: "chosen", lang: "fr", selected: true },
          { id: "en", lang: "en" },
        ],
      }),
      [],
    );
});
