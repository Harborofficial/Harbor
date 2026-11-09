import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path, mocks) {
  const { outputText } = ts.transpileModule(
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  );
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (name) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    },
    module,
    module.exports,
  );
  return module.exports;
}

test("background plugin lookups cannot use the interactive text transport", async () => {
  const calls = [];
  const response = () => new Response("catalog", { headers: { "content-type": "text/html" } });
  const { runPluginHttp } = load("src/lib/manga/plugins/host-http.ts", {
    "@/lib/safe-fetch": {
      FINAL_URL_HEADER: "x-harbor-final-url",
      safeFetch: async (...args) => {
        calls.push(["interactive", ...args]);
        return response();
      },
      safeFetchBytes: async (...args) => {
        calls.push(["quiet", ...args]);
        return response();
      },
    },
    "@/lib/privacy/blocklist": { isBlockedUrl: () => false },
    "@/lib/subtitles/provider-url": { SUBTITLE_PUBLIC_NETWORK_HEADER: "x-test-public" },
    "@/lib/same-site-host": { sameSiteHost: (a, b) => a === b },
  });
  const result = await runPluginHttp("https://source.example/catalog", {}, { background: true });
  assert.equal(result.body, "catalog");
  assert.equal(calls[0][0], "quiet");
  assert.equal(calls[0][3], 20_000);
  assert.equal(calls[0][4], 8 * 1024 * 1024);
  await runPluginHttp("https://source.example/chapter", {});
  assert.equal(calls[1][0], "interactive");
});

test("manga detail recommendations use the title source and retain routed result IDs", async () => {
  const calls = [];
  const titleSource = {
    id: "opened",
    search: async (query) => {
      calls.push(query);
      return [{ id: "next", title: "Next" }];
    },
  };
  const { searchMangaForTitleSource } = load("src/lib/manga/api.ts", {
    "@/lib/storage-recovery": {},
    "./sources": {
      ensureMangaSources: async () => {},
      activeMangaSourceId: () => "all",
      activeMangaProvider: () => {
        throw new Error("Must not query the browse source");
      },
    },
    "./sources/aggregate": {
      routeById: (id) => (id === "opened::book" ? { provider: titleSource, orig: "book" } : null),
    },
    "./sources/suwayomi/source-events": {},
    "./library-events": {},
    "./lang-filter": {},
    "./model": {},
  });
  assert.deepEqual(await searchMangaForTitleSource("opened::book", "Next"), [
    { id: "opened::next", title: "Next" },
  ]);
  assert.deepEqual(calls, ["Next"]);
  assert.deepEqual(await searchMangaForTitleSource("removed::book", "Next"), []);
  assert.deepEqual(await searchMangaForTitleSource("legacy-book", "Next"), []);
});

function effectFor(path, marker, globals) {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let callback;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "useEffect" &&
      node.arguments[0]?.getText(source).includes(marker)
    )
      callback = node.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback, `Missing effect: ${marker}`);
  const { outputText } = ts.transpileModule(`const effect = ${callback};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  return new Function(...Object.keys(globals), `${outputText}\nreturn effect;`)(
    ...Object.values(globals),
  );
}

test("manga browse loading does not run behind details or another page", async () => {
  let requests = 0;
  const globals = {
    settings: { mangaEnabled: true },
    isBrowse: false,
    topKind: "manga",
    setFeatured: () => {},
    popularManga: async () => {
      requests++;
      return [];
    },
  };
  effectFor("src/views/manga.tsx", "popularManga(0)", globals)();
  effectFor("src/views/manga.tsx", "popularManga(0)", {
    ...globals,
    isBrowse: true,
    topKind: "ebook",
  })();
  assert.equal(requests, 0);
  effectFor("src/views/manga.tsx", "popularManga(0)", { ...globals, isBrowse: true })();
  await Promise.resolve();
  assert.equal(requests, 1);
});

test("ebook catalog subscriptions only run while browsing and invalidate late results on exit", () => {
  let requests = 0;
  let subscriptions = 0;
  let unsubscribed = 0;
  const subscribe = () => {
    subscriptions++;
    return () => {
      unsubscribed++;
    };
  };
  const globals = {
    browsing: false,
    loadSources: () => {
      requests++;
    },
    subscribeEBookSources: subscribe,
    subscribeEBookExtensions: subscribe,
    sourceSeq: { current: 1 },
    searchTimer: { current: undefined },
    window: { clearTimeout() {} },
  };
  effectFor("src/views/ebook.tsx", "subscribeEBookSources(loadSources)", globals)();
  assert.equal(requests, 0);
  assert.equal(subscriptions, 0);
  const cleanup = effectFor("src/views/ebook.tsx", "subscribeEBookSources(loadSources)", {
    ...globals,
    browsing: true,
  })();
  assert.equal(requests, 1);
  assert.equal(subscriptions, 2);
  cleanup();
  assert.equal(globals.sourceSeq.current, 2);
  assert.equal(unsubscribed, 2);
});

test("background ebook searches keep a separate worker from user-selected source requests", async () => {
  const path = "src/lib/ebook/providers.ts";
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const mocks = Object.fromEntries(
    source.statements
      .filter(ts.isImportDeclaration)
      .map((entry) => [entry.moduleSpecifier.text, {}]),
  );
  const workers = [];
  mocks["./extensions"] = {
    subscribeEBookExtensions() {},
    loadEBookExtensions: async () => {},
    installedEBookPlugins: () => [{ id: "one", name: "One", enabled: true }],
  };
  mocks["./sources"] = { listEBookSources: () => [] };
  mocks["./api"] = { dedupeEBooks: (items) => items, mergeEBookMetadata: (items) => items };
  mocks["@/lib/manga/plugins/worker-host"] = {
    PluginWorker: class {
      constructor(_plugin, options) {
        this.background = options.httpPolicy.background;
        this.calls = 0;
        workers.push(this);
      }
      async call() {
        this.calls++;
        return [];
      }
    },
  };
  const api = load(path, mocks);
  await api.searchSourceEBookCatalog("Title", "all", { background: true });
  await api.searchSourceEBookCatalog("Title", "plugin:one");
  await api.searchSourceEBookCatalog("Another", "all", { background: true });
  assert.equal(workers.length, 2);
  assert.deepEqual(
    workers.map((worker) => [worker.background, worker.calls]),
    [
      [true, 2],
      [false, 1],
    ],
  );
});

test("alternate manga chapters use quiet providers while the opened source remains interactive", async () => {
  const calls = [];
  const provider = (id, background) => ({
    id,
    name: id,
    detail: async () => {
      calls.push([id, "detail", background]);
      return { id: "book", title: "Same Title" };
    },
    search: async () => {
      calls.push([id, "search", background]);
      return [{ id: "match", title: "Same Title" }];
    },
    chapters: async () => {
      calls.push([id, "chapters", background]);
      return [{ id: "chapter", title: "Chapter 1" }];
    },
  });
  const api = load("src/lib/manga/sources/aggregate.ts", {
    "@/lib/manga/sources": {
      aggregateSubProviders: (background = false) => [
        provider("opened", background),
        provider("other", background),
      ],
    },
  });
  const chunks = [];
  await api.streamAggregateChapters("opened::book", (chunk) => chunks.push(...chunk));
  assert.ok(
    calls.some(
      ([id, method, background]) => id === "opened" && method === "chapters" && !background,
    ),
  );
  assert.ok(
    calls.some(([id, method, background]) => id === "other" && method === "search" && background),
  );
  assert.ok(
    calls.some(([id, method, background]) => id === "other" && method === "chapters" && background),
  );
  assert.ok(calls.every(([id, , background]) => id === "opened" || background));
  assert.deepEqual(chunks.map((chapter) => chapter.id).sort(), [
    "opened::chapter",
    "other::chapter",
  ]);
  calls.length = 0;
  await api.aggregateProvider.chapters("opened::book");
  assert.ok(calls.some(([id]) => id === "other"));
  assert.ok(calls.every(([id, , background]) => id === "opened" || background));
  calls.length = 0;
  await api.streamAggregateChapters("removed::book", () =>
    assert.fail("Missing source returned chapters"),
  );
  assert.deepEqual(calls, []);
});

test("manga plugin workers isolate background requests and dispose both modes", async () => {
  const workers = [];
  const { pluginProvider, disposePlugin } = load("src/lib/manga/plugins/runtime.ts", {
    "./worker-host": {
      PluginWorker: class {
        constructor(_plugin, options) {
          this.background = options.httpPolicy.background;
          this.calls = [];
          workers.push(this);
        }
        async call(method) {
          this.calls.push(method);
          return [];
        }
        dispose() {
          this.disposed = true;
        }
      },
    },
    "./adapter": { toSummaries: (v) => v, toChapters: (v) => v },
  });
  const plugin = { id: "source", name: "Source" };
  await pluginProvider(plugin, true).search("Title", 0);
  await pluginProvider(plugin).chapters("book");
  await pluginProvider(plugin, true).chapters("match");
  assert.deepEqual(
    workers.map((worker) => [worker.background, worker.calls]),
    [
      [true, ["search", "chapters"]],
      [false, ["chapters"]],
    ],
  );
  disposePlugin(plugin.id);
  assert.ok(workers.every((worker) => worker.disposed));
});
