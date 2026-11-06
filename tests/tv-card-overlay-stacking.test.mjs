import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const jsx = (type, props) => ({ type, props });
const runtime = { jsx, jsxs: jsx, Fragment: "fragment" };

function load(file, mocks) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => mocks[name] ?? {}, exports);
  return exports;
}

const shared = {
  showTop10: false,
  inCinema: false,
  rerun: false,
  newBadge: null,
  hasDub: false,
  watched: false,
  inWatchlist: false,
  inLocalLibrary: false,
};
const card = {
  badgePlacement: "top",
  cardAwardDisplay: "none",
  showCardBadges: false,
  showWatchedBadge: false,
  showLocalLibraryBadge: false,
  top10RibbonSide: "left",
  watchlistBadge: "off",
};

function walk(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, out));
  } else if (node && typeof node === "object") {
    out.push(node);
    walk(node.props?.children, out);
  }
  return out;
}

function renderCard({
  curated = false,
  isAnime = true,
  settings = {},
  state = {},
  scoreBadges = [{ kind: "rating", source: "mal", value: "8.8" }],
  award = false,
} = {}) {
  function ScoreStack() {}
  const { stackTop } = load("src/components/card-status-badges.tsx", {
    "react/jsx-runtime": runtime,
  });
  const { TvCardArtwork } = load("src/components/tv-card.tsx", {
    react: {
      memo: (component) => component,
      useState: (value) => [typeof value === "function" ? value() : value, () => {}],
      useEffect: () => {},
    },
    "react/jsx-runtime": runtime,
    "@/lib/settings": {
      useSettings: () => ({ settings: { tvCardLogoPos: "bottomStart", tvCardOptions: {} } }),
    },
    "@/lib/img-size": { sizeImageUrl: (url) => url },
    "@/lib/card-anime": { isCardAnimeId: (id) => id.startsWith("kitsu:") },
    "@/lib/i18n": { useT: () => (message) => message },
    "@/lib/anime-awards": {
      parseAwardYear: () => 2025,
      findTopAward: () => (award ? { year: 2025, source: "crunchyroll" } : null),
    },
    "@/components/card-award": {
      useClassicAwardWin: () => (award && !isAnime ? { type: "oscar", wins: 1 } : null),
    },
    "@/components/card-score-stack": { ScoreStack },
    "@/components/card-status-badges": { stackTop },
    "@/lib/providers/anime-hero-art-static": {
      peekStaticHeroArt: () => null,
      ensureStaticHeroArt: async () => {},
    },
  });

  const nodes = walk(
    TvCardArtwork({
      meta: { id: isAnime ? "kitsu:1" : "tt123", name: "Example", type: "series", poster: "p" },
      isAnime,
      curatedBadgeAtTopStart: curated,
      cardSettings: { ...card, ...settings },
      sharedState: { ...shared, ...state },
      scoreBadges,
      posterSrc: "p",
    }),
  );
  const score = nodes.find((n) => n.type === ScoreStack);
  const dub = nodes.find((n) => n.props?.children === "DUB");
  const bookmark = nodes.find(
    (n) =>
      typeof n.props?.className === "string" &&
      n.props.className.includes("z-20 grid h-6 w-6") &&
      n.props.className.includes("text-ink"),
  );
  return { nodes, score, dub, bookmark };
}

test("curated TV DUB badge leaves the first top-right score slot free", () => {
  const { score, dub } = renderCard({ curated: true, state: { hasDub: true } });
  assert.match(dub.props.className, /end-2 top-2/);
  assert.equal(score.props.topClass, "top-[34px]");
});

test("top-right ribbon pushes scores down even on ordinary TV cards", () => {
  const { score } = renderCard({
    settings: { top10RibbonSide: "right" },
    state: { showTop10: true },
  });
  assert.equal(score.props.topClass, "top-[48px]");
});

test("curated TV ribbon, DUB, status and award each reserve a score slot", () => {
  const { score, dub, bookmark } = renderCard({
    curated: true,
    award: true,
    settings: {
      top10RibbonSide: "right",
      cardAwardDisplay: "badge",
      showCardBadges: true,
      watchlistBadge: "topEnd",
    },
    state: {
      showTop10: true,
      hasDub: true,
      newBadge: { label: "New", tone: "default" },
      inWatchlist: true,
    },
  });
  assert.match(dub.props.className, /end-2 top-\[48px\]/);
  assert.equal(score.props.topClass, "top-[132px]");
  assert.match(bookmark.props.className, /top-\[152px\]/);
  // The densest bookmark stack must still fit within a standard 318px TV card.
  assert.ok(152 + 24 <= (318 * 9) / 16);
});

test("unoccupied TV top-right corner keeps the default score position", () => {
  const { score } = renderCard();
  assert.equal(score.props.topClass, undefined);
});

test("a centered award tab reserves space for top-positioned scores", () => {
  const { score } = renderCard({ award: true, settings: { cardAwardDisplay: "tabs" } });
  assert.equal(score.props.topClass, "top-[34px]");
});

test("bottom-positioned scores remain unchanged", () => {
  const { score } = renderCard({
    curated: true,
    state: { hasDub: true, inWatchlist: true },
    settings: { badgePlacement: "bottom", watchlistBadge: "bottomEnd" },
  });
  assert.equal(score.props.topClass, undefined);
  assert.equal(score.props.shiftedFromEnd, true);
});

test("ScoreStack honors the TV top-offset override", () => {
  const { ScoreStack } = load("src/components/card-score-stack.tsx", {
    "react/jsx-runtime": runtime,
  });
  const node = ScoreStack({
    badges: [{ kind: "rating", source: "imdb", value: "8.4" }],
    placement: "top",
    topClass: "top-[76px]",
  });
  assert.match(node.props.className, /top-\[76px\]/);
  assert.doesNotMatch(node.props.className, /top-1\.5/);
});

function renderOverlayPreview(settings, layout = "tv") {
  function ClassicAwardBadge() {}
  const { stackTop } = load("src/components/card-status-badges.tsx", {
    "react/jsx-runtime": runtime,
  });
  const { CardOverlayPreview } = load("src/views/settings/card-overlay-preview.tsx", {
    "react/jsx-runtime": runtime,
    "@/lib/settings": { useSettings: () => ({ settings: {} }) },
    "@/lib/i18n": { useT: () => (message) => message },
    "@/lib/sample-artwork": {
      useSampleArtwork: () => ({ poster: "poster", background: "backdrop", name: "Example" }),
    },
    "@/components/card-award": { ClassicAwardBadge },
    "@/components/card-status-badges": { stackTop },
  });
  const nodes = walk(CardOverlayPreview({ layout, settings, cardWidth: 318 }));
  const bookmark = nodes.find(
    (n) =>
      typeof n.props?.className === "string" && n.props.className.includes("bg-canvas/85 text-ink"),
  );
  const awardBadge = nodes.find((n) => n.type === ClassicAwardBadge);
  return { bookmark, awardBadge };
}

test("TV preview keeps a top-right bookmark in the first slot without a ribbon", () => {
  const { bookmark } = renderOverlayPreview({
    top10Ribbon: false,
    top10RibbonSide: "left",
    cardAwardDisplay: "none",
    watchlistBadge: "topEnd",
  });
  assert.match(bookmark.props.className, /top-2 end-2/);
});

test("TV preview moves the bookmark below a right-side ribbon", () => {
  const { bookmark } = renderOverlayPreview({
    top10Ribbon: true,
    top10RibbonSide: "right",
    cardAwardDisplay: "none",
    watchlistBadge: "topEnd",
  });
  assert.match(bookmark.props.className, /top-\[48px\] end-2/);
});

test("TV preview stacks left-side ribbon, award badge and bookmark", () => {
  const { bookmark, awardBadge } = renderOverlayPreview({
    top10Ribbon: true,
    top10RibbonSide: "left",
    cardAwardDisplay: "badge",
    watchlistBadge: "topStart",
  });
  assert.equal(awardBadge.props.topClass, "top-[48px]");
  assert.match(bookmark.props.className, /top-\[76px\] start-2/);
});

test("poster settings preview retains its original bookmark placement", () => {
  const { bookmark } = renderOverlayPreview(
    {
      top10Ribbon: false,
      top10RibbonSide: "left",
      cardAwardDisplay: "none",
      watchlistBadge: "topEnd",
    },
    "poster",
  );
  assert.match(bookmark.props.className, /top-1\.5 end-1\.5/);
});
