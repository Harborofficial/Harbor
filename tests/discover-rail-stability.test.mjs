import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("loading a catalog preserves unchanged rails but propagates metadata and dedup changes", () => {
  const source = readFileSync(
    new URL("../src/views/discover/use-deduped-rows.ts", import.meta.url),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const previous = { current: {} };
  new Function("require", "exports", code)(
    () => ({ useMemo: (fn) => fn(), useRef: () => previous }),
    exports,
  );
  const meta = (id) => ({ id, name: id, poster: `https://example.com/${id}.jpg` });
  const a = Array.from({ length: 18 }, (_, i) => meta(`a${i}`));
  const b = [a[0], ...Array.from({ length: 18 }, (_, i) => meta(`b${i}`))];
  const order = ["a", "b"];
  const run = (rails, featured = new Set()) =>
    exports.useDedupedRows(rails, order, featured, undefined, []);
  const first = run({ a });
  const loaded = run({ a, b });
  assert.equal(loaded.a, first.a);
  assert.equal(loaded.b.includes(a[0]), false);
  const refreshedA = [{ ...a[0], name: "Updated" }, ...a.slice(1)];
  const refreshed = run({ a: refreshedA, b });
  assert.notEqual(refreshed.a, loaded.a);
  assert.equal(refreshed.a[0].name, "Updated");
  assert.equal(refreshed.b, loaded.b);
  const featured = run({ a: refreshedA, b }, new Set(["a0"]));
  assert.notEqual(featured.a, refreshed.a);
  assert.equal(
    featured.a.some((m) => m.id === "a0"),
    false,
  );
});
