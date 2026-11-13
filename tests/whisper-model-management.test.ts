import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Windows Harbor builds enable Whisper without changing Linux build flags", () => {
  const modules = read("scripts/build-shipyard-modules.ps1");
  const modularMusic = read("scripts/build-shipyard-modular-music.ps1");
  const shipyard = read("scripts/build-shipyard.ps1");
  const release = read("scripts/release-beta.ps1");
  const dev = read("scripts/dev-whisper.ps1");
  const helper = read("scripts/whisper-build-env.ps1");
  assert.match(modules, /music-sidecar,asr-whisper,tauri\/custom-protocol/);
  assert.match(modularMusic, /music-sidecar,asr-whisper,tauri\/custom-protocol/);
  for (const script of [shipyard, release]) {
    assert.match(script, /'build', '--no-bundle', '--features', 'asr-whisper'/);
  }
  for (const script of [modules, modularMusic, shipyard, release]) {
    assert.match(script, /whisper-build-env\.ps1/);
  }
  assert.match(helper, /LIBCLANG_PATH/);
  assert.match(helper, /libclang==18\.1\.1/);
  assert.match(dev, /pnpm tauri dev/);
  const tauriEntry = read("scripts/tauri.mjs");
  assert.match(tauriEntry, /shouldEnableWindowsWhisper/);
  assert.match(tauriEntry, /tauri-whisper-run\.ps1/);
  const tauriRunner = read("scripts/tauri-whisper-run.ps1");
  assert.match(tauriRunner, /whisper-build-env\.ps1/);
  assert.match(tauriRunner, /\[string\[\]\]\(ConvertFrom-Json/);
});

test("Whisper model has explicit download, status, remove and integrity verification", () => {
  const rust = read("src-tauri/src/asr_model.rs");
  const commands = read("src-tauri/src/lib.rs");
  const panel = read("src/views/settings/whisper-model-row.tsx");
  const syncPanel = read("src/views/settings/autosync-panel.tsx");
  for (const name of ["asr_model_status", "asr_model_download", "asr_model_remove"]) {
    assert.match(rust, new RegExp(`fn ${name}\\(`));
    assert.match(commands, new RegExp(`asr_model::${name}`));
    assert.match(panel, new RegExp(`"${name}"`));
  }
  assert.match(rust, /MODEL_WRITE_LOCK/);
  assert.match(rust, /MODEL_SHA256/);
  assert.match(rust, /speech model failed integrity verification/);
  assert.match(rust, /std::fs::rename\(&part, &dest\)/);
  assert.match(rust, /asr_model_path\(app\)/);
  assert.doesNotMatch(
    rust.split("pub async fn asr_ensure_model")[1]?.split("#\[tauri::command\]")[0] ?? "",
    /\.get\(MODEL_URL/,
  );
  assert.match(panel, /listen<\[number, number\]>\("asr-model:\/\/progress"/);
  assert.match(panel, /<progress\b/);
  assert.match(syncPanel, /<MoonshineModelRow \/>/);
});
