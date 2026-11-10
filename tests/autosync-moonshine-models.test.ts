import assert from "node:assert/strict";
import test from "node:test";
import {
  moonshineMissingModelError,
  moonshineMissingModelLanguage,
  resolveMoonshineLanguage,
  isMoonshineLanguage,
  onMoonshineModelMissing,
  announceMoonshineModelMissing,
} from "../src/lib/subtitles/autosync/moonshine-models.ts";

test("auto selects only the active audio track, including ISO-639-2 tags", () => {
  assert.equal(resolveMoonshineLanguage("auto", "jpn"), "ja");
  assert.equal(resolveMoonshineLanguage("auto", "eng"), "en");
  assert.equal(resolveMoonshineLanguage("auto", "ara"), "ar");
  assert.equal(resolveMoonshineLanguage("auto", "deu"), "de");
  assert.equal(resolveMoonshineLanguage("auto", "vie"), "vi");
  assert.equal(resolveMoonshineLanguage("auto", "fil"), "tl");
  assert.equal(resolveMoonshineLanguage("auto", "zh-CN"), "zh");
  assert.equal(resolveMoonshineLanguage("auto", "es-MX"), "es");
});

test("unknown and unsupported audio never choose or download an unrelated model", () => {
  assert.equal(resolveMoonshineLanguage("auto", ""), null);
  assert.equal(resolveMoonshineLanguage("auto", "und"), null);
  assert.equal(resolveMoonshineLanguage("auto", "fra"), null);
  assert.equal(resolveMoonshineLanguage("auto", "kor"), null);
  assert.equal(resolveMoonshineLanguage(undefined, undefined), null);
  assert.equal(isMoonshineLanguage("und"), false);
});

test("manual override wins over the selected audio track", () => {
  assert.equal(resolveMoonshineLanguage("en", "jpn"), "en");
  assert.equal(resolveMoonshineLanguage("ja", "eng"), "ja");
  assert.equal(resolveMoonshineLanguage("auto", "eng"), "en");
  assert.equal(resolveMoonshineLanguage("ko", "eng"), null);
});

test("missing-model notifications are local, opt-in and unsubscribe cleanly", () => {
  const requested: string[] = [];
  const stop = onMoonshineModelMissing((language) => requested.push(language));
  announceMoonshineModelMissing("ja");
  assert.deepEqual(requested, ["ja"]);
  stop();
  announceMoonshineModelMissing("en");
  assert.deepEqual(requested, ["ja"]);
});

test("missing-model request only accepts known fixed language codes", () => {
  assert.equal(moonshineMissingModelLanguage(moonshineMissingModelError("ja")), "ja");
  assert.equal(moonshineMissingModelLanguage("moonshine-model-not-installed:../../../secret"), null);
  assert.equal(moonshineMissingModelLanguage("moonshine-model-not-installed:ko"), null);
  assert.equal(moonshineMissingModelLanguage("some other failure"), null);
});
