import assert from "node:assert/strict";
import test from "node:test";
import { addWhisperFeature, shouldEnableWindowsWhisper } from "../scripts/tauri-args.mjs";

test("regular Windows desktop Tauri commands enable Whisper automatically", () => {
  assert.equal(shouldEnableWindowsWhisper("win32", ["dev"]), true);
  assert.equal(shouldEnableWindowsWhisper("win32", ["build", "--no-bundle"]), true);
  assert.deepEqual(addWhisperFeature(["dev"]), ["dev", "--features", "asr-whisper"]);
  assert.deepEqual(addWhisperFeature(["build", "--no-bundle"]), [
    "build", "--no-bundle", "--features", "asr-whisper",
  ]);
});

test("existing Cargo feature flags are preserved without duplicating Whisper", () => {
  assert.deepEqual(addWhisperFeature(["dev", "--features", "games,music"]), [
    "dev", "--features", "games,music,asr-whisper",
  ]);
  assert.deepEqual(addWhisperFeature(["dev", "--features=plugins"]), [
    "dev", "--features=plugins,asr-whisper",
  ]);
  assert.deepEqual(addWhisperFeature(["build", "-f", "asr-whisper,music"]), [
    "build", "-f", "asr-whisper,music",
  ]);
  assert.deepEqual(addWhisperFeature(["dev", "--", "file.mkv"]), [
    "dev", "--features", "asr-whisper", "--", "file.mkv",
  ]);
});

test("non-Windows, help and unrelated Tauri commands are unchanged", () => {
  for (const platform of ["linux", "darwin"]) {
    assert.equal(shouldEnableWindowsWhisper(platform, ["dev"]), false);
    assert.equal(shouldEnableWindowsWhisper(platform, ["build"]), false);
  }
  for (const args of [["android", "dev"], ["ios", "dev"], ["info"], ["dev", "--help"], ["build", "-h"]]) {
    assert.equal(shouldEnableWindowsWhisper("win32", args), false);
  }
});
