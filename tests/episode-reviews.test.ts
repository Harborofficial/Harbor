import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

function load<T>(path: string, mocks: Record<string, unknown>): T {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as T;
  new Function("require", "exports", compiled)((name: string) => {
    assert.ok(name in mocks, `unexpected import ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

const lib = (
  safeFetch: (url: string, init?: RequestInit) => Promise<Response> = async () =>
    new Response("{}"),
  fetchComments: (...args: unknown[]) => Promise<unknown[]> = async () => [],
) =>
  load<typeof import("../src/lib/episode-reviews")>("src/lib/episode-reviews.ts", {
    "@/lib/safe-fetch": { safeFetch },
    "@/lib/trakt/comments": { fetchCommentsStrict: fetchComments },
  });

/** An IMDb GraphQL stub; `pages` answers the season's episode list one page per request. */
function imdb(pages: { ids: [string, string][]; next?: string }[], reviews: unknown[] = []) {
  const queries: string[] = [];
  let page = 0;
  const safeFetch = async (_url: string, init?: RequestInit) => {
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    queries.push(query);
    if (query.includes("episodes{")) {
      const p = pages[page++];
      if (!p) return new Response("", { status: 500 });
      return new Response(
        JSON.stringify({
          data: {
            title: {
              episodes: {
                episodes: {
                  pageInfo: { hasNextPage: !!p.next, endCursor: p.next ?? null },
                  edges: p.ids.map(([n, id]) => ({
                    node: {
                      id,
                      series: { displayableEpisodeNumber: { episodeNumber: { text: n } } },
                    },
                  })),
                },
              },
            },
          },
        }),
      );
    }
    return new Response(
      JSON.stringify({
        data: {
          title: {
            reviews: { pageInfo: { hasNextPage: false }, edges: reviews.map((node) => ({ node })) },
          },
        },
      }),
    );
  };
  return { safeFetch, queries };
}

test("episode reviews target the series' IMDb id and IMDb numbering", () => {
  const { episodeReviewsTarget } = lib();
  assert.deepEqual(episodeReviewsTarget("tt0903747", 1, 1), {
    imdbId: "tt0903747",
    season: 1,
    episode: 1,
  });
  // Season 0 (specials) is a real IMDb season.
  assert.deepEqual(episodeReviewsTarget("tt0903747", 0, 2), {
    imdbId: "tt0903747",
    season: 0,
    episode: 2,
  });
  assert.equal(episodeReviewsTarget("kitsu:1376", 1, 1), undefined);
  assert.equal(episodeReviewsTarget("tt0903747", undefined, 1), undefined);
  assert.equal(episodeReviewsTarget(null, 1, 1), undefined);
  // Only whole, sensible numbers reach the GraphQL query.
  assert.equal(episodeReviewsTarget("tt0903747", 1.5, 1), undefined);
  assert.equal(episodeReviewsTarget("tt0903747", 1, 0), undefined);
  assert.equal(episodeReviewsTarget("tt0903747", -1, 1), undefined);
  assert.equal(episodeReviewsTarget("tt0903747", Number.NaN, 1), undefined);
  assert.equal(episodeReviewsTarget('tt1"){x}', 1, 1), undefined);
});

test("a spoiler review hides its title along with its body", () => {
  const icon = () => null;
  const { ReviewCard } = load<{ ReviewCard: React.FC<any> }>(
    "src/views/detail/episode-reviews-dialog.tsx",
    {
      react: React,
      "react/jsx-runtime": jsxRuntime,
      "lucide-react": {
        ExternalLink: icon,
        Heart: icon,
        Loader2: icon,
        MessageSquareText: icon,
        Star: icon,
        X: icon,
      },
      "@/components/hover-tooltip": { HoverTooltip: ({ children }: any) => children },
      "@/components/modal-shell": {},
      "@/lib/i18n": { useT: () => (text: string) => text },
      "@/lib/window": { openUrl: () => {} },
      "@/lib/episode-reviews": {},
      "./review-translation": { ReviewTranslateButton: () => null },
    },
  );
  const review = {
    id: "imdb:rw1",
    source: "imdb",
    author: "fixture",
    avatar: null,
    rating: 9,
    date: null,
    likes: 0,
    title: "Walt dies at the end",
    text: "Body text",
    spoiler: true,
    url: null,
  };
  const html = renderToStaticMarkup(
    React.createElement(ReviewCard, {
      review,
      tr: { display: (text: string) => text },
    }),
  );
  const hidden = html.slice(html.indexOf('aria-hidden="true"'));
  assert.ok(html.includes('class="select-none blur-[6px]" aria-hidden="true"'), html);
  assert.ok(hidden.indexOf("Walt dies at the end") > 0, "the title sits inside the blurred block");
  assert.ok(hidden.indexOf("Body text") > hidden.indexOf("Walt dies at the end"));
});

test("an episode past the first page of a season is found by following the cursor", async () => {
  const first = Array.from({ length: 250 }, (_, i): [string, string] => [String(i + 1), `tt1${i}`]);
  const stub = imdb([{ ids: first, next: "cursor-2" }, { ids: [["251", "tt9000251"]] }]);
  const { imdbEpisodeId } = lib(stub.safeFetch);
  assert.equal(await imdbEpisodeId("tt0388629", 1, 251), "tt9000251");
  assert.ok(stub.queries[1]!.includes('after:"cursor-2"'));
  // The whole season was read, so the next lookup is answered from the cache.
  assert.equal(await imdbEpisodeId("tt0388629", 1, 3), "tt12");
  assert.equal(stub.queries.length, 2);
});

test("a failed season lookup is not cached as missing", async () => {
  let fail = true;
  const good = imdb([{ ids: [["1", "tt5000001"]] }]);
  const { imdbEpisodeId } = lib(async (url, init) =>
    fail ? new Response("", { status: 503 }) : good.safeFetch(url, init),
  );
  assert.equal(await imdbEpisodeId("tt0903747", 1, 1), null);
  fail = false;
  assert.equal(await imdbEpisodeId("tt0903747", 1, 1), "tt5000001");
});

test("episode reviews load a page at a time and say where the next page starts", async () => {
  const stub = imdb(
    [{ ids: [["1", "tt5000001"]] }],
    [{ id: "rw1", author: { nickName: "a" }, text: { originalText: { plainText: "Great" } } }],
  );
  const traktPages: number[] = [];
  const { fetchEpisodeReviews } = lib(stub.safeFetch, async (_target, _sort, page) => {
    traktPages.push(page as number);
    return Array.from({ length: page === 1 ? 25 : 3 }, (_, i) => ({
      id: Number(page) * 100 + i,
      comment: `comment ${i}`,
      spoiler: false,
      likes: 0,
      createdAt: "2020-01-01",
      userRating: null,
      user: { username: "u", name: null, avatar: null, slug: null },
    }));
  });
  const first = await fetchEpisodeReviews("tt0903747", 1, 1);
  assert.equal(first.reviews.length, 26);
  assert.deepEqual(first.next, { imdb: null, trakt: 2 });
  assert.deepEqual(first.failed, []);
  const second = await fetchEpisodeReviews("tt0903747", 1, 1, first.next!);
  assert.equal(second.reviews.length, 3);
  assert.equal(second.next, null);
  assert.deepEqual(second.failed, []);
  assert.deepEqual(traktPages, [1, 2]);
  assert.equal(
    stub.queries.filter((q) => q.includes("reviews(")).length,
    1,
    "IMDb is not asked again once it has no more pages",
  );
});

test("episode review sorts are requested from IMDb and Trakt instead of only reordering likes", async () => {
  const calls: string[] = [];
  const safeFetch = async (_url: string, init?: RequestInit) => {
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    calls.push(query);
    if (query.includes("episodes{")) {
      return new Response(JSON.stringify({
        data: { title: { episodes: { episodes: {
          pageInfo: { hasNextPage: false },
          edges: [{ node: { id: "tt5000001", series: { displayableEpisodeNumber: { episodeNumber: { text: "1" } } } } }],
        } } } },
      }));
    }
    return new Response(JSON.stringify({ data: { title: { reviews: { pageInfo: { hasNextPage: false }, edges: [] } } } }));
  };
  const traktSorts: string[] = [];
  const { fetchEpisodeReviews } = lib(safeFetch, async (_target, sort) => {
    traktSorts.push(String(sort));
    return [];
  });

  for (const [sort, imdb, order, trakt] of [
    ["liked", "HELPFULNESS_SCORE", "DESC", "likes"],
    ["recent", "SUBMISSION_DATE", "DESC", "newest"],
    ["highest", "USER_RATING", "DESC", "highest"],
    ["lowest", "USER_RATING", "ASC", "lowest"],
  ] as const) {
    calls.length = 0;
    await fetchEpisodeReviews("tt0903747", 1, 1, undefined, "tt5000001", sort);
    const reviewQuery = calls.find((q) => q.includes("reviews("))!;
    assert.ok(reviewQuery.includes(`sort:{by:${imdb}, order:${order}}`), reviewQuery);
    assert.equal(traktSorts.at(-1), trakt);
  }
  assert.deepEqual(traktSorts, ["likes", "newest", "highest", "lowest"]);
});

test("temporary review page failures keep the source cursor so Show more can retry", async () => {
  let imdbFails = true;
  let traktFails = true;
  const safeFetch = async (_url: string, init?: RequestInit) => {
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    if (!query.includes("reviews(")) return new Response("{}", { status: 500 });
    if (imdbFails) return new Response("", { status: 503 });
    return new Response(JSON.stringify({ data: { title: { reviews: {
      pageInfo: { hasNextPage: false },
      edges: [{ node: { id: "rw1", text: { originalText: { plainText: "Recovered" } } } }],
    } } } }));
  };
  const { fetchEpisodeReviews } = lib(safeFetch, async () => {
    if (traktFails) throw new Error("temporary Trakt failure");
    return [];
  });

  const failed = await fetchEpisodeReviews("tt0903747", 1, 1, undefined, "tt5000001");
  assert.deepEqual(failed.failed.sort(), ["imdb", "trakt"]);
  assert.deepEqual(failed.next, { imdb: "", trakt: 1 });

  imdbFails = false;
  traktFails = false;
  const retried = await fetchEpisodeReviews("tt0903747", 1, 1, failed.next!, "tt5000001");
  assert.deepEqual(retried.failed, []);
  assert.equal(retried.reviews[0]!.text, "Recovered");
  assert.equal(retried.next, null);
});

test("'Translate all' covers the reviews on screen, minus spoilers still hidden", () => {
  const icon = () => null;
  const { bulkTranslationGroups, bulkTranslationTexts, REVIEWS_STEP } = load<{
    bulkTranslationGroups: (reviews: unknown[], revealed?: ReadonlySet<string>) => string[][];
    bulkTranslationTexts: (reviews: unknown[], revealed?: ReadonlySet<string>) => string[];
    REVIEWS_STEP: number;
  }>("src/views/detail/episode-reviews-dialog.tsx", {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "lucide-react": new Proxy({}, { get: () => icon }),
    "@/components/hover-tooltip": {},
    "@/components/modal-shell": {},
    "@/lib/i18n": {},
    "@/lib/window": {},
    "@/lib/episode-reviews": {},
    "./review-translation": {},
  });
  assert.ok(REVIEWS_STEP >= 20 && REVIEWS_STEP <= 30);
  const reviews = [
    { title: "Title", text: "Body", spoiler: false },
    { title: "", text: "Plain", spoiler: false },
    { id: "spoiler", title: "Spoiler title", text: "Spoiler body", spoiler: true },
  ];
  assert.deepEqual(bulkTranslationGroups(reviews), [["Title", "Body"], ["Plain"]]);
  assert.deepEqual(bulkTranslationTexts(reviews), ["Title", "Body", "Plain"]);
  assert.deepEqual(
    bulkTranslationGroups(reviews, new Set(["spoiler"])),
    [["Title", "Body"], ["Plain"], ["Spoiler title", "Spoiler body"]],
    "an explicitly revealed spoiler participates in bulk translation",
  );
});

test("Longest drains review pagination before presenting the sorted result", async () => {
  const { JSDOM } = await import("jsdom");
  const { createRoot } = await import("react-dom/client");
  const dom = new JSDOM("<div id='root'></div>", { url: "https://fixture.invalid" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  const calls: Array<{ sort: string; cursor: unknown }> = [];
  const short = {
    id: "imdb:short", source: "imdb", author: "a", avatar: null, rating: null,
    date: null, likes: 1, title: "", text: "short", spoiler: false, url: null,
  };
  const long = {
    id: "imdb:long", source: "imdb", author: "b", avatar: null, rating: null,
    date: null, likes: 0, title: "", text: "this is the much longer review", spoiler: false, url: null,
  };
  const fetchEpisodeReviews = async (
    _id: string,
    _season: number,
    _episode: number,
    cursor: any,
    _episodeImdbId: unknown,
    sort: string,
  ) => {
    calls.push({ sort, cursor });
    if (sort !== "longest") return { reviews: [], next: null, failed: [] };
    if (!cursor) return { reviews: [short], next: { imdb: "c2", trakt: null }, failed: [] };
    return { reviews: [long], next: null, failed: [] };
  };
  const icon = () => null;
  const { EpisodeReviewsDialog } = load<{ EpisodeReviewsDialog: React.FC<any> }>(
    "src/views/detail/episode-reviews-dialog.tsx",
    {
      react: React,
      "react/jsx-runtime": jsxRuntime,
      "lucide-react": new Proxy({}, { get: () => icon }),
      "@/components/hover-tooltip": { HoverTooltip: ({ children }: any) => children },
      "@/components/modal-shell": {
        ModalShell: ({ children }: any) => React.createElement("div", null, children),
        useModalExit: (onClose: () => void) => ({ closing: false, close: onClose }),
      },
      "@/lib/i18n": { useT: () => (text: string) => text },
      "@/lib/window": { openUrl: () => {} },
      "@/lib/episode-reviews": {
        fetchEpisodeReviews,
        reviewersAverage: () => null,
        sortEpisodeReviews: (reviews: any[], sort: string) =>
          sort === "longest" ? [...reviews].sort((a, b) => b.text.length - a.text.length) : reviews,
      },
      "./review-translation": {
        useReviewTranslator: () => ({
          display: (text: string) => text,
          isShown: () => false,
          isBusy: () => false,
          isFailed: () => false,
          toggle: () => {},
          translateAll: () => {},
          busyAll: false,
          failedAll: 0,
        }),
        ReviewTranslateBar: () => null,
        ReviewTranslateButton: () => null,
      },
    },
  );
  const root = createRoot(document.getElementById("root")!);
  await React.act(async () => {
    root.render(React.createElement(EpisodeReviewsDialog, {
      seriesImdbId: "tt0903747", season: 1, episode: 1, onClose: () => {},
    }));
  });
  await React.act(async () => {});
  const longest = [...document.querySelectorAll("button")].find((b) => b.textContent === "Longest")!;
  await React.act(async () => longest.click());
  await React.act(async () => {});
  const longestCalls = calls.filter((c) => c.sort === "longest");
  assert.equal(longestCalls.length, 2, "the second page is fetched before Longest settles");
  const text = document.body.textContent ?? "";
  assert.ok(text.indexOf(long.text) < text.indexOf(short.text), text);
  await React.act(async () => root.unmount());
});

function loadGridCard(onReviews: () => void = () => {}) {
  const stub = (name: string) => (props: { children?: React.ReactNode }) =>
    React.createElement("span", { "data-stub": name }, props.children);
  const { EpisodeGridCard } = load<{ EpisodeGridCard: React.FC<any> }>(
    "src/views/detail/episode-grid-card.tsx",
    {
      react: React,
      "react/jsx-runtime": jsxRuntime,
      "lucide-react": new Proxy({}, { get: () => () => null }),
      "@/components/episode-release-countdown": { EpisodeReleaseCountdown: () => null },
      "@/components/icons/play-filled": { Play: () => null },
      "@/components/hover-tooltip": { HoverTooltip: stub("tooltip") },
      "./episode-download-button": { EpisodeDownloadButton: () => null },
      "./episode-reviews-dialog": {
        EpisodeReviewsDialog: () => null,
        EpisodeReviewsIconButton: ({ onClick }: { onClick: () => void }) =>
          React.createElement("button", {
            "aria-label": "Episode reviews",
            onClick: () => {
              onReviews();
              onClick();
            },
          }),
      },
      "./episode-rating-badge": { EpisodeRatingBadge: () => null },
      "@/components/poster": { Poster: () => null },
      "@/lib/skip-intro": { prefetchSegments: () => {} },
      "@/lib/dates": { formatAirDate: () => "" },
      "@/lib/i18n": {
        useT: () => (text: string, vars?: { n?: number }) =>
          text.replace("{n}", String(vars?.n ?? "")),
      },
      "@/lib/bidi": { bidiIsolate: (text: string) => text },
      "@/lib/view": { useView: () => ({}) },
      "@/lib/settings": { useSettings: () => ({ settings: {} }) },
      "@/lib/spoilers": { SPOILER_TEXT_CLASS: "spoiler", SPOILER_THUMB_CLASS: "spoiler-thumb" },
      "./badges": { FillerBadge: () => null, UpcomingBadge: () => null },
    },
  );
  return EpisodeGridCard;
}

const gridEpisode = (play: () => void) => ({
  key: "1",
  number: 1,
  season: 1,
  title: "Pilot",
  stills: [],
  runtime: 58,
  airDate: null,
  reviews: { imdbId: "tt0903747", season: 1, episode: 1 },
  play,
});

test("grid cards keep one play button, named by the episode, before a separate reviews button", () => {
  const EpisodeGridCard = loadGridCard();
  const html = renderToStaticMarkup(
    React.createElement(EpisodeGridCard, {
      meta: { id: "tt0903747", name: "Breaking Bad" },
      g: gridEpisode(() => {}),
      progress: { ratio: 0, watched: false, startedAt: 0 },
    }),
  );
  const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
  assert.equal(buttons.length, 2, html);
  assert.ok(!buttons[0]!.includes("tabindex"), "the play button stays in the tab order");
  assert.ok(buttons[1]!.includes('aria-label="Episode reviews"'));
  const play = html.slice(html.indexOf(buttons[0]!), html.indexOf("</button>"));
  assert.ok(play.includes("Pilot") && play.includes("E1"), "the play button reads as the episode");
  assert.ok(!play.includes("Episode reviews"), "no button inside the play button");
});

test("a known episode IMDb id is used without looking it up", async () => {
  const stub = imdb(
    [],
    [{ id: "rw9", author: { nickName: "a" }, text: { originalText: { plainText: "Yes" } } }],
  );
  const { fetchEpisodeReviews } = lib(stub.safeFetch);
  const page = await fetchEpisodeReviews("tt0903747", 1, 1, undefined, "tt0959621");
  assert.equal(page.reviews[0]!.id, "imdb:rw9");
  assert.ok(
    stub.queries.every((q) => !q.includes("episodes{")),
    "no season lookup",
  );
  assert.ok(stub.queries[0]!.includes('title(id:"tt0959621")'));
});

test("activating the play button plays, and the reviews button only opens reviews", async () => {
  const { JSDOM } = await import("jsdom");
  const { createRoot } = await import("react-dom/client");
  const dom = new JSDOM("<div id='root'></div>", { url: "https://fixture.invalid" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const calls: string[] = [];
  const EpisodeGridCard = loadGridCard(() => calls.push("reviews"));
  const root = createRoot(document.getElementById("root")!);
  await React.act(async () =>
    root.render(
      React.createElement(EpisodeGridCard, {
        meta: { id: "tt0903747", name: "Breaking Bad" },
        g: gridEpisode(() => calls.push("play")),
        progress: { ratio: 0, watched: false, startedAt: 0 },
      }),
    ),
  );
  const [play, reviews] = [...document.querySelectorAll("button")];
  // Focus order follows the DOM: play first, then reviews; both are reachable by Tab.
  assert.equal(play!.tabIndex, 0);
  assert.equal(reviews!.getAttribute("aria-label"), "Episode reviews");
  play!.focus();
  assert.equal(document.activeElement, play);
  // Enter or Space on a focused button (keyboard, remote, gamepad) dispatches a click.
  await React.act(async () => play!.click());
  await React.act(async () => reviews!.click());
  assert.deepEqual(calls, ["play", "reviews"]);
  await React.act(async () => root.unmount());
});
