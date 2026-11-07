// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Theme Studio keeps a reset baseline that follows the selected starting preset", () => {
  const studio = read("src/views/settings/theme-panel/theme-studio.tsx");

  assert.match(studio, /const \[resetBaseline, setResetBaseline\] = useState\(\(\) => initialDraft\)/);
  assert.match(studio, /const seeded = emptyDraft\(t, draft\.navCustomization\);/);
  assert.match(studio, /setResetBaseline\(seeded\);\s*setDraft\(seeded\);/);
  assert.match(studio, /baseline=\{resetBaseline\}/);
});

test("layout and navigation sections can reset without replacing the whole theme", () => {
  const inspector = read("src/views/settings/theme-panel/theme-studio/inspector.tsx");

  assert.match(inspector, /onPatch\(\{ layout: baseline\.layout \}\)/);
  assert.match(inspector, /order: \[\.\.\.baseline\.navCustomization\.order\]/);
  assert.match(inspector, /hidden: \[\.\.\.baseline\.navCustomization\.hidden\]/);
  assert.match(inspector, /renamed: \{ \.\.\.baseline\.navCustomization\.renamed \}/);
});

test("custom chrome exposes resets for each visual layout option", () => {
  const builder = read(
    "src/views/settings/theme-panel/theme-studio/custom-chrome-builder.tsx",
  );

  assert.match(builder, /position: resetConfig\.position/);
  assert.match(builder, /brand: resetConfig\.brand/);
  assert.match(builder, /items: \[\.\.\.resetConfig\.items\]/);
  assert.match(builder, /labels: resetConfig\.labels/);
  assert.match(builder, /icons: resetConfig\.icons/);
});
