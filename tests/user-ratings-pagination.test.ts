import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function deferred() {
  let resolve!: (page: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const counts = { total: 300, movie: 100, series: 120, anime: 60, manga: 20 };
const treeText = (value: any): string => {
  if (value == null || typeof value === "boolean") return "";
  if (Array.isArray(value)) return value.map(treeText).join("");
  return typeof value === "object" ? treeText(value.props?.children) : String(value);
};

const page = (
  ids: string[],
  nextCursor?: string,
  totals = counts,
  scores?: number[],
  reviews: (string | undefined)[] = [],
) => ({
  items: ids.map((itemKey, i) => ({
    itemKey,
    title: itemKey,
    mediaType: "movie",
    score: scores?.[i] ?? 8,
    at: "2026-01-01",
    review: reviews[i],
  })),
  nextCursor,
  counts: totals,
  avg: 8,
});

function ratingsHarness(options: { failRate?: boolean; deferRates?: boolean } = {}) {
  const states: any[] = [],
    refs: any[] = [],
    memos: any[] = [];
  const effects: Array<{ deps: any[]; cleanup?: () => void }> = [];
  let si = 0,
    ri = 0,
    mi = 0,
    ei = 0,
    dirty = false,
    mounted = true,
    writesAfterUnmount = 0;
  let pending: Array<{ i: number; deps: any[]; run: () => any }> = [];
  let componentStateStart = 0;
  const same = (a: any[], b: any[]) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial: any) {
      const i = si++;
      if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
      return [
        states[i],
        (value: any) => {
          if (!mounted) writesAfterUnmount++;
          const next = typeof value === "function" ? value(states[i]) : value;
          if (!Object.is(next, states[i])) {
            states[i] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial: any) {
      return refs[ri++] ?? (refs[ri - 1] = { current: initial });
    },
    useCallback(fn: any, deps: any[]) {
      const i = mi++;
      if (!memos[i] || !same(memos[i].deps, deps)) memos[i] = { fn, deps };
      return memos[i].fn;
    },
    useEffect(run: () => any, deps: any[]) {
      const i = ei++;
      if (!effects[i] || !same(effects[i].deps, deps)) pending.push({ i, deps, run });
    },
  };
  const requests: Array<{
    handle: string;
    opts: any;
    signal?: AbortSignal;
    job: ReturnType<typeof deferred>;
  }> = [];
  const jsx = (type: any, props: any, key: any) => ({ type, props, key });
  const rates: Array<{ itemKey: string; score: number; review?: string }> = [];
  const rateJobs: Array<ReturnType<typeof deferred>> = [];
  const mocks: Record<string, any> = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-dom": { createPortal: (child: any) => child },
    "lucide-react": {
      ChevronDown: "chevron-down",
      ChevronUp: "chevron-up",
      Eye: "eye",
      Loader2: "loader",
      MessageSquare: "message-square",
      X: "x",
    },
    "@/lib/ratings/poster": { useRatingPoster: () => null },
    "@/components/poster": { Poster: "poster" },
    "@/components/ratings/rating-stars": { RatingStars: "rating-stars" },
    "@/views/profile/profile-bits": { timeAgo: () => "today" },
    "@/views/profile/use-profile-title": {
      useProfileTitle: (itemKey: string, title: string, poster: string) => ({
        ref: null,
        title: title || itemKey,
        poster,
      }),
    },
    "@/lib/social/profile-media-meta": { profileMediaMeta: () => ({}) },
    "@/components/context-menu/use-title-context": { useTitleContext: () => () => {} },
    "@/lib/i18n": { useT: () => (value: string) => value },
    "@/views/profile/profile-theme-context": { useProfileThemeSurfaceStyle: () => ({}) },
    "@/components/icons/search-icon": { Search: "search" },
    "@/lib/ratings/actions": {
      REVIEW_MAX: 4000,
      rate(target: any, score: number, extra: any) {
        rates.push({ itemKey: target.itemKey, score, review: extra?.review });
        if (options.deferRates) {
          const job = deferred();
          rateJobs.push(job);
          return job.promise;
        }
        return options.failRate ? Promise.reject(new Error("fixture offline")) : Promise.resolve();
      },
      unrate() {
        return Promise.resolve();
      },
    },
    "@/lib/social/ratings-api": {
      fetchUserRatings(handle: string, opts: any, signal?: AbortSignal) {
        const job = deferred();
        requests.push({ handle, opts, signal, job });
        return job.promise;
      },
    },
  };
  const source = readFileSync(
    new URL("../src/views/ratings/user-ratings.tsx", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports: any = {};
  new Function("require", "exports", "window", "document", output)(
    (id: string) => {
      assert.ok(id in mocks, `unexpected import ${id}`);
      return mocks[id];
    },
    exports,
    { addEventListener() {}, removeEventListener() {} },
    { body: { style: { overflow: "" } } },
  );
  let props = { handle: "alice", alias: "Alice", onClose() {} },
    tree: any;
  function render(patch = {}) {
    props = { ...props, ...patch };
    let loops = 0;
    do {
      assert.ok(++loops < 10, "render should settle");
      dirty = false;
      si = ri = mi = ei = 0;
      pending = [];
      tree = exports.UserRatings(props);
      componentStateStart = si;
      for (const effect of pending) effects[effect.i]?.cleanup?.();
      for (const effect of pending)
        effects[effect.i] = { deps: effect.deps, cleanup: effect.run() };
    } while (dirty);
  }
  function nodes(value: any): any[] {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap((child) => nodes(child));
    return [value, ...nodes(value.props?.children ?? null)];
  }
  function treeText(value: any): string {
    if (value == null || typeof value === "boolean") return "";
    if (Array.isArray(value)) return value.map(treeText).join("");
    return typeof value === "object" ? treeText(value.props?.children) : String(value);
  }
  function button(label: string) {
    const found = nodes(tree).find(
      (n) => n.type === "button" && treeText(n.props.children).startsWith(label),
    );
    assert.ok(found, `missing button ${label}`);
    return found;
  }
  function rowView(itemKey: string) {
    const component = nodes(tree).find((n) => n.props?.r?.itemKey === itemKey);
    assert.ok(component, `missing row ${itemKey}`);
    assert.equal(typeof component.type, "function", "rating row component should be renderable");
    si = componentStateStart;
    return nodes(component.type(component.props));
  }
  function rowText(itemKey: string): string {
    const component = nodes(tree).find((n) => n.props?.r?.itemKey === itemKey);
    assert.ok(component, `missing row ${itemKey}`);
    si = componentStateStart;
    return treeText(component.type(component.props));
  }
  function input() {
    const found = nodes(tree).find((n) => n.type === "input");
    assert.ok(found, "missing search input");
    return found;
  }
  async function settle() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    render();
  }
  async function resolve(index: number, value: any) {
    requests[index].job.resolve(value);
    await settle();
  }
  render();
  return {
    requests,
    render,
    resolve,
    settle,
    button,
    bodyText: () => treeText(tree),
    rows: () => nodes(tree).filter((n) => n.props?.r),
    rowView,
    rowText,
    rates: () => rates,
    rateJobs,
    reject(index: number, error = new Error("fixture offline")) {
      requests[index].job.reject(error);
      return settle();
    },
    type(value: string) {
      input().props.onChange({ target: { value } });
      render();
    },
    order(which: string) {
      const target =
        which === "default"
          ? nodes(tree).find(
              (n) => n.props?.["aria-pressed"] === true && n.props?.["aria-label"] !== undefined,
            )
          : nodes(tree).find(
              (n) =>
                n.props?.["aria-label"] ===
                (which === "high" ? "Highest rated first" : "Lowest rated first"),
            );
      assert.ok(target, `missing ordering control for ${which}`);
      target.props.onClick();
      render();
    },
    startSubmitRow(itemKey: string, score: number, review?: string) {
      const row = nodes(tree).find((n) => n.props?.r?.itemKey === itemKey);
      assert.ok(row, `missing row ${itemKey}`);
      assert.ok(row.props.onRate, "row is not editable");
      const pending = row.props.onRate(row.props.r, score, review);
      render();
      return pending;
    },
    async submitRow(itemKey: string, score: number, review?: string) {
      const pending = this.startSubmitRow(itemKey, score, review);
      await pending;
      await settle();
    },
    click(label: string) {
      const result = button(label).props.onClick();
      render();
      return result;
    },
    ids: () =>
      nodes(tree)
        .filter((n) => n.props?.r)
        .map((n) => n.props.r.itemKey),
    buttons: () =>
      nodes(tree)
        .filter((n) => n.type === "button")
        .map((n) => treeText(n.props.children)),
    unmount() {
      mounted = false;
      effects.forEach((effect) => effect.cleanup?.());
    },
    writesAfterUnmount: () => writesAfterUnmount,
  };
}

test("ratings append every server page without a 240-item client limit", async () => {
  const h = ratingsHarness();
  for (let i = 0; i < 6; i++) {
    await h.resolve(
      i,
      page(
        Array.from({ length: 50 }, (_, n) => `title-${i * 50 + n}`),
        i < 5 ? `cursor-${i + 1}` : undefined,
      ),
    );
    if (i < 5) h.click("Load more");
  }
  assert.equal(h.ids().length, 300);
  assert.equal(new Set(h.ids()).size, 300);
  assert.ok(!h.buttons().includes("Load more"));
  assert.deepEqual(
    h.requests.map((r) => r.opts.cursor),
    [undefined, "cursor-1", "cursor-2", "cursor-3", "cursor-4", "cursor-5"],
  );
});

for (const finishFirst of [false, true]) {
  test(`old pagination cannot contaminate another tab (${finishFirst ? "before" : "after"} its first page)`, async () => {
    const h = ratingsHarness();
    await h.resolve(0, page(["all-1"], "all-next"));
    h.click("Load more");
    h.click("Movies");
    if (finishFirst) await h.resolve(1, page(["all-2"], "wrong-cursor"));
    await h.resolve(2, page(["movie-1"], "movie-next"));
    if (!finishFirst) await h.resolve(1, page(["all-2"], "wrong-cursor"));
    assert.deepEqual(h.ids(), ["movie-1"]);
    assert.equal(h.requests[1].signal?.aborted, true);
    h.click("Load more");
    assert.deepEqual(h.requests[3].opts, { type: "movie", cursor: "movie-next" });
  });
}

test("new tab pagination proceeds while its cancelled predecessor remains pending", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["all-1"], "all-next"));
  h.click("Load more");
  h.click("Movies");
  await h.resolve(2, page(["movie-1"], "movie-next"));
  assert.equal(h.button("Load more").props.disabled, false);
  h.click("Load more");
  await h.resolve(1, page(["old"], "wrong"));
  assert.equal(
    h.button("Load more").props.disabled,
    true,
    "old completion cannot unlock the active request",
  );
  await h.resolve(3, page(["movie-2"]));
  assert.deepEqual(h.ids(), ["movie-1", "movie-2"]);
});

test("repeated activation before a rerender requests the cursor once", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["one"], "next"));
  const click = h.button("Load more").props.onClick;
  click();
  click();
  assert.equal(h.requests.length, 2);
  await h.resolve(1, page(["two"]));
  assert.deepEqual(h.ids(), ["one", "two"]);
});

test("changing profile resets counts and ignores the old profile's next page", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["alice-all"], "next"));
  h.click("Movies");
  await h.resolve(1, page(["alice-movie"], "movie-next"));
  h.click("Load more");
  h.render({ handle: "bob", alias: "Bob" });
  const bobCounts = { total: 9, movie: 9, series: 0, anime: 0, manga: 0 };
  await h.resolve(3, page(["bob-movie"], undefined, bobCounts));
  await h.resolve(2, page(["alice-old"]));
  assert.deepEqual(h.ids(), ["bob-movie"]);
  assert.ok(h.buttons().includes("All9"));
  assert.ok(h.buttons().includes("Movies9"));
  assert.ok(!h.buttons().some((name) => name.startsWith("TV")));
});

test("closing ratings cancels pagination and prevents late state writes", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["one"], "next"));
  h.click("Load more");
  h.unmount();
  h.requests[1].job.resolve(page(["two"]));
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(h.requests[1].signal?.aborted, true);
  assert.equal(h.writesAfterUnmount(), 0);
});

test("failed pagination retains its items/cursor and can be retried", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["one"], "next"));
  const pending = h.click("Load more");
  h.requests[1].job.reject(new Error("fixture offline"));
  await pending;
  await h.settle();
  assert.deepEqual(h.ids(), ["one"]);
  assert.equal(h.button("Load more").props.disabled, false);
  h.click("Load more");
  assert.deepEqual(h.requests[2].opts, { type: "all", cursor: "next" });
  await h.resolve(2, page(["two"]));
  assert.deepEqual(h.ids(), ["one", "two"]);
});

test("a search walks the remaining cursor chain so matches past the first page are found", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["alpha", "beta"], "cursor-1"));
  assert.deepEqual(h.ids(), ["alpha", "beta"]);
  h.type("target");
  assert.deepEqual(h.requests[1].opts, { type: "all", cursor: "cursor-1" });
  await h.resolve(1, page(["gamma", "target-two"], "cursor-2"));
  assert.deepEqual(h.ids(), ["target-two"], "search streams matches while the walk continues");
  await h.resolve(2, page(["target-three"]));
  assert.deepEqual(h.ids(), ["target-two", "target-three"]);
  assert.ok(!h.buttons().includes("Load more"), "a completed search leaves nothing to paginate");
});

test("a search matches titles case-insensitively without reloading the first page", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["Target One", "other"], "cursor-1"));
  h.type("TARGET");
  assert.deepEqual(h.ids(), ["Target One"]);
  assert.deepEqual(
    h.requests.map((r) => r.opts.cursor),
    [undefined, "cursor-1"],
    "the first page is reused, not refetched",
  );
});

test("clearing the search keeps the pages the walk loaded", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["alpha"], "cursor-1"));
  h.type("target");
  await h.resolve(1, page(["target-two"], "cursor-2"));
  assert.deepEqual(h.ids(), ["target-two"]);
  // The walk has already asked for cursor-2; clearing abandons that in-flight
  // request (the controller is shared with tab pagination) but issues no new one.
  const issued = h.requests.length;
  h.type("");
  assert.equal(h.requests.length, issued, "clearing must not issue another request");
  assert.deepEqual(h.ids(), ["alpha", "target-two"]);
});

test("a query with no matches reports it rather than showing the empty-ratings message", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["alpha"]));
  h.type("zeta");
  assert.deepEqual(h.ids(), []);
  assert.ok(h.bodyText().includes("No ratings match your search"));
});

test("switching tabs during a search cancels the old walk and paginates the new tab", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["alpha"], "next"));
  h.type("target");
  h.click("Movies");
  await h.resolve(2, page(["target-movie"], "movie-next"));
  await h.resolve(1, page(["stale"], "stale-next"));
  assert.deepEqual(h.ids(), ["target-movie"]);
  assert.equal(h.requests[1].signal?.aborted, true);
  assert.deepEqual(h.requests[3].opts, { type: "movie", cursor: "movie-next" });
});

test("closing during a search walk cancels it and writes nothing after unmount", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["alpha"], "cursor-1"));
  h.type("target");
  assert.equal(h.requests[1].opts.cursor, "cursor-1");
  h.unmount();
  h.requests[1].job.resolve(page(["target-two"], "cursor-2"));
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(h.requests[1].signal?.aborted, true);
  assert.equal(h.requests.length, 2, "an aborted walk must not request another page");
  assert.equal(h.writesAfterUnmount(), 0);
});

test("ordering by highest rating finishes the pagination before it sorts", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["a", "b"], "cursor-1", counts, [3, 9]));
  assert.deepEqual(h.ids(), ["a", "b"], "ordering off keeps the server order");
  h.order("high");
  assert.deepEqual(h.requests[1].opts, { type: "all", cursor: "cursor-1" });
  await h.resolve(1, page(["c"], undefined, counts, [7]));
  assert.deepEqual(h.ids(), ["b", "c", "a"]);
});

test("ordering by lowest rating sorts ascending", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["a", "b", "c"], undefined, counts, [5, 1, 9]));
  h.order("low");
  assert.deepEqual(h.ids(), ["b", "a", "c"]);
  assert.equal(h.requests.length, 1, "a fully loaded list needs no further page");
});

test("returning to the default order restores the server order without a walk", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["a", "b"], undefined, counts, [1, 5]));
  h.order("high");
  assert.deepEqual(h.ids(), ["b", "a"]);
  h.order("default");
  assert.deepEqual(h.ids(), ["a", "b"]);
  assert.equal(h.requests.length, 1, "ordering off must not trigger a walk");
});

test("a visitor gets no quick-edit affordance", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["alpha"]));
  assert.ok(h.rows().every((row) => row.props.onRate === undefined));
});

test("the profile owner can change a score in place and it is saved", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["alpha", "beta"]));
  h.render({ isOwner: true });
  await h.submitRow("alpha", 4);
  assert.deepEqual(h.rates(), [{ itemKey: "alpha", score: 4, review: undefined }]);
  assert.equal(h.rows().find((n) => n.props.r.itemKey === "alpha")?.props.r.score, 4);
  assert.equal(h.rows().find((n) => n.props.r.itemKey === "beta")?.props.r.score, 8);
});

test("a rejected quick edit rolls the row back to the saved score", async () => {
  const h = ratingsHarness({ failRate: true });
  await h.resolve(0, page(["alpha"]));
  h.render({ isOwner: true });
  await h.submitRow("alpha", 3);
  assert.equal(h.rows()[0]?.props.r.score, 8, "a failed save must not look saved");
});

test("a failed automatic page stays visibly incomplete and retries from its cursor", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["one", "two"], "cursor-1"));
  h.type("missing");
  assert.deepEqual(h.requests[1].opts, { type: "all", cursor: "cursor-1" });
  await h.reject(1);
  assert.ok(h.bodyText().includes("Could not load all ratings"));
  assert.ok(
    !h.bodyText().includes("No ratings match your search"),
    "an incomplete search must not be reported as having no matches",
  );
  h.click("Retry");
  assert.deepEqual(
    h.requests[2].opts,
    { type: "all", cursor: "cursor-1" },
    "retry starts from the failed page rather than resetting or skipping it",
  );
  await h.resolve(2, page(["missing-title"]));
  assert.deepEqual(h.ids(), ["missing-title"]);
  assert.ok(!h.bodyText().includes("Could not load all ratings"));
});

test("ordering holds the list until every page is loaded so the order never churns", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["a", "b"], "cursor-1", counts, [3, 9]));
  h.order("high");
  assert.deepEqual(h.ids(), [], "a part-loaded order is not shown");
  assert.ok(h.bodyText().includes("Loading all ratings"));
  await h.resolve(1, page(["c"], undefined, counts, [7]));
  assert.deepEqual(h.ids(), ["b", "c", "a"], "the settled order is shown once");
});

test("a pending save stays locked across rating tab switches", async () => {
  const h = ratingsHarness({ deferRates: true });
  await h.resolve(0, page(["alpha"], undefined, counts, [8], ["original"]));
  h.render({ isOwner: true });

  const first = h.startSubmitRow("alpha", 6, "new review");
  assert.equal(h.rateJobs.length, 1);
  h.click("TV");
  await h.resolve(1, page([]));
  h.click("All");
  await h.resolve(2, page(["alpha"], undefined, counts, [8], ["original"]));

  assert.equal(h.rows()[0]?.props.pendingSave, true);
  const buttons = h.rowView("alpha").filter((n) => n.type === "button");
  assert.ok(
    buttons.some((n) => treeText(n.props.children) === "Saving…" && n.props.disabled),
    "a remounted row stays locked while its earlier save is in flight",
  );
  assert.equal(
    await h.startSubmitRow("alpha", 3, "overlapping edit"),
    false,
    "the parent refuses overlapping saves even if a stale row callback runs",
  );
  assert.equal(h.rateJobs.length, 1, "switching tabs cannot submit a second server write");

  h.rateJobs[0].resolve(undefined);
  assert.equal(await first, true);
  await h.settle();
  assert.equal(h.rows()[0]?.props.r.score, 6);
  assert.equal(h.rows()[0]?.props.r.review, "new review");
  assert.equal(h.rows()[0]?.props.pendingSave, false);
});

test("an owner edit reports failure and retains the draft for retry", async () => {
  const h = ratingsHarness({ failRate: true });
  await h.resolve(0, page(["alpha"]));
  h.render({ isOwner: true });
  const rowButtons = () => h.rowView("alpha").filter((n) => n.type === "button");
  rowButtons()
    .find((n) => treeText(n.props.children) === "Edit")!
    .props.onClick();
  h.render();
  const editNodes = h.rowView("alpha");
  const stars = editNodes.find((n) => n.type === "rating-stars");
  assert.ok(stars, "edit mode renders the score control");
  stars.props.onChange(3);
  h.render();
  const editButtons = rowButtons();
  const save = editButtons.find((n) => treeText(n.props.children) === "Save changes");
  assert.ok(save, "edit mode exposes Save changes");
  await save.props.onClick();
  h.render();
  assert.equal(h.rows()[0]?.props.r.score, 8, "the saved value rolls back on the current failure");
  assert.ok(h.rowText("alpha").includes("Could not save this rating"));
  assert.ok(
    rowButtons().some((n) => treeText(n.props.children) === "Save changes"),
    "editing remains open for a retry",
  );
});

test("the edit form stays open while a save is pending, preventing a second save", async () => {
  const h = ratingsHarness({ deferRates: true });
  await h.resolve(0, page(["alpha"]));
  h.render({ isOwner: true });
  const rowButtons = () => h.rowView("alpha").filter((n) => n.type === "button");
  rowButtons()
    .find((n) => treeText(n.props.children) === "Edit")!
    .props.onClick();
  h.render();
  const editNodes = h.rowView("alpha");
  const stars = editNodes.find((n) => n.type === "rating-stars");
  assert.ok(stars, "edit mode renders the score control");
  stars.props.onChange(3);
  h.render();
  const save = rowButtons().find((n) => treeText(n.props.children) === "Save changes");
  assert.ok(save);
  const pending = save.props.onClick();
  h.render();
  const pendingButtons = rowButtons();
  assert.ok(
    pendingButtons.some((n) => treeText(n.props.children) === "Saving…" && n.props.disabled),
    "Save stays disabled and reports its pending state",
  );
  assert.ok(
    !pendingButtons.some((n) => treeText(n.props.children) === "Edit"),
    "the user cannot reopen the row and start an overlapping save",
  );
  assert.ok(
    pendingButtons.some((n) => treeText(n.props.children) === "Cancel" && n.props.disabled),
    "the pending save cannot be dismissed while its result is unknown",
  );
  h.rateJobs[0].resolve(undefined);
  await pending;
  h.render();
  assert.ok(rowButtons().some((n) => treeText(n.props.children) === "Edit"));
});

test("an owner edit saves the review text alongside the score", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["alpha"], undefined, counts, [8], ["first watch"]));
  h.render({ isOwner: true });
  await h.submitRow("alpha", 6, "second watch");
  assert.deepEqual(h.rates(), [{ itemKey: "alpha", score: 6, review: "second watch" }]);
  assert.equal(h.rows()[0]?.props.r.score, 6);
  assert.equal(h.rows()[0]?.props.r.review, "second watch");
});

test("clearing the review text sends it as absent rather than blank", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["alpha"], undefined, counts, [8], ["first watch"]));
  h.render({ isOwner: true });
  await h.submitRow("alpha", 8, "   ");
  assert.deepEqual(h.rates(), [{ itemKey: "alpha", score: 8, review: undefined }]);
  assert.equal(h.rows()[0]?.props.r.review, undefined);
});

test("the review filter walks the whole list and keeps only ratings with a review", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["a", "b"], "cursor-1", counts, undefined, [undefined, "loved it"]));
  assert.deepEqual(h.ids(), ["a", "b"], "the filter is off by default");
  h.click("With review");
  assert.deepEqual(h.requests[1].opts, { type: "all", cursor: "cursor-1" });
  await h.resolve(1, page(["c", "d"], undefined, counts, undefined, ["also good", undefined]));
  assert.deepEqual(h.ids(), ["b", "c"]);
});

test("a search started during Load More waits for its page instead of taking the same cursor", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["all-1"], "cursor-1"));
  h.click("Load more"); // manual page in flight for cursor-1
  h.type("target"); // the walk must not ask for cursor-1 as well
  assert.equal(h.requests.length, 2, "the walk waits for the page Load More is fetching");
  await h.resolve(1, page(["all-2", "target-2"], "cursor-2"));
  assert.deepEqual(
    h.requests[2].opts,
    { type: "all", cursor: "cursor-2" },
    "the walk continues from the cursor the manual page left behind",
  );
  await h.resolve(2, page(["target-3"]));
  assert.deepEqual(h.ids(), ["target-2", "target-3"], "the search shows matches only, once each");
  h.type("");
  assert.deepEqual(
    h.ids(),
    ["all-1", "all-2", "target-2", "target-3"],
    "clearing the search shows every page both paths loaded, in order",
  );
  assert.equal(new Set(h.ids()).size, h.ids().length, "no rating may be appended twice");
});

test("Load More waits for the walk's page instead of racing it for the cursor", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["a"], "cursor-1"));
  const loadMore = h.button("Load more").props.onClick;
  h.type("target"); // the walk takes cursor-1, and hides the button behind its spinner
  loadMore(); // the captured click must still be refused by the guard
  assert.equal(h.requests.length, 2, "Load More must not request a page the walk is fetching");
  await h.resolve(1, page(["target-2"], "cursor-2"));
  await h.resolve(2, page(["target-3"]));
  assert.deepEqual(h.ids(), ["target-2", "target-3"]);
  assert.equal(new Set(h.ids()).size, 2, "no rating may be appended twice");
});

test("a page that repeats an already loaded rating only appends the new one", async () => {
  const h = ratingsHarness();
  await h.resolve(0, page(["a", "b"], "cursor-1"));
  h.click("Load more");
  await h.resolve(1, page(["b", "c"], "cursor-2"));
  assert.deepEqual(h.ids(), ["a", "b", "c"]);
  assert.equal(new Set(h.ids()).size, 3);
});

test("the review filter and a query apply together", async () => {
  const h = ratingsHarness();
  await h.resolve(
    0,
    page(["alpha", "beta"], undefined, counts, undefined, ["seen it", "seen it too"]),
  );
  h.type("beta");
  assert.deepEqual(h.ids(), ["beta"]);
  h.click("With review");
  assert.deepEqual(h.ids(), ["beta"]);
  h.type("alpha");
  assert.deepEqual(h.ids(), ["alpha"]);
});

test("clearing a review keeps its filtered editor and error visible until the save settles", async () => {
  const h = ratingsHarness({ deferRates: true });
  await h.resolve(0, page(["alpha", "beta"], undefined, counts, [8, 7], ["a review"]));
  h.render({ isOwner: true });
  h.click("With review");
  assert.deepEqual(h.ids(), ["alpha"]);

  const buttons = () => h.rowView("alpha").filter((n) => n.type === "button");
  buttons()
    .find((n) => treeText(n.props.children) === "Edit")!
    .props.onClick();
  h.render();
  h.rowView("alpha")
    .find((n) => n.type === "textarea")!
    .props.onChange({ target: { value: "" } });
  h.render();
  const pending = buttons()
    .find((n) => treeText(n.props.children) === "Save changes")!
    .props.onClick();
  h.render();
  assert.deepEqual(h.ids(), ["alpha"], "the row must remain visible while clearing its review");
  assert.equal(
    h.rows()[0]?.props.r.review,
    "a review",
    "the filter uses the saved review until success",
  );

  h.rateJobs[0].reject(new Error("network offline"));
  await pending;
  h.render();
  assert.deepEqual(h.ids(), ["alpha"], "a failed save must not remove the reviewed rating");
  assert.ok(h.rowText("alpha").includes("Could not save this rating"));
  assert.equal(
    h.rowView("alpha").find((n) => n.type === "textarea")?.props.value,
    "",
    "the blank review draft survives the error for retry",
  );

  const retry = buttons()
    .find((n) => treeText(n.props.children) === "Save changes")!
    .props.onClick();
  h.rateJobs[1].resolve(undefined);
  await retry;
  h.render();
  assert.deepEqual(
    h.ids(),
    [],
    "after a successful clear the review-only filter can remove the row",
  );
});
