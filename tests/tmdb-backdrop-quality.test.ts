import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { tmdbBackdropAtSize } from "../src/lib/tmdb-backdrop-size.ts";
import { toHiResBackdrop } from "../src/lib/use-stable-asset.ts";

const original = "https://image.tmdb.org/t/p/original/backdrop.jpg";
const resized = "https://image.tmdb.org/t/p/w500/backdrop.jpg";

function loadComponent(path: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", compiled)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const hero = loadComponent("src/components/hero-backdrop.tsx", {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "@/lib/tmdb-backdrop-size": { tmdbBackdropAtSize },
  "@/lib/hero-art-quality": {
    firstUsableHeroBackdrop: (list: string[]) => list[0],
    isHighQualityHeroArt: () => true,
    knownHeroArtQuality: () => undefined,
    nextUsableHeroBackdrop: () => undefined,
    rememberHeroArtQuality: () => undefined,
  },
}).HeroBackdrop;

const settings = { heroFullQuality: true, streamBackdropBlur: true };
const picker = loadComponent("src/views/play-picker/backdrop-layer.tsx", {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "@/lib/settings": { useSettings: () => ({ settings }) },
  "@/lib/tmdb-backdrop-size": { tmdbBackdropAtSize },
}).BackdropLayer;

function urls(html: string): string[] {
  return [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((match) => match[1]);
}

test("TMDB size conversion handles original, width, and height URLs without changing other hosts", () => {
  assert.equal(
    tmdbBackdropAtSize(original, "w300"),
    "https://image.tmdb.org/t/p/w300/backdrop.jpg",
  );
  assert.equal(
    tmdbBackdropAtSize(resized, "w1280"),
    "https://image.tmdb.org/t/p/w1280/backdrop.jpg",
  );
  assert.equal(
    tmdbBackdropAtSize("https://image.tmdb.org/t/p/h632/backdrop.jpg", "w780"),
    "https://image.tmdb.org/t/p/w780/backdrop.jpg",
  );
  assert.equal(
    tmdbBackdropAtSize("https://other.example/backdrop.jpg", "w300"),
    "https://other.example/backdrop.jpg",
  );
  // another host can serve a /t/p/<size>/ path of its own
  assert.equal(
    tmdbBackdropAtSize("https://cdn.example/t/p/w500/image.jpg", "original"),
    "https://cdn.example/t/p/w500/image.jpg",
  );
  assert.equal(tmdbBackdropAtSize("/t/p/w500/image.jpg", "original"), "/t/p/w500/image.jpg");
});

test("detail backdrop URL selection respects the full-quality setting", () => {
  assert.equal(toHiResBackdrop(original, true), original);
  assert.equal(toHiResBackdrop(resized, true), original);
  assert.equal(toHiResBackdrop(original, false), "https://image.tmdb.org/t/p/w1280/backdrop.jpg");
  assert.equal(toHiResBackdrop(undefined, true), undefined);
});

test("detail hero loads w300 placeholders and honors full-quality choice", () => {
  assert.deepEqual(
    urls(renderToStaticMarkup(React.createElement(hero, { url: original, fullQuality: true }))),
    ["https://image.tmdb.org/t/p/w300/backdrop.jpg", original],
  );
  assert.deepEqual(
    urls(renderToStaticMarkup(React.createElement(hero, { url: original, fullQuality: false }))),
    [
      "https://image.tmdb.org/t/p/w300/backdrop.jpg",
      "https://image.tmdb.org/t/p/w1280/backdrop.jpg",
    ],
  );
});

test("stream picker keeps blurred images small and honors quality on unblurred images", () => {
  for (const [blur, full, expected] of [
    [true, true, "w780"],
    [true, false, "w780"],
    [false, false, "w1280"],
    [false, true, "original"],
  ] as const) {
    settings.streamBackdropBlur = blur;
    settings.heroFullQuality = full;
    const imageUrls = urls(renderToStaticMarkup(React.createElement(picker, { src: original })));
    assert.deepEqual(
      imageUrls,
      [
        "https://image.tmdb.org/t/p/w300/backdrop.jpg",
        `https://image.tmdb.org/t/p/${expected}/backdrop.jpg`,
      ],
      `blur=${blur}, fullQuality=${full}`,
    );
  }
});

test("detail keeps setting-dependent candidates and passes quality to its hero", () => {
  const source = readFileSync(new URL("../src/views/detail.tsx", import.meta.url), "utf8");
  assert.match(source, /toHiResBackdrop\(pinnedBackdrop, settings\.heroFullQuality\)/);
  assert.match(source, /toHiResBackdrop\(b \?\? undefined, settings\.heroFullQuality\)/);
  assert.match(source, /\[primaryBackdrop, backdrops, settings\.heroFullQuality\]/);
  assert.match(
    source,
    /<HeroBackdrop\s+url=\{backdrop\}\s+fallbacks=\{backdropPool\}\s+fullQuality=\{settings\.heroFullQuality\}/,
  );
});
