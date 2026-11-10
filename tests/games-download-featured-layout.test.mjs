import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/views/games/game-downloads.css", import.meta.url), "utf8");
const card = readFileSync(
  new URL("../src/views/games/game-download-group-card.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("../src/views/games/game-downloads.tsx", import.meta.url),
  "utf8",
);

test("featured cards size to their own content, not the tallest group in the grid", () => {
  assert.ok(css.includes(".games-download-feature-grid{display:grid;"));
  assert.ok(css.includes("align-items:start"));
  const start = css.indexOf(".games-download-feature-grid>.games-download-bundle{");
  assert.ok(start !== -1, "Expected a featured group grid-item rule");
  const rule = css.slice(start, css.indexOf("}", start));
  assert.ok(rule.includes("align-self:start"));
  assert.ok(!rule.includes("height:100%"));
  assert.ok(card.includes("const [expanded, setExpanded] = useState(false)"));
  assert.ok(page.includes("<GameDownloadGroupCard key={group.key}"));
});

test("top-left disclosure arrow points down when collapsed and up when open", () => {
  assert.ok(
    css.includes(
      ".games-download-bundle-chevron{position:absolute;inset-block-start:12px;inset-inline-start:12px",
    ),
  );
  assert.ok(css.includes(".games-download-bundle-chevron.is-expanded{transform:rotate(180deg)}"));
  const arrow = card.indexOf("<ChevronDown");
  const artwork = card.indexOf("!featured && <DownloadArtwork");
  assert.ok(arrow > 0 && artwork > arrow, "Disclosure must precede the game's artwork");
});

test("featured games without artwork keep the same hero dimensions and controls", () => {
  assert.ok(card.includes("games-download-bundle is-featured has-banner"));
  assert.ok(card.includes("no-artwork"));
  assert.ok(card.includes('className={"games-download-bundle-hero"'));
  assert.ok(card.includes("Gamepad2"));
  assert.ok(css.includes(".games-download-bundle-hero.is-placeholder"));
  assert.ok(css.includes(".games-download-bundle.has-banner .games-download-bundle-top"));
  assert.ok(css.includes("min-height: 220px"));
  assert.ok(css.includes("min-height: 268px"));
  assert.ok(!card.includes("!showBanner && <DownloadArtwork"));
});

test("featured slots do not reconcile saved positions before the first download list arrives", () => {
  const workspace = readFileSync(new URL("../src/views/games/index.tsx", import.meta.url), "utf8");
  assert.match(
    workspace,
    /featuredBundles\.length\s*>\s*0\s*&&\s*!downloads\.loading\s*&&\s*!downloads\.torrents\.loading/,
  );
  assert.ok(workspace.includes("useGameFeaturedDownloads"));
  assert.ok(page.includes("placeFeaturedDownloads"));
});
