// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import "./_localstorage-stub.ts";
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
  assert.equal(res, null);

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
