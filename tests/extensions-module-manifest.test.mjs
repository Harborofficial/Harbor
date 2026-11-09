import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  extensionsModuleName,
  extensionsModuleProblems,
} from "../scripts/build-extensions-module.mjs";

const target = "x86_64-pc-windows-msvc";
const version = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
).version;

test("Extensions packaging requires matching module bytes, ABI, version and target", () => {
  const dir = mkdtempSync(join(tmpdir(), "harbor-extension-manifest-"));
  const bytes = Buffer.from("test native component");
  const manifest = {
    kind: "harbor-extensions",
    abi: 2,
    version,
    target,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const save = (value) => writeFileSync(join(dir, "extensions-module.json"), JSON.stringify(value));
  try {
    assert.ok(extensionsModuleProblems(dir, target).length);
    writeFileSync(join(dir, extensionsModuleName(target)), bytes);
    save(manifest);
    assert.deepEqual(extensionsModuleProblems(dir, target), []);
    for (const changed of [
      { abi: 3 },
      { kind: "harbor-music" },
      { version: "0.0.0" },
      { target: "aarch64-apple-darwin" },
    ]) {
      save({ ...manifest, ...changed });
      assert.ok(extensionsModuleProblems(dir, target).length);
    }
    save(manifest);
    writeFileSync(join(dir, extensionsModuleName(target)), "corrupted component");
    assert.deepEqual(extensionsModuleProblems(dir, target), [
      "Extensions module checksum mismatch",
    ]);
    rmSync(join(dir, extensionsModuleName(target)));
    assert.ok(extensionsModuleProblems(dir, target).length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
