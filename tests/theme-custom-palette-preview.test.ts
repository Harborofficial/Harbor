// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("custom palette preview restores the previously active theme when abandoned", () => {
  const editor = read("src/views/settings/theme-panel/custom-editor.tsx");

  assert.match(editor, /const restoreRef = useRef\(restoreTheme\)/);
  assert.match(editor, /if \(!finishedRef\.current\) applyTheme\(restoreRef\.current\)/);
  assert.match(editor, /id: "theme-custom-back"/);
  assert.match(editor, /applyTheme\(restoreRef\.current\);\s*finishedRef\.current = true;/);
});

test("saving or deleting the custom palette does not restore the old preview", () => {
  const editor = read("src/views/settings/theme-panel/custom-editor.tsx");

  assert.match(editor, /finishedRef\.current = true;\s*live\.current\.onSave/);
  assert.match(editor, /finishedRef\.current = true;\s*live\.current\.onDelete/);
});

test("every custom palette color can be reset independently", () => {
  const editor = read("src/views/settings/theme-panel/custom-editor.tsx");

  assert.match(editor, /resetValue=\{seed\[f\.key\]\}/);
  assert.match(editor, /onClick=\{\(\) => onChange\(resetValue\)\}/);
});
