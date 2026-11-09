import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import ts from "typescript";

function load(path, mocks) {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in mocks, `unexpected import ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

function loadCard(posters) {
  const stub = () => null;
  return load("src/views/detail/episode-grid-card.tsx", {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "lucide-react": new Proxy({}, { get: () => stub }),
    "@/components/episode-release-countdown": { EpisodeReleaseCountdown: stub },
    "@/components/icons/play-filled": { Play: stub },
    "@/components/hover-tooltip": { HoverTooltip: stub },
    "./episode-download-button": { EpisodeDownloadButton: stub },
    "./episode-reviews-dialog": {
      EpisodeReviewsDialog: stub,
      EpisodeReviewsIconButton: stub,
    },
    "./episode-rating-badge": { EpisodeRatingBadge: stub },
    "@/components/poster": {
      Poster: (props) => {
        posters.push(props);
        return React.createElement("span", { "data-src": props.src });
      },
    },
    "@/lib/skip-intro": { prefetchSegments: () => {} },
    "@/lib/dates": { formatAirDate: () => "" },
    "@/lib/i18n": {
      useT: () => (text, vars) => text.replace("{n}", String(vars?.n ?? "")),
    },
    "@/lib/bidi": { bidiIsolate: (text) => text },
    "@/lib/view": { useView: () => ({}) },
    "@/lib/settings": { useSettings: () => ({ settings: {} }) },
    "@/lib/spoilers": {
      SPOILER_TEXT_CLASS: "spoiler",
      SPOILER_THUMB_CLASS: "spoiler-thumb",
    },
    "./badges": { FillerBadge: stub, UpcomingBadge: stub },
  }).EpisodeGridCard;
}

test("a refreshed primary still replaces a fallback after enrichment", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://fixture.invalid" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  const posters = [];
  const EpisodeGridCard = loadCard(posters);
  const root = createRoot(document.getElementById("root"));
  const meta = { id: "kitsu:1", name: "Example", type: "series" };
  const progress = { ratio: 0, watched: false, startedAt: 0 };
  const episode = {
    key: "12",
    number: 12,
    season: 1,
    title: "Episode 12",
    stills: ["broken-addon.jpg", "fallback.jpg"],
    runtime: 24,
    airDate: null,
    play: () => {},
  };

  try {
    await React.act(async () =>
      root.render(React.createElement(EpisodeGridCard, { meta, g: episode, progress })),
    );
    assert.equal(posters.at(-1)?.src, "broken-addon.jpg");

    await React.act(async () => posters.at(-1)?.onError?.());
    assert.equal(posters.at(-1)?.src, "fallback.jpg");

    await React.act(async () =>
      root.render(
        React.createElement(EpisodeGridCard, {
          meta,
          g: { ...episode, stills: ["valid-tvdb.jpg", "fallback.jpg"] },
          progress,
        }),
      ),
    );
    assert.equal(
      posters.at(-1)?.src,
      "valid-tvdb.jpg",
      "the card must retry the refreshed primary instead of keeping the fallback",
    );
  } finally {
    await React.act(async () => root.unmount());
  }
});
