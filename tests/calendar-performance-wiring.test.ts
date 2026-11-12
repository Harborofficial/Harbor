// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";

const hook = readFileSync(
  new URL("../src/views/calendar/use-calendar-data.ts", import.meta.url),
  "utf8",
);
const sources = readFileSync(new URL("../src/lib/calendar-sources.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/views/calendar.tsx", import.meta.url), "utf8");
const webhookLoop = readFileSync(
  new URL("../src/components/webhook-loop-mount.tsx", import.meta.url),
  "utf8",
);
const webhookEngine = readFileSync(
  new URL("../src/lib/webhook-engine.ts", import.meta.url),
  "utf8",
);

test("calendar source implementations are loaded on demand", () => {
  assert.doesNotMatch(hook, /from ["']@\/lib\/calendar-sources["']/);
  assert.doesNotMatch(hook, /from ["']@\/lib\/calendar-library["']/);
  assert.match(hook, /import\(["']@\/lib\/calendar-library["']\)/);
  assert.match(hook, /import\(["']@\/lib\/calendar-sources["']\)/);
  assert.match(hook, /import\(["']@\/lib\/calendar["']\)/);

  assert.doesNotMatch(sources, /^import .*\.\/trakt\/calendar/m);
  assert.doesNotMatch(sources, /^import .*\.\/simkl\/(?:calendar|watchlist|session)/m);
  assert.doesNotMatch(sources, /^import .*\.\/anilist\/airing/m);
  assert.doesNotMatch(sources, /^import .*\.\/providers\/anime-dub-sub/m);
});

test("calendar view uses the light core module and defers Simkl premiere warmup", () => {
  assert.match(view, /from ["']@\/lib\/calendar-core["']/);
  assert.doesNotMatch(view, /from ["']@\/lib\/calendar["']/);
  assert.match(
    hook,
    /if \(!simklConnected \|\| source === "games" \|\| source === "simkl-anticipated" \|\| loading\) return;/,
  );
  assert.match(hook, /setTimeout\(\(\) => \{/);
  assert.doesNotMatch(webhookLoop, /^import .*webhook-engine/m);
  assert.match(webhookLoop, /import\(["']@\/lib\/webhook-engine["']\)/);
  assert.doesNotMatch(webhookEngine, /^import .*calendar-(?:library|sources)/m);
  assert.match(webhookEngine, /import\(["']\.\/calendar-library["']\)/);
  assert.match(webhookEngine, /import\(["']\.\/calendar-sources["']\)/);
});
