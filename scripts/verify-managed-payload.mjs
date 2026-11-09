import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync } from "fflate";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const version = JSON.parse(read("src-tauri/tauri.conf.json")).version;
assert.equal(read("installer/src-tauri/payload/version.txt").toString().trim(), version);
const payload = read("installer/src-tauri/payload/harbor-payload.zip");
const experimentalCore = process.env.HARBOR_MUSIC_CORE_EXE;
const skipMusic = process.env.HARBOR_SKIP_MUSIC === "1";
const musicBinary = "components/music/harbor-music-module.exe";
const musicModuleExe = process.env.HARBOR_MUSIC_MODULE_DIR
  ? resolve(process.env.HARBOR_MUSIC_MODULE_DIR, "harbor-music-module.exe")
  : new URL("../src-tauri/resources/music-module/harbor-music-module.exe", import.meta.url);
const extensionsBinary = "capstan/harbor-extensions-module.exe";
const extensionsManifest = "capstan/extensions-module.json";
const entries = unzipSync(payload, {
  filter: ({ name }) => {
    const canonical = name.replaceAll("\\", "/");
    return (
      canonical === "harbor.exe" ||
      canonical === "uninstall.exe" ||
      canonical === musicBinary ||
      canonical === extensionsBinary ||
      canonical === extensionsManifest ||
      canonical === "capstan/capstan.jar" ||
      canonical.startsWith("variants/")
    );
  },
});
const canonicalEntries = Object.fromEntries(
  Object.entries(entries).map(([name, bytes]) => [name.replaceAll("\\", "/"), bytes]),
);
assert.ok(canonicalEntries["harbor.exe"], "Missing Harbor Core executable");
assert.ok(canonicalEntries["uninstall.exe"], "Missing uninstaller");
assert.equal(
  hash(canonicalEntries["harbor.exe"]),
  hash(
    experimentalCore ? readFileSync(experimentalCore) : read("src-tauri/target/release/harbor.exe"),
  ),
  "Stale or wrong Harbor Core payload",
);
assert.equal(
  hash(canonicalEntries["uninstall.exe"]),
  hash(read("installer/src-tauri/target/release/harbor-uninstall.exe")),
  "Stale uninstaller payload",
);
assert.ok(
  !Object.keys(canonicalEntries).some((name) => name.startsWith("variants/")),
  "A second Harbor executable variant was accidentally embedded",
);
if (canonicalEntries["capstan/capstan.jar"]) {
  assert.ok(canonicalEntries[extensionsBinary], "Optional native Extensions module is missing");
  assert.ok(canonicalEntries[extensionsManifest], "Extensions module manifest is missing");
  const manifest = JSON.parse(Buffer.from(canonicalEntries[extensionsManifest]).toString("utf8"));
  assert.equal(manifest.kind, "harbor-extensions");
  assert.equal(manifest.abi, 2);
  assert.equal(manifest.version, version);
  assert.equal(manifest.target, "x86_64-pc-windows-msvc");
  assert.equal(
    hash(canonicalEntries[extensionsBinary]),
    manifest.sha256,
    "Extensions module checksum mismatch",
  );
  assert.equal(
    hash(canonicalEntries[extensionsBinary]),
    hash(read("src-tauri/resources/capstan/harbor-extensions-module.exe")),
    "Stale Extensions module payload",
  );
}
if (experimentalCore && !skipMusic) {
  assert.ok(canonicalEntries[musicBinary], "Optional native Music module is missing");
  assert.equal(
    hash(canonicalEntries[musicBinary]),
    hash(readFileSync(musicModuleExe)),
    "Music module in payload is stale",
  );
}
if (skipMusic) {
  assert.ok(!canonicalEntries[musicBinary], "Music payload present even though Music was skipped");
}
if (process.argv.includes("--embedded")) {
  const installer = read("installer/src-tauri/target/release/harbor-shipyard.exe");
  assert.ok(installer.indexOf(payload) >= 0, "Installer does not embed the verified payload");
}
console.log("Managed payload verified for " + version + "; SHA-256 " + hash(payload));
