// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  installerFileName,
  installerMode,
  payloadVersionFor,
  resumedInstallerPhase,
  type InstallerPlatform,
} from "../src/lib/updater/installer-plan.ts";

const ENTRY = {
  version: "1.0.1",
  win: "https://github.com/Harborofficial/Harbor/releases/download/v1.0.1-beta/harbor-shipyard-v1.0.1-beta.exe",
  winSig:
    "https://github.com/Harborofficial/Harbor/releases/download/v1.0.1-beta/harbor-shipyard-v1.0.1-beta.exe.sig",
  mac: "https://github.com/Harborofficial/Harbor/releases/download/v1.0.1-beta/Harbor_1.0.1_aarch64.dmg",
};

const WINDOWS: InstallerPlatform = { tauri: true, windows: true, mac: false };
const MAC: InstallerPlatform = { tauri: true, windows: false, mac: true };
const WEB: InstallerPlatform = { tauri: false, windows: false, mac: false };

test("payload versions match Harbor Shipyard's numeric marker", () => {
  assert.equal(payloadVersionFor("1.0.1"), 1_000_001);
  assert.equal(payloadVersionFor("0.9.128"), 9_128);
  for (const version of ["1.0", "1.0.1-beta", "v1.0.1", "1.0.1000", "__proto__"]) {
    assert.equal(payloadVersionFor(version), null);
  }
});

test("signed Windows builds use the verified in-app installer", () => {
  assert.equal(installerMode(ENTRY, WINDOWS), "verified");
});

test("unsigned Windows builds download in app without running", () => {
  assert.equal(installerMode({ ...ENTRY, winSig: undefined }, WINDOWS), "download");
});

test("macOS downloads the disk image in app", () => {
  assert.equal(installerMode(ENTRY, MAC), "download");
});

test("web builds and builds without an installer stay in the browser", () => {
  assert.equal(installerMode(ENTRY, WEB), "browser");
  assert.equal(installerMode({ version: "1.0.1" }, WINDOWS), "browser");
  assert.equal(installerMode({ version: "1.0.1" }, MAC), "browser");
  assert.equal(
    installerMode({ version: "1.0", win: ENTRY.win, winSig: ENTRY.winSig }, WINDOWS),
    "download",
  );
});

test("reloading restores a downloaded installer instead of offering it again", () => {
  assert.equal(resumedInstallerPhase("verified", true, false), "staged");
  assert.equal(resumedInstallerPhase("verified", false, true), "saved");
  assert.equal(resumedInstallerPhase("verified", false, false), "idle");
  assert.equal(resumedInstallerPhase("download", false, true), "saved");
  assert.equal(resumedInstallerPhase("download", false, false), "idle");
  assert.equal(resumedInstallerPhase("browser", false, true), "idle");
});

test("installer file names come from the asset URL and stay filesystem safe", () => {
  assert.equal(installerFileName(ENTRY.mac), "Harbor_1.0.1_aarch64.dmg");
  assert.equal(
    installerFileName("https://example.com/download/Harbor%20Setup%3A1.0.1.exe?token=abc#frag"),
    "Harbor Setup_1.0.1.exe",
  );
  assert.equal(installerFileName("https://example.com/releases/"), "harbor-installer");
});
