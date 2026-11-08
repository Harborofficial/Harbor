import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import "./_localstorage-stub.ts";
import { DEFAULT } from "../src/lib/settings/defaults.ts";
import {
  MIRROR_KEY,
  SHARED_KEY,
  loadEffective,
  persistEffective,
  recoverSettingsFile,
} from "../src/lib/settings/profile-store.ts";

test("restart recovers the disk copy when quota leaves old browser settings behind", () => {
  localStorage.clear();
  const old = JSON.stringify({ ...DEFAULT, seekrApiKey: "old-fixture" });
  localStorage.setItem(SHARED_KEY, old);
  localStorage.setItem(MIRROR_KEY, old);
  const setItem = localStorage.setItem;
  localStorage.setItem = () => {
    throw new DOMException("Full", "QuotaExceededError");
  };
  try {
    const disk = persistEffective({ ...DEFAULT, seekrApiKey: "new-fixture" }, "default", true);
    assert.equal(localStorage.getItem(SHARED_KEY), old);
    const restored = recoverSettingsFile(disk, "default", true);
    assert.equal(restored?.seekrApiKey, "new-fixture");
    assert.equal(localStorage.getItem(SHARED_KEY), old);
  } finally {
    localStorage.setItem = setItem;
    localStorage.clear();
  }
});

test("disk recovery preserves newer browser edits and isolates unlinked profiles", () => {
  localStorage.clear();
  const disk = persistEffective({ ...DEFAULT, seekrApiKey: "fixture" }, "alice", false);
  assert.equal(recoverSettingsFile(disk, "bob", false), null);
  assert.equal(recoverSettingsFile(disk, "bob", true), null);
  const newer = { ...JSON.parse(disk), _savedAt: Date.now() + 10000 };
  localStorage.setItem("harbor.settings.alice", JSON.stringify(newer));
  assert.equal(recoverSettingsFile(disk, "alice", false), null);
  localStorage.clear();
});

test("legacy disk files recover only when browser settings are absent", () => {
  localStorage.clear();
  const disk = JSON.stringify({ ...DEFAULT, seekrApiKey: "legacy-fixture" });
  assert.equal(recoverSettingsFile(disk, "default", true)?.seekrApiKey, "legacy-fixture");
  assert.equal(recoverSettingsFile(disk, "default", true), null);
  assert.equal(recoverSettingsFile("[]", "default", true), null);
  assert.equal(recoverSettingsFile("invalid", "default", true), null);
  localStorage.clear();
});

test("an immediate close after settings edits keeps the thumbnail and Seek key", () => {
  localStorage.clear();
  persistEffective(
    { ...DEFAULT, seekrApiKey: "dummy-seek", spoilerHideThumbnails: false },
    "default",
    true,
  );

  // No disk-write wait or debounce: this is the state when the window closes.
  const reopened = loadEffective("default", true);
  assert.equal(reopened.seekrApiKey, "dummy-seek");
  assert.equal(reopened.spoilerHideThumbnails, false);
  localStorage.clear();
});

test("a failed disk write leaves the newer browser copy as the restart source", () => {
  localStorage.clear();
  persistEffective({ ...DEFAULT, seekrApiKey: "browser-new" }, "default", true);

  // No disk file exists after the failed write; recovery has nothing to restore.
  assert.equal(recoverSettingsFile(null, "default", true), null);
  assert.equal(loadEffective("default", true).seekrApiKey, "browser-new");
  localStorage.clear();
});

test("native writes start without a debounce and cannot finish out of order", async () => {
  const code = ts.transpileModule(
    readFileSync(new URL("../src/lib/settings/file-store.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const started: string[] = [];
  let finish!: () => void;
  const module = { exports: {} as { writeSettingsFile: (value: string) => Promise<void> } };
  new Function("require", "module", "exports", "window", code)(
    () => ({
      invoke: async (_command: string, { content }: { content: string }) => {
        started.push(content);
        if (content === "first")
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
      },
    }),
    module,
    module.exports,
    { __TAURI_INTERNALS__: {} },
  );
  const first = module.exports.writeSettingsFile("first");
  const second = module.exports.writeSettingsFile("second");
  await Promise.resolve();
  assert.deepEqual(started, ["first"]);
  finish();
  await Promise.all([first, second]);
  assert.deepEqual(started, ["first", "second"]);
});
