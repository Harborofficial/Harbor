import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import "./_localstorage-stub.ts";
import * as lists from "../src/lib/publicmetadb/lists.ts";
import * as watchlist from "../src/lib/publicmetadb/watchlist.ts";
import * as session from "../src/lib/publicmetadb/session.ts";
import * as hooks from "../src/lib/publicmetadb/list-hooks.ts";

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports as T;
}

async function fixture() {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://fixture.invalid" });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  session.resetForProfile();
  session.setSession({ apiKey: "pm-ui-placeholder", validatedAt: 1 });
  lists.clearPmdbListsCache();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method: string }> = [];
  const owned = [
    { id: "watch", name: "Watchlist", type: "watchlist" },
    { id: "weekend", name: "Weekend", type: "custom" },
    { id: "anime", name: "Anime", type: "custom" },
  ];
  const contents = new Map(owned.map(({ id }) => [id, [
    { id: `${id}-item`, list_id: id, tmdb_id: 603, media_type: "movie", title: `${id} film` },
  ]]));
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: init?.method ?? "GET" });
    if (url.pathname === "/api/external/lists") return Response.json({ items: owned, total: owned.length });
    const id = url.pathname.split("/")[4];
    if (init?.method === "GET") {
      const items = contents.get(id) ?? [];
      return Response.json({ items, total: items.length });
    }
    if (init?.method === "POST") {
      const target = JSON.parse(String(init.body));
      contents.get(id)!.push({ ...target, id: `${id}-${target.tmdb_id}`, list_id: id, title: "Added film" });
    } else if (init?.method === "DELETE") {
      const itemId = url.pathname.split("/")[6];
      contents.set(id, contents.get(id)!.filter((item) => item.id !== itemId));
    }
    return Response.json({ success: true });
  };
  const resolveTargetAsync = async () => ({ tmdb_id: 604, media_type: "movie" });
  const common = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "@/lib/publicmetadb/lists": lists,
    "@/lib/publicmetadb/watchlist": watchlist,
    "@/lib/publicmetadb/session": session,
    "@/lib/publicmetadb/list-hooks": hooks,
    "@/lib/publicmetadb/provider": {
      usePublicMetaDb: () => {
        const current = React.useSyncExternalStore(session.subscribeSession, session.getSession);
        return { session: current, isConnected: !!current, resolveTargetAsync };
      },
    },
    // Match useT's production behavior: its returned function changes every render.
    "@/lib/i18n": { useT: () => (key: string, vars?: Record<string, unknown>) => key.replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? name)) },
  };
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 50; i++) {
      await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      if (predicate()) return;
    }
    assert.fail(`UI did not settle: ${document.body.textContent}`);
  };
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent === text)!;
  return {
    common, calls, root, until, button, dom,
    choose: async (value: string) => {
      await React.act(async () => {
        const select = document.querySelector("select")!;
        select.value = value;
        select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      });
    },
    close: async () => {
      await React.act(async () => root.unmount());
      globalThis.fetch = originalFetch;
      session.setSession(null);
      localStorage.clear();
      dom.window.close();
    },
  };
}

test("PMDB library restores a session changed before subscription, saves defaults, and removes from the viewed list", async () => {
  const h = await fixture();
  try {
    const provider = load<typeof import("../src/lib/publicmetadb/provider.tsx")>("src/lib/publicmetadb/provider.tsx", {
      react: React,
      "react/jsx-runtime": jsxRuntime,
      "./client": {},
      "./history": {},
      "./ids": {},
      "./pending-sync": { armOnlineFlush: () => () => {}, flushPendingResumes: async () => {} },
      "./scrobble": {},
      "./session": session,
      "./watchlist": watchlist,
      "./lists": lists,
    });
    const { PublicMetaDbTab } = load<typeof import("../src/views/library/publicmetadb-tab.tsx")>("src/views/library/publicmetadb-tab.tsx", {
      ...h.common,
      "@/lib/publicmetadb/provider": provider,
      "lucide-react": { RefreshCw: () => null },
      "@/components/dropdown": {
        Dropdown: ({ value, options, onChange, ariaLabel }: any) => React.createElement("select", {
          value, "aria-label": ariaLabel, onChange: (event: any) => onChange(event.target.value),
        }, options.map((option: any) => React.createElement("option", { key: option.value, value: option.value }, option.label))),
      },
      "@/lib/settings": { useSettings: () => ({ settings: { librarySort: "added" } }) },
      "./featured-context": { useReportFeatured: () => {} },
      "./shared": {
        applyFilter: (entries: any) => entries,
        countByType: () => ({}),
        FilterBar: () => null,
        SortControl: () => null,
        parseTs: () => null,
        sortedGroups: (items: any) => [{ label: "Titles", items }],
        GroupedGrid: ({ groups, onRemoveLocal }: any) => React.createElement("div", {}, groups.flatMap((group: any) => group.items.map((item: any) => React.createElement("div", { key: item.key },
          item.meta.name, React.createElement("button", { onClick: () => onRemoveLocal(item.localId) }, "Remove viewed item"),
        )))),
      },
    });
    function RestoreBeforeSubscription() {
      React.useLayoutEffect(() => { session.resetForProfile(); }, []);
      return React.createElement(PublicMetaDbTab);
    }
    await React.act(async () => h.root.render(React.createElement(
      provider.PublicMetaDbProvider, null, React.createElement(RestoreBeforeSubscription),
    )));
    await h.until(() => document.body.textContent!.includes("watch film"));
    await h.choose("weekend");
    await h.until(() => document.body.textContent!.includes("weekend film"));
    assert.equal(lists.getPmdbDefaultListId(), null);
    await React.act(async () => h.button("Set as default").click());
    await h.until(() => document.body.textContent!.includes("weekend film") && !!h.button("Default list"));
    assert.equal(lists.getPmdbDefaultListId(), "weekend");
    await h.choose("anime");
    await h.until(() => document.body.textContent!.includes("anime film"));
    assert.equal(document.body.textContent!.includes("weekend film"), false);
    assert.equal(lists.getPmdbDefaultListId(), "weekend");
    await React.act(async () => h.button("Remove viewed item").click());
    await h.until(() => h.calls.some((call) => call.method === "DELETE"));
    assert.ok(h.calls.some((call) => call.method === "DELETE" && call.path.endsWith("/anime/items/anime-item")));
    assert.equal(h.calls.some((call) => call.method === "DELETE" && call.path.includes("/weekend/")), false);
    assert.ok(h.calls.length < 15, "rendering must not repeatedly reload lists");
  } finally { await h.close(); }
});

test("PMDB detail button observes defaults and stays mounted while added membership refreshes", async () => {
  const h = await fixture();
  try {
    const { AddToPmdbButton } = load<typeof import("../src/views/detail/add-to-publicmetadb-button.tsx")>("src/views/detail/add-to-publicmetadb-button.tsx", {
      ...h.common,
      "lucide-react": { Check: () => null, Plus: () => null },
      "@/assets/publicmetadb.svg": { default: "fixture.svg" },
      "@/components/hover-tooltip": { HoverTooltip: ({ children, label }: any) => React.createElement("div", { title: label }, children) },
      "@/lib/publicmetadb/mappings": { getTmdbForExternal: async () => null },
    });
    await React.act(async () => h.root.render(React.createElement(AddToPmdbButton, { harborId: "tmdb:movie:604", title: "Fixture", type: "movie" })));
    await h.until(() => !!h.button("Add to PMDB"));
    await React.act(async () => lists.setPmdbDefaultListId("weekend"));
    await h.until(() => !!document.querySelector('[title="Add Fixture to Weekend on PMDB"]'));
    const button = h.button("Add to PMDB");
    let removed = false;
    const observer = new h.dom.window.MutationObserver((records) => {
      for (const record of records) {
        if ([...record.removedNodes].some((node) => node === button || node.contains(button))) removed = true;
      }
    });
    observer.observe(document.getElementById("root")!, { childList: true, subtree: true });
    await React.act(async () => button.click());
    await h.until(() => h.calls.some((call) => call.method === "POST"));
    await h.until(() => !!h.button("In PMDB") && h.calls.filter((call) => call.path.endsWith("/items") && call.method === "GET").length >= 3);
    assert.equal(removed, false, "the PMDB button must stay mounted during the post-save refresh");
    assert.equal(h.button("In PMDB"), button);
    assert.ok(h.calls.some((call) => call.method === "POST" && call.path.endsWith("/weekend/items")));
    await h.until(() => !button.disabled);
    await React.act(async () => button.click());
    await h.until(() => !!h.button("Add to PMDB") && h.calls.some((call) => call.method === "DELETE") &&
      h.calls.filter((call) => call.path.endsWith("/items") && call.method === "GET").length >= 5);
    observer.disconnect();
    assert.equal(removed, false, "removing membership must also keep the button mounted");
    assert.equal(h.button("Add to PMDB"), button);
    assert.ok(h.calls.length < 22, "rendering must not repeatedly reload membership");
  } finally { await h.close(); }
});
