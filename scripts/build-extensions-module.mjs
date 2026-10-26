import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { hostTriple } from "./capstan-jdk.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const crate = join(repo, "src-tauri/extensions-module");
const dest = join(repo, "src-tauri/resources/capstan");
export const extensionsModuleName = (target) =>
  target.includes("windows") ? "harbor-extensions-module.exe" : "harbor-extensions-module";

export function extensionsModuleProblems(directory, target) {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, "extensions-module.json"), "utf8"));
    const version = JSON.parse(
      readFileSync(join(repo, "src-tauri/tauri.conf.json"), "utf8"),
    ).version;
    if (
      manifest.kind !== "harbor-extensions" ||
      manifest.abi !== 2 ||
      manifest.version !== version ||
      manifest.target !== target
    ) {
      return ["Extensions module version, ABI or target mismatch"];
    }
    const bytes = readFileSync(join(directory, extensionsModuleName(target)));
    if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) {
      return ["Extensions module checksum mismatch"];
    }
    return [];
  } catch (error) {
    return [`Extensions module is missing or incomplete: ${error.message}`];
  }
}

export function buildExtensionsModule(target = hostTriple()) {
  const version = JSON.parse(readFileSync(join(repo, "src-tauri/tauri.conf.json"), "utf8")).version;
  const crateVersion = /^version = "([^"]+)"/m.exec(
    readFileSync(join(crate, "Cargo.toml"), "utf8"),
  )?.[1];
  if (crateVersion !== version) throw new Error("Extensions module and Harbor versions must match");
  const targetDir = join(crate, "target");
  execFileSync(
    "cargo",
    [
      "build",
      "--manifest-path",
      join(crate, "Cargo.toml"),
      "--locked",
      "--release",
      "--target",
      target,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, CARGO_TARGET_DIR: targetDir },
    },
  );
  mkdirSync(dest, { recursive: true });
  const executable = join(dest, extensionsModuleName(target));
  copyFileSync(join(targetDir, target, "release", extensionsModuleName(target)), executable);
  const sha256 = createHash("sha256").update(readFileSync(executable)).digest("hex");
  writeFileSync(
    join(dest, "extensions-module.json"),
    JSON.stringify({ kind: "harbor-extensions", abi: 2, version, target, sha256 }, null, 2) + "\n",
  );
  // Keep the existing Capstan inventory accurate when updating just the native module.
  if (existsSync(join(dest, "STAGE.json"))) {
    const walk = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    const files = walk(dest)
      .map((path) => ({
        path: relative(dest, path).replaceAll("\\", "/"),
        bytes: statSync(path).size,
      }))
      .filter((file) => !["MANIFEST.txt", "STAGE.json"].includes(file.path))
      .sort((a, b) => a.path.localeCompare(b.path));
    writeFileSync(
      join(dest, "MANIFEST.txt"),
      files.map((file) => `${String(file.bytes).padStart(10)}  ${file.path}`).join("\n") + "\n",
    );
    const plan = JSON.parse(readFileSync(join(dest, "STAGE.json"), "utf8"));
    writeFileSync(
      join(dest, "STAGE.json"),
      JSON.stringify(
        { ...plan, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) },
        null,
        2,
      ) + "\n",
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildExtensionsModule(process.argv[2] ?? hostTriple());
}
