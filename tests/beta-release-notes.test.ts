// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import ts from "typescript";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const bundled = JSON.parse(read("src/lib/updater/bundled-release-notes.json"));

function harness() {
  const requests: { version: string; channel?: string }[] = [];
  const mocks: Record<string, unknown> = {
    "./github-releases": {
      githubReleaseNote: async (version: string, channel?: string) => {
        requests.push({ version, channel });
        return version === "1.0.1" ? { title: "GitHub note" } : null;
      },
    },
    "./bundled-release-notes.json": { default: bundled },
  };
  const module = { exports: {} };
  const output = ts.transpileModule(read("src/lib/updater/release-notes.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("require", "module", "exports", output)(
    (name: string) => {
      assert.ok(Object.hasOwn(mocks, name));
      return mocks[name];
    },
    module,
    module.exports,
  );
  return {
    api: module.exports as typeof import("../src/lib/updater/release-notes"),
    requests: () => requests,
  };
}

test("beta 0.9.125 notes are available without a GitHub request", async () => {
  const h = harness();
  assert.equal((await h.api.releaseNote("0.9.125"))?.title, "Harbor Beta 0.9.125");
  assert.equal(h.requests().length, 0);
  assert.equal(await h.api.releaseNote(null), null);
});

test("non-bundled notes come from GitHub with the requested channel", async () => {
  const h = harness();
  assert.equal((await h.api.releaseNote("1.0.1", "beta"))?.title, "GitHub note");
  assert.deepEqual(h.requests(), [{ version: "1.0.1", channel: "beta" }]);
  assert.equal(await h.api.releaseNote("0.999.3"), null);
  assert.deepEqual(h.requests(), [
    { version: "1.0.1", channel: "beta" },
    { version: "0.999.3", channel: undefined },
  ]);
});

test("bundled notes never substitute for another version", async () => {
  const h = harness();
  assert.equal(await h.api.releaseNote("0.9.124"), null);
  assert.equal(h.requests().length, 1);
});

test("beta notes include Talal's note and credits without advertising the private report system", () => {
  const note = bundled.notes["0.9.125"];
  assert.ok(note.sections.some((s: { heading: string }) => s.heading === "A note from Talal"));
  assert.match(JSON.stringify(note), /stable release will be published soon/);
  assert.doesNotMatch(JSON.stringify(note), /harborsystem\.online/i);
  assert.match(JSON.stringify(note), /Thunderhawkk/);
});
