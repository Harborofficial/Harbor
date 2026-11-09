import { extensionsModuleProblems } from "../../scripts/build-extensions-module.mjs";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER = resolve(HERE, "..");
const APP = resolve(INSTALLER, "..", "src-tauri");
const SETUP = join(INSTALLER, "src-tauri");
const UI = join(INSTALLER, "ui");
const STAGE = join(INSTALLER, "payload-stage");
const OUT_DIR = join(SETUP, "payload");
const OUT = join(OUT_DIR, "harbor-payload.zip");

const UNINSTALLER = join(SETUP, "target", "release", "harbor-uninstall.exe");
const UNINSTALLER_CEILING = 60 * 1048576;
const BUILD_UNINSTALLER =
  "cd installer/src-tauri && cargo build --release --no-default-features --bin harbor-uninstall";

const experimentalCore = process.env.HARBOR_MUSIC_CORE_EXE;
const skipPlugins = process.env.HARBOR_SKIP_PLUGINS === "1";
const skipGames = process.env.HARBOR_SKIP_GAMES === "1";
const skipMusic = process.env.HARBOR_SKIP_MUSIC === "1";
if (experimentalCore && process.env.HARBOR_MUSIC_MODULE_EXPERIMENTAL !== "1") {
  throw new Error("Alternate Harbor Music Core is allowed only in experimental module packaging");
}
const FILES = [
  [
    experimentalCore ? resolve(experimentalCore) : join(APP, "target", "release", "harbor.exe"),
    "harbor.exe",
  ],
  [join(APP, "THIRD-PARTY-NOTICES.txt"), "notices"],
  [join(APP, "binaries", "mpv-x86_64-pc-windows-msvc.exe"), "mpv.exe"],
  [join(APP, "binaries", "ffmpeg-x86_64-pc-windows-msvc.exe"), "ffmpeg.exe"],
  [join(APP, "binaries", "ffprobe-x86_64-pc-windows-msvc.exe"), "ffprobe.exe"],
  [join(APP, "binaries", "yt-dlp-x86_64-pc-windows-msvc.exe"), "yt-dlp.exe"],
  [join(APP, "libmpv", "libmpv-2.dll"), "libmpv-2.dll"],
  [UNINSTALLER, "uninstall.exe"],
];

// The NSIS bundle gets this from tauri.conf.json bundle.resources. This installer builds its own
// payload, so it has to be named here or extensions are dead in every managed install.
const CAPSTAN = join(APP, "resources", "capstan");
const capstanStaged = !skipPlugins && existsSync(join(CAPSTAN, "capstan.jar"));
if (capstanStaged) {
  const problems = extensionsModuleProblems(CAPSTAN, "x86_64-pc-windows-msvc");
  if (problems.length) throw new Error(problems.join("\n"));
}
if (!capstanStaged && !skipPlugins && !process.env.HARBOR_CAPSTAN_OPTIONAL) {
  console.error(
    "No extension runtime is staged, so this installer would ship broken extensions.\n",
  );
  console.error("  " + CAPSTAN + "\n");
  console.error(
    'Run "pnpm run setup:capstan" first, or set HARBOR_CAPSTAN_OPTIONAL=1 to ship without it.',
  );
  process.exit(1);
}

// The game engine is optional at build time the same way: ship it when it is staged, refuse to
// forget it silently, and let an explicit env var declare a build without it.
const POKEMON = join(APP, "resources", "pokemon-engine");
const pokemonStaged = !skipGames && existsSync(join(POKEMON, "Harbor.PokemonEngine.exe"));
if (!pokemonStaged && !skipGames && !process.env.HARBOR_POKEMON_OPTIONAL) {
  console.error("No game engine is staged, so this installer would ship tab-only games.\n");
  console.error("  " + POKEMON + "\n");
  console.error(
    "Build tools/pokemon-engine first, or set HARBOR_POKEMON_OPTIONAL=1 to ship without it.",
  );
  process.exit(1);
}

const missing = FILES.filter(([src]) => !existsSync(src)).map(([src]) => src);
if (missing.length) {
  console.error("Missing inputs.\n");
  missing.forEach((m) => console.error("  " + m));
  if (missing.includes(UNINSTALLER)) {
    console.error("\nThe uninstaller is built before the payload. Build it with:");
    console.error("  " + BUILD_UNINSTALLER);
  }
  if (missing.some((m) => m !== UNINSTALLER)) {
    console.error('\nFor the rest, run "pnpm tauri build" in the repo root first.');
  }
  process.exit(1);
}

function newestMtime(path, newest) {
  const info = statSync(path);
  if (!info.isDirectory()) return Math.max(newest, info.mtimeMs);
  let out = newest;
  for (const name of readdirSync(path)) {
    out = newestMtime(join(path, name), out);
  }
  return out;
}

function treeBytes(path) {
  const info = statSync(path);
  if (!info.isDirectory()) return info.size;
  return readdirSync(path).reduce((sum, name) => sum + treeBytes(join(path, name)), 0);
}

const uninstallerStat = statSync(UNINSTALLER);

if (uninstallerStat.size > UNINSTALLER_CEILING) {
  console.error(
    `The uninstaller is ${(uninstallerStat.size / 1048576).toFixed(0)} MB, which means it`,
  );
  console.error("was built with the payload feature on. Rebuild it with:");
  console.error("  " + BUILD_UNINSTALLER);
  process.exit(1);
}

const UNINSTALLER_INPUTS = [
  join(SETUP, "src"),
  join(SETUP, "Cargo.toml"),
  join(SETUP, "tauri.conf.json"),
  join(SETUP, "capabilities"),
  UI,
];

let newestSource = 0;
for (const input of UNINSTALLER_INPUTS) {
  newestSource = newestMtime(input, newestSource);
}

if (newestSource > uninstallerStat.mtimeMs) {
  console.error(
    "The built uninstaller is older than the sources it embeds, so bundling it now would",
  );
  console.error("ship a stale binary. Rebuild it with:");
  console.error("  " + BUILD_UNINSTALLER);
  process.exit(1);
}

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(STAGE, "fonts"), { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

let total = 0;
for (const [src, name] of FILES) {
  cpSync(src, join(STAGE, name));
  total += statSync(src).size;
}

const fontsDir = join(APP, "fonts");
for (const f of readdirSync(fontsDir)) {
  cpSync(join(fontsDir, f), join(STAGE, "fonts", f));
  total += statSync(join(fontsDir, f)).size;
}

if (capstanStaged) {
  cpSync(CAPSTAN, join(STAGE, "capstan"), { recursive: true });
  total += treeBytes(CAPSTAN);
} else if (skipPlugins) {
  console.error("EXTENSIONS SKIPPED BY REQUEST: no capstan component in this payload.");
} else {
  console.error("SHIPPING WITHOUT EXTENSION SUPPORT: no runtime staged at " + CAPSTAN);
}

if (pokemonStaged) {
  mkdirSync(join(STAGE, "resources"), { recursive: true });
  cpSync(POKEMON, join(STAGE, "resources", "pokemon-engine"), { recursive: true });
  total += treeBytes(POKEMON);
} else if (skipGames) {
  console.error("GAME ENGINE SKIPPED BY REQUEST: no pokemon-engine component in this payload.");
} else {
  console.error("SHIPPING WITHOUT THE GAME ENGINE: no engine staged at " + POKEMON);
}

// A genuine Music module will be staged here once its native interface is
// extracted from the core. Never package a placeholder or another Harbor build.
const musicModule = process.env.HARBOR_MUSIC_MODULE_DIR
  ? resolve(process.env.HARBOR_MUSIC_MODULE_DIR)
  : join(APP, "resources", "music-module");
const appVersion = JSON.parse(readFileSync(join(APP, "tauri.conf.json"), "utf8")).version;
if (!skipMusic && existsSync(musicModule)) {
  // Only a dedicated sidecar Core build may package the Music module: the default
  // core already embeds legacy Music, so a staged module would be a second engine.
  if (!experimentalCore) {
    console.error(
      "IGNORING STAGED MUSIC MODULE: the default core already includes legacy Music. " +
        "Set HARBOR_MUSIC_CORE_EXE for a sidecar core to package it.",
    );
  } else {
    // The component host is not wired into harbor.exe yet. Refuse accidental
    // release of a seemingly installable but non-functional DLL.
    if (process.env.HARBOR_MUSIC_MODULE_EXPERIMENTAL !== "1") {
      throw new Error(
        "Music runtime loading is not implemented; refusing to ship the staged module",
      );
    }
    const manifestPath = join(musicModule, "music-module.json");
    const libraryPath = join(musicModule, "harbor-music-module.exe");
    if (!existsSync(manifestPath) || !existsSync(libraryPath)) {
      throw new Error(
        "Music module is incomplete; expected music-module.json and harbor-music-module.exe",
      );
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
    if (manifest.version !== appVersion || manifest.abi !== 1 || manifest.kind !== "harbor-music") {
      throw new Error("Music module has an incompatible version, ABI or type");
    }
    const staged = join(STAGE, "components", "music");
    mkdirSync(dirname(staged), { recursive: true });
    cpSync(musicModule, staged, { recursive: true });
    total += treeBytes(musicModule);
  }
} else if (skipMusic) {
  console.error("MUSIC COMPONENT SKIPPED BY REQUEST: no components/music in this payload.");
}

if (!appVersion) {
  console.error("Cannot read version from src-tauri/tauri.conf.json");
  process.exit(1);
}
writeFileSync(join(OUT_DIR, "version.txt"), appVersion, "utf8");
console.log(`payload version: ${appVersion}`);

rmSync(OUT, { force: true });
execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Compress-Archive -Path '${STAGE}\\*' -DestinationPath '${OUT}' -CompressionLevel Optimal -Force`,
  ],
  { stdio: "inherit" },
);

rmSync(STAGE, { recursive: true, force: true });

const zipped = statSync(OUT).size;
const mb = (n) => (n / 1048576).toFixed(0) + " MB";
console.log(`\npayload ready: ${OUT}`);
console.log(`  ${mb(total)} of files compressed to ${mb(zipped)}`);
console.log(
  `  uninstall.exe ${mb(uninstallerStat.size)}, built ${new Date(uninstallerStat.mtimeMs).toISOString()}`,
);
