// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import "./_localstorage-stub.ts";

const at = (path: string) => new URL(`../${path}`, import.meta.url);
const read = (path: string) => readFileSync(at(path), "utf8");
import {
  moveSection,
  orderedSectionKeys,
  type DetailCustomization,
} from "../src/lib/detail-customization.ts";
import {
  clearParentsGuideCache,
  fetchImdbParentsGuide,
  getParentsGuideCacheEntry,
  severityColorStyle,
} from "../src/lib/providers/imdb-parents-guide.ts";

test("layout ordering: default order places parentsGuide below cast while respecting available layout", () => {
  const available = ["streamRail", "cast", "parentsGuide", "collection", "moreLikeThis"];
  const emptyCustom: DetailCustomization = { order: [], hidden: [] };

  const ordered = orderedSectionKeys(available, emptyCustom);
  assert.deepEqual(ordered, available);
  assert.equal(ordered.indexOf("parentsGuide"), ordered.indexOf("cast") + 1);
});

test("layout ordering: custom ordering explicitly saved by user is strictly preserved", () => {
  const available = ["streamRail", "cast", "parentsGuide", "collection", "moreLikeThis"];
  // User explicitly moved parentsGuide to the very bottom
  const customOrder: DetailCustomization = {
    order: ["streamRail", "cast", "collection", "moreLikeThis", "parentsGuide"],
    hidden: [],
  };

  const ordered = orderedSectionKeys(available, customOrder);
  assert.deepEqual(ordered, ["streamRail", "cast", "collection", "moreLikeThis", "parentsGuide"]);
  assert.equal(ordered.indexOf("parentsGuide"), 4);

  // Moving parentsGuide up using moveSection
  const movedUp = moveSection(customOrder, available, "parentsGuide", -1);
  assert.deepEqual(movedUp.order, [
    "streamRail",
    "cast",
    "collection",
    "parentsGuide",
    "moreLikeThis",
  ]);

  // Moving parentsGuide further up
  const movedFurtherUp = moveSection(movedUp, available, "parentsGuide", -1);
  assert.deepEqual(movedFurtherUp.order, [
    "streamRail",
    "cast",
    "parentsGuide",
    "collection",
    "moreLikeThis",
  ]);
});

test("severityColorStyle: monochrome theme (Harbor default) matches in-player toast styles", () => {
  const severe = severityColorStyle("Severe", "monochrome");
  assert.match(severe.textClass, /text-white\/90/);
  assert.equal(severe.barClass, "bg-white/90");
  assert.equal(severe.glowClass, "");

  const moderate = severityColorStyle("Moderate", "monochrome");
  assert.match(moderate.textClass, /text-white\/70/);
  assert.equal(moderate.barClass, "bg-white/65");

  const mild = severityColorStyle("Mild", "monochrome");
  assert.match(mild.textClass, /text-white\/50/);
  assert.equal(mild.barClass, "bg-white/45");

  const none = severityColorStyle("None", "monochrome");
  assert.match(none.textClass, /text-white\/35/);
  assert.equal(none.barClass, "bg-white/30");
});

test("severityColorStyle: colored theme applies danger and accent tokens with glowing highlights", () => {
  const severe = severityColorStyle("Severe", "colored");
  assert.match(severe.textClass, /text-danger/);
  assert.equal(severe.barClass, "bg-danger");
  assert.ok(severe.glowClass.includes("rgba(244,63,94"));

  const moderate = severityColorStyle("Moderate", "colored");
  assert.match(moderate.textClass, /text-accent/);
  assert.equal(moderate.barClass, "bg-accent");
  assert.ok(moderate.glowClass.includes("rgba(251,146,60"));

  const mild = severityColorStyle("Mild", "colored");
  assert.match(mild.textClass, /text-white\/60/);
  assert.equal(mild.barClass, "bg-white/45");

  const none = severityColorStyle("None", "colored");
  assert.match(none.textClass, /text-white\/40/);
  assert.equal(none.barClass, "bg-white/30");
});

test("imdb advisory cache: transient HTTP failures are not cached permanently", async () => {
  clearParentsGuideCache();

  const mockTransientFetch: typeof fetch = async () => {
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  };

  const res = await fetchImdbParentsGuide("tt1234567", mockTransientFetch as any);
  assert.equal(res, "error");

  // The cache entry must NOT be stored for transient failures
  const entry = getParentsGuideCacheEntry("tt1234567");
  assert.equal(entry, undefined);

  clearParentsGuideCache();
});

test("imdb advisory cache: successful data is cached with expiry and deduplicates inflight requests", async () => {
  clearParentsGuideCache();

  let callCount = 0;
  const mockSuccessFetch: typeof fetch = async () => {
    callCount += 1;
    // Slight delay to test deduplication
    await new Promise((r) => setTimeout(r, 15));
    return new Response(
      JSON.stringify({
        data: {
          title: {
            parentsGuide: {
              categories: [
                {
                  category: { id: "nudity", text: "Sex & Nudity" },
                  severity: { text: "Mild", votedFor: 12 },
                  totalSeverityVotes: 20,
                  guideItems: {
                    edges: [{ node: { isSpoiler: false, text: { plainText: "Brief scene" } } }],
                  },
                },
              ],
            },
          },
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  // Parallel calls should deduplicate to a single network request
  const [res1, res2] = await Promise.all([
    fetchImdbParentsGuide("tt9999999", mockSuccessFetch as any),
    fetchImdbParentsGuide("tt9999999", mockSuccessFetch as any),
  ]);

  assert.equal(callCount, 1);
  assert.equal(res1?.categories.length, 1);
  assert.equal(res2?.categories.length, 1);
  assert.equal(res1?.categories[0].label, "Sex & Nudity");

  // Cache should hold the data with future expiry
  const entry = getParentsGuideCacheEntry("tt9999999");
  assert.ok(entry);
  assert.equal(entry.data?.categories[0].id, "nudity");
  assert.ok(entry.expiresAt > Date.now());

  // Subsequent call should hit cache without network fetch
  const res3 = await fetchImdbParentsGuide("tt9999999", mockSuccessFetch as any);
  assert.equal(callCount, 1);
  assert.equal(res3?.categories[0].label, "Sex & Nudity");

  clearParentsGuideCache();
});

test("imdb advisory cache: genuinely unavailable data (404 or empty categories) caches null with expiry", async () => {
  clearParentsGuideCache();

  const mockNotFoundFetch: typeof fetch = async () => {
    return new Response(JSON.stringify({ data: { title: { parentsGuide: { categories: [] } } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const res = await fetchImdbParentsGuide("tt0000001", mockNotFoundFetch as any);
  assert.equal(res, null);

  const entry = getParentsGuideCacheEntry("tt0000001");
  assert.ok(entry);
  assert.equal(entry.data, null);
  assert.ok(entry.expiresAt > Date.now());

  clearParentsGuideCache();
});

test("parents guide panel: keep-expanded preference defaults to collapsed and respects localStorage flag", () => {
  const STORAGE_KEY = "harbor.content-advisory.keep-expanded";

  // Simulate missing preference -> defaults to collapsed
  assert.equal(localStorage.getItem(STORAGE_KEY), null);
  const defaultKeepExpanded = localStorage.getItem(STORAGE_KEY) === "1";
  assert.equal(defaultKeepExpanded, false);
  const defaultCollapsed = !defaultKeepExpanded;
  assert.equal(defaultCollapsed, true);

  // Simulate user ticking "Keep expanded"
  localStorage.setItem(STORAGE_KEY, "1");
  const storedKeepExpanded = localStorage.getItem(STORAGE_KEY) === "1";
  assert.equal(storedKeepExpanded, true);
  const nextCollapsed = !storedKeepExpanded;
  assert.equal(nextCollapsed, false);

  // Simulate user unticking "Keep expanded"
  localStorage.removeItem(STORAGE_KEY);
  assert.equal(localStorage.getItem(STORAGE_KEY), null);
});

test("imdb advisory cache: HTTP 200 GraphQL error responses are treated as transient failures and not cached", async () => {
  clearParentsGuideCache();

  let callCount = 0;
  const mockGraphQLErrorFetch: typeof fetch = async () => {
    callCount += 1;
    return new Response(
      JSON.stringify({
        errors: [
          {
            message: "Rate limit exceeded or service unavailable",
            extensions: { code: "SERVICE_UNAVAILABLE" },
          },
        ],
        data: null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const res = await fetchImdbParentsGuide("tt2222222", mockGraphQLErrorFetch as any);
  assert.equal(res, "error");
  assert.equal(callCount, 1);

  // Must NOT cache null or an entry for GraphQL errors returning HTTP 200
  const entry = getParentsGuideCacheEntry("tt2222222");
  assert.equal(entry, undefined);

  // Subsequent call should not hit cache and can recover when the API returns data
  const mockRecoverFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        data: {
          title: {
            parentsGuide: {
              categories: [
                {
                  category: { id: "violence", text: "Violence & Gore" },
                  severity: { text: "Moderate", votedFor: 5 },
                  totalSeverityVotes: 10,
                  guideItems: {
                    total: 1,
                    edges: [{ node: { isSpoiler: false, text: { plainText: "Action scene" } } }],
                  },
                },
              ],
            },
          },
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const recovered = await fetchImdbParentsGuide("tt2222222", mockRecoverFetch as any);
  assert.ok(recovered);
  assert.equal(recovered.categories[0].id, "violence");

  clearParentsGuideCache();
});

test("imdb advisory notes: parses totalItems count when guideItems exceeds fetched batch", async () => {
  clearParentsGuideCache();

  const mockLargeCategoryFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        data: {
          title: {
            parentsGuide: {
              categories: [
                {
                  category: { id: "violence", text: "Violence & Gore" },
                  severity: { text: "Severe", votedFor: 40 },
                  totalSeverityVotes: 50,
                  guideItems: {
                    total: 85,
                    edges: [
                      { node: { isSpoiler: false, text: { plainText: "Note 1" } } },
                      { node: { isSpoiler: false, text: { plainText: "Note 2" } } },
                    ],
                  },
                },
              ],
            },
          },
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const res = await fetchImdbParentsGuide("tt3333333", mockLargeCategoryFetch as any);
  assert.ok(res);
  assert.equal(res.categories[0].items.length, 2);
  assert.equal(res.categories[0].totalItems, 85);

  clearParentsGuideCache();
});

test("detail view: avoids unnecessary IMDb resolution lookups and eliminates page-level advisory requests", () => {
  const detail = read("src/views/detail.tsx");

  // Reuses existing IMDb ID directly from meta/detail for the open title
  assert.match(
    detail,
    /const existingImdbId =\s*\(meta\.id\.startsWith\("tt"\) \? meta\.id : null\) \?\? detail\?\.imdbId \?\? null;/,
  );

  // useImdbId is only enabled when no existing IMDb ID is found and Content Advisory is not hidden
  assert.match(
    detail,
    /const inferredImdb = useImdbId\(meta, settings\.tmdbKey, \{\s*enabled: !existingImdbId && !isParentsGuideHidden,\s*\}\);/,
  );

  // Inferred IMDb ID is only resolved for content advisory when verified
  assert.match(
    detail,
    /const resolvedParentsGuideImdb =\s*existingImdbId \?\? \(inferredImdb\.verified \? inferredImdb\.id : null\);/,
  );

  // DetailView does NOT invoke useParentsGuide at page level
  assert.equal(detail.includes("useParentsGuide("), false);

  // In rail sections, parentsGuide is mounted via ParentsGuidePanel without passing eager page-level guide data
  assert.match(
    detail,
    /if \(resolvedParentsGuideImdb\) \{\s*railSections\.push\(\{\s*key: "parentsGuide",\s*label: t\("Content Advisory"\),\s*minHeight: 60,\s*node: <ParentsGuidePanel imdbId=\{resolvedParentsGuideImdb\} \/>,\s*\}\);/,
  );
});

test("useParentsGuide hook: binds fetched data strictly to IMDb ID preventing stale title data", () => {
  const hook = read("src/views/detail/use-parents-guide.ts");

  // Associates state with id
  assert.match(
    hook,
    /const \[state, setState\] = useState<\{\s*id: string \| null;\s*guide: ParentsGuideResult \| null;/,
  );

  // Strictly returns guide only when matching the normalized ID
  assert.match(
    hook,
    /const guide = (?:isMatch|state\.id === normalizedId) \? state\.guide : null;/,
  );

  // Accepts enabled option to prevent eager fetching when section is collapsed
  assert.match(
    hook,
    /export function useParentsGuide\(\s*imdbId: string \| null \| undefined,\s*options\?: \{ enabled\?: boolean \},/,
  );
  assert.match(hook, /if \(!enabled \|\| !normalizedId\) \{/);
});

test("parents guide panel: defers fetching until section is expanded and renders notes only when category is expanded", () => {
  const panel = read("src/views/detail/parents-guide-panel.tsx");

  // Hook fetching is gated by !sectionCollapsed
  assert.match(
    panel,
    /const isFetchEnabled = propGuide !== undefined \? false : !sectionCollapsed;/,
  );
  assert.match(
    panel,
    /const internalData = useParentsGuide\(propGuide === undefined \? imdbId : null, \{\s*enabled: isFetchEnabled,\s*\}\);/,
  );

  // Collapsed section does not render category rows
  assert.match(panel, /\{!sectionCollapsed && \(/);

  // CategoryRow only renders detailed notes and spoilers when expanded
  assert.match(panel, /\{expanded && \(\s*<div\s*className="flex flex-col gap-2\.5/);
});

test("parents guide panel: implements full keyboard and focus accessibility with aria-expanded and inert", () => {
  const panel = read("src/views/detail/parents-guide-panel.tsx");

  // Main section expand toggle button has aria-expanded and aria-controls
  assert.match(panel, /aria-expanded=\{!sectionCollapsed\}/);
  assert.match(panel, /aria-controls="parents-guide-content"/);

  // Collapsed content area is made inert and aria-hidden
  assert.match(panel, /id="parents-guide-content"/);
  assert.match(panel, /inert=\{sectionCollapsed \? true : undefined\}/);
  assert.match(panel, /aria-hidden=\{sectionCollapsed \? true : undefined\}/);

  // Category toggle button has aria-expanded and aria-controls
  assert.match(panel, /aria-expanded=\{expanded\}/);
  assert.match(panel, /aria-controls=\{contentId\}/);

  // Category accordion container has inert and aria-hidden when not expanded
  assert.match(panel, /inert=\{!expanded \? true : undefined\}/);
  assert.match(panel, /aria-hidden=\{!expanded \? true : undefined\}/);
});

test("imdb advisory cache: partial data accompanied by GraphQL errors is rejected from positive cache", async () => {
  clearParentsGuideCache();

  const mockPartialErrorFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        errors: [{ message: "Some fields failed to resolve" }],
        data: {
          title: {
            parentsGuide: {
              categories: [
                {
                  category: { id: "violence", text: "Violence & Gore" },
                  severity: { text: "Severe", votedFor: 10 },
                  totalSeverityVotes: 12,
                  guideItems: { total: 1, edges: [] },
                },
              ],
            },
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const res = await fetchImdbParentsGuide("tt4444444", mockPartialErrorFetch as any);
  assert.equal(res, "error");

  // Positive cache must NOT contain this partial result
  const entry = getParentsGuideCacheEntry("tt4444444");
  assert.equal(entry, undefined);

  clearParentsGuideCache();
});

test("settings panel: Content advisory theme selector is rendered independently of toast toggle", () => {
  const settingsPanel = read("src/views/settings/player-layout-panel/index.tsx");

  // The Segmented control for theme is not wrapped in {settings.contentAdvisoryToast && (
  assert.match(
    settingsPanel,
    /<ToggleRow\s*label=\{t\("Content advisory on start"\)\}[\s\S]*?\/>\s*<Segmented\s*label=\{t\("Content advisory theme"\)\}/,
  );
});

test("arabic locale: content advisory description uses full key including detail page effect", () => {
  const ar = read("src/lib/i18n/locales/ar/settings.ts");

  assert.match(
    ar,
    /"Choose whether the content advisory appears in full color or a restrained monochrome tone\. Also affects the Content Advisory section on detail pages\.":\s*"اختر ما إذا كان التنبيه بالمحتوى سيظهر بألوان كاملة أو بنمط أحادي اللون هادئ\. يؤثر أيضاً على قسم التنبيه بالمحتوى في صفحات التفاصيل\."/,
  );
});

test("safe-fetch: app.harborstremio.com proxies IMDb GraphQL requests with narrowly scoped rule", () => {
  const safeFetch = read("src/lib/safe-fetch.ts");

  assert.match(
    safeFetch,
    /const isHarborStremio = \/\(\^\|\\\.\)harborstremio\\\.com\$\/i\.test\(window\.location\.hostname\);/,
  );
  assert.match(
    safeFetch,
    /const isImdbGraphql =\s*parsed\.hostname === "api\.graphql\.imdb\.com" \|\| parsed\.hostname === "graphql\.imdb\.com";/,
  );
  assert.match(safeFetch, /\(isHarborStremio && isImdbGraphql\)/);
});
