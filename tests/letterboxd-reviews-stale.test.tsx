import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import ts from "typescript";

type Result = {
  reviews: { text: string; author: string; url: string; lang: string; rating: null; date: null }[];
  hasNext: boolean;
  source: string;
  partial: boolean;
  sortUnavailable: boolean;
};

function deferred() {
  let resolve!: (value: Result) => void;
  const promise = new Promise<Result>((r) => (resolve = r));
  return { promise, resolve };
}

const emptyAnswer: Result = {
  reviews: [],
  hasNext: false,
  source: "none",
  partial: false,
  sortUnavailable: false,
};

const answer = (author: string): Result => ({
  reviews: [
    {
      text: `${author} review`,
      author,
      url: `https://letterboxd.com/film/${author.replace(/\s+/g, "-")}/reviews/`,
      lang: "en",
      rating: null,
      date: null,
    },
  ],
  hasNext: false,
  source: "server",
  partial: false,
  sortUnavailable: false,
});

test("a slow answer for an earlier request never replaces the latest one's reviews", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://fixture.invalid" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const pending = new Map<string, ReturnType<typeof deferred>>();
  const icon = () => null;
  const mocks: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "lucide-react": new Proxy({}, { get: () => icon }),
    "@/components/hover-tooltip": {
      HoverTooltip: ({ children }: { children: React.ReactNode }) => children,
    },
    "@/lib/stremboxd/provider": {
      useLetterboxd: () => ({ isActive: true, isFullConnected: false, username: "" }),
    },
    "@/lib/stremboxd/client": {
      fetchLetterboxdReviewsDirect: (id: string, _page: number, sort: string) => {
        const d = deferred();
        pending.set(`${id}:${sort}`, d);
        return d.promise;
      },
      fetchLetterboxdFriendsReviews: async () => [],
    },
    "@/lib/window": { openUrl: () => {} },
    "@/lib/i18n": { useT: () => (text: string) => text, useUiLanguage: () => "en", LANGUAGES: [] },
    "@/lib/settings": { useSettings: () => ({ settings: { blurComments: false } }) },
    "./review-translation": {
      useReviewTranslator: () => ({ display: (text: string) => text }),
      ReviewTranslateBar: () => null,
      ReviewTranslateButton: () => null,
    },
  };
  const compiled = ts.transpileModule(
    readFileSync("src/views/detail/letterboxd-reviews.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {} as { LetterboxdReviews: React.ElementType };
  new Function("require", "exports", compiled)((name: string) => {
    assert.ok(name in mocks, `unexpected import ${name}`);
    return mocks[name];
  }, exports);

  const root = createRoot(document.getElementById("root")!);
  const show = (imdbId: string) =>
    React.act(async () =>
      root.render(
        React.createElement(exports.LetterboxdReviews, {
          meta: { id: imdbId, type: "movie" },
          imdbId,
        }),
      ),
    );
  const chip = (label: string) =>
    [...document.querySelectorAll("button")].find((b) => b.textContent === label);
  const text = () => document.body.textContent ?? "";

  // The section is reused across films: open one, then another before the first answers.
  await show("tt1");
  await show("tt2");
  await React.act(async () => pending.get("tt2:popular")!.resolve(answer("second film")));
  await React.act(async () => pending.get("tt1:popular")!.resolve(answer("first film")));
  assert.ok(text().includes("second film review"), text());
  assert.ok(!text().includes("first film review"), "the stale answer was dropped");

  // Rapid sort changes: "Most recent" then "Longest", answered in reverse order.
  await React.act(async () => chip("Most recent")!.click());
  await React.act(async () => chip("Longest")!.click());
  await React.act(async () => pending.get("tt2:longest")!.resolve(answer("longest")));
  await React.act(async () => pending.get("tt2:newest")!.resolve(answer("newest")));
  assert.equal(chip("Longest")!.getAttribute("aria-pressed"), "true");
  assert.ok(text().includes("longest review"), text());
  assert.ok(!text().includes("newest review"), "the older sort's late answer was dropped");
  assert.ok(!text().includes("Loading…"), "the late answer did not leave a spinner behind");

  // Film-scoped links are cleared immediately. Film three returns no reviews while Longest is
  // selected, so an old "All reviews" link from film two must not survive the switch.
  await show("tt3");
  await React.act(async () => pending.get("tt3:longest")!.resolve(emptyAnswer));
  assert.equal(chip("All reviews"), undefined, "the previous film's Letterboxd link was cleared");

  // Unmounting retires anything still in flight.
  await React.act(async () => chip("Lowest rated")!.click());
  await React.act(async () => root.unmount());
  await React.act(async () => pending.get("tt3:lowest")!.resolve(answer("lowest")));
  assert.ok(!text().includes("lowest review"));
});

test("partial newest results use wording that does not claim the whole list is popular", () => {
  const source = readFileSync("src/views/detail/letterboxd-reviews.tsx", "utf8");
  assert.match(source, /partial\s*\?\s*"Some recent reviews couldn't be loaded/);
  assert.match(source, /setPartial\(result\.partial\)/);
});
