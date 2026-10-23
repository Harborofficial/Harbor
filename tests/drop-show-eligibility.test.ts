import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import ts from "typescript";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

type Settings = {
  mal?: boolean;
  anilist?: boolean;
  simkl?: boolean;
  pmdb?: boolean;
  trakt?: boolean;
  malEntry?: boolean;
  anilistEntry?: boolean;
  simklStatus?: string | null;
  simklWatched?: string[];
  pmdbWatched?: string[];
  pmdbWatchlist?: boolean;
  pmdbHistoryFails?: boolean;
  traktSource?: "watchlist" | "watched" | "dropped";
};

function fixture(settings: Settings) {
  const calls: string[] = [];
  let statusVersion = 0;
  const statusListeners = new Set<() => void>();
  const notifyStatus = () => { statusVersion++; for (const fn of statusListeners) fn(); };
  const pmdbSession = settings.pmdb ? { apiKey: "fixture" } : null;
  const traktSession = settings.trakt ? { accessToken: "fixture" } : null;
  const simklSession = settings.simkl ? { accessToken: "fixture" } : null;
  const malSession = settings.mal ? { accessToken: "fixture" } : null;
  const anilistSession = settings.anilist ? { accessToken: "fixture" } : null;
  const mods: Record<string, unknown> = {
    react: React,
    "./profiles": { useProfiles: () => ({ activeId: "profile-one" }) },
    "./tracker-status-events": { useTrackerStatusVersion: () => React.useSyncExternalStore(
      (fn) => { statusListeners.add(fn); return () => { statusListeners.delete(fn); }; },
      () => statusVersion,
    ) },
    "./publicmetadb/list-hooks": { usePmdbListsVersion: () => 0 },
    "./publicmetadb/session": { getSession: () => pmdbSession, subscribeSession: () => () => {} },
    "./trakt/session": { getSession: () => traktSession, subscribeSession: () => () => {} },
    "./simkl/session": { getSession: () => simklSession, subscribeSession: () => () => {} },
    "./mal/session": { getSession: () => malSession, subscribeSession: () => () => {} },
    "./anilist/session": { getSession: () => anilistSession, subscribeSession: () => () => {} },
    "./mal/mutations": { resolveMalMediaId: async () => 123, fetchListEntry: async () => {
      calls.push("mal");
      return { entry: settings.malEntry ? { status: "watching" } : null };
    } },
    "./anilist/sync": { resolveAnilistMediaId: async () => 123 },
    "./anilist/mutations": { fetchListEntry: async () => {
      calls.push("anilist");
      return { entry: settings.anilistEntry ? { status: "CURRENT" } : null };
    } },
    "./simkl/ids": { resolveSimklTarget: async (id: string) => ({ kind: "show", ids: { imdb: id } }) },
    "./simkl/list-status": { readSimklStateStrict: async (target: any) => {
      calls.push("simkl");
      return target.ids?.imdb === "tt777888"
        ? { status: null, watched: new Set() }
        : { status: settings.simklStatus ?? null, watched: new Set(settings.simklWatched ?? []) };
    } },
    "./publicmetadb/ids": { resolvePmdbTarget: async () => ({ tmdb_id: 555, media_type: "tv" }) },
    "./publicmetadb/mappings": { getTmdbForExternal: async () => ({ tmdb_id: 555 }) },
    "./publicmetadb/history": { fetchPmdbWatchedKeySet: async () => {
      calls.push("pmdb-history");
      if (settings.pmdbHistoryFails) throw new Error("history temporarily offline");
      return new Set(settings.pmdbWatched ?? []);
    } },
    "./publicmetadb/watchlist": {
      fetchPmdbWatchlist: async () => {
        calls.push("pmdb-list");
        return settings.pmdbWatchlist ? [{ tmdb_id: 555, media_type: "tv" }] : [];
      },
      pmdbWatchlistContains: (items: any[], target: any) =>
        items.find((row) => row.tmdb_id === target.tmdb_id && row.media_type === target.media_type) ?? null,
    },
    "./publicmetadb/lists": { getPmdbDefaultListId: () => null },
    "./trakt/ids": { stremioIdToTraktTarget: () => ({ ok: true, target: { kind: "show", ids: { imdb: "tt123456" } } }) },
    "./trakt/client": { traktRequest: async (path: string) => {
      calls.push(path);
      return path.includes(settings.traktSource ?? "IMPOSSIBLE")
        ? [{ show: { ids: { imdb: "tt123456" } } }]
        : [{ show: { ids: { imdb: "tt999999" } } }];
    } },
  };
  const js = ts.transpileModule(source("src/lib/drop-show-eligibility.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as { isShowTracked: (input: any) => Promise<boolean>; useCanDropShow: (input: any) => boolean } };
  new Function("require", "module", "exports", js)(
    (key: string) => {
      assert.ok(key in mods, `Unexpected module ${key}`);
      return mods[key];
    }, mod, mod.exports,
  );
  return { isShowTracked: mod.exports.isShowTracked, useCanDropShow: mod.exports.useCanDropShow, calls, notifyStatus };
}

const series = { id: "tt123456", type: "series" };
const anime = { id: "mal:123", type: "anime" };

test("connected accounts alone do not expose Drop on an untracked show", async () => {
  const h = fixture({ mal: true, anilist: true, simkl: true, pmdb: true, trakt: true });
  assert.equal(await h.isShowTracked(anime), false);
  assert.equal(await h.isShowTracked(series), false);
});

test("an entry on MAL or AniList alone is sufficient for an anime", async () => {
  assert.equal(await fixture({ mal: true, malEntry: true }).isShowTracked(anime), true);
  assert.equal(await fixture({ anilist: true, anilistEntry: true }).isShowTracked(anime), true);
});

test("Simkl list status or watched episodes independently permit Drop", async () => {
  assert.equal(await fixture({ simkl: true, simklStatus: "watching" }).isShowTracked(series), true);
  assert.equal(await fixture({ simkl: true, simklWatched: ["1:1"] }).isShowTracked(series), true);
  assert.equal(await fixture({ simkl: true }).isShowTracked(series), false);
});

test("one watched PMDB episode qualifies even when it is not in a watchlist", async () => {
  const h = fixture({ pmdb: true, pmdbWatched: ["1:1"] });
  assert.equal(await h.isShowTracked(series), true);
  assert.ok(h.calls.includes("pmdb-history"));
});

test("PMDB watchlist alone qualifies, even when history is temporarily unavailable", async () => {
  const h = fixture({ pmdb: true, pmdbWatchlist: true, pmdbHistoryFails: true });
  assert.equal(await h.isShowTracked(series), true);
  assert.ok(h.calls.includes("pmdb-list"));
});

test("Trakt watched, watchlist or dropped presence qualifies, unrelated shows do not", async () => {
  for (const source of ["watchlist", "watched", "dropped"] as const) {
    const h = fixture({ trakt: true, traktSource: source });
    assert.equal(await h.isShowTracked(series), true);
  }
  assert.equal(await fixture({ trakt: true }).isShowTracked(series), false);
});

test("no connected trackers cannot create an eligible Drop action", async () => {
  const h = fixture({ malEntry: true, simklStatus: "watching", pmdbWatched: ["1:1"] });
  assert.equal(await h.isShowTracked(anime), false);
  assert.deepEqual(h.calls, []);
});

test("Drop Show UI gates both entry points and restricts the PMDB note to its session", () => {
  const detail = source("src/views/detail.tsx");
  const menu = source("src/components/context-menu.tsx");
  const modal = source("src/components/drop-show-confirm-modal.tsx");
  assert.match(detail, /const canDropTitle = useCanDropShow\(/);
  assert.match(menu, /const canDropTrackedShow = useCanDropShow\(/);
  assert.match(menu, /!playerActions && canDropTrackedShow/);
  assert.match(modal, /pmdbSession\?\.apiKey &&/);
  assert.doesNotMatch(modal, /PublicMetaDB does not have a Dropped status/);
});


test("live tracker status changes update Drop eligibility without navigating away", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://example.test" });
  const old = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: (globalThis as any).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  try {
    const settings: Settings = { simkl: true };
    const h = fixture(settings);
    const Probe = ({ id }: { id: string }) => {
      const show = h.useCanDropShow({ id, type: "series" });
      return React.createElement("span", null, show ? "Drop show" : "No drop");
    };
    const root = createRoot(document.getElementById("root")!);
    await React.act(async () => root.render(React.createElement(Probe, { id: series.id })));
    await React.act(async () => {});
    assert.equal(document.body.textContent, "No drop");
    settings.simklStatus = "watching";
    await React.act(async () => h.notifyStatus());
    await React.act(async () => {});
    assert.equal(document.body.textContent, "Drop show", "successful tracker write should appear in the current view");
    settings.simklStatus = null;
    await React.act(async () => h.notifyStatus());
    await React.act(async () => {});
    assert.equal(document.body.textContent, "No drop", "removal should also update the current view");
    settings.simklStatus = "watching";
    await React.act(async () => h.notifyStatus());
    await React.act(async () => root.render(React.createElement(Probe, { id: "tt777888" })));
    assert.equal(document.body.textContent, "No drop", "the previous title must not flash Drop on the next title");
    await React.act(async () => root.unmount());
  } finally {
    Object.assign(globalThis, old);
    dom.window.close();
  }
});

test("tracker action buttons broadcast successful membership changes", () => {
  for (const path of [
    "src/components/mal/add-to-mal-button.tsx",
    "src/views/detail/add-to-anilist-button.tsx",
    "src/views/detail/add-to-simkl-button.tsx",
  ]) {
    const body = source(path);
    assert.match(body, /notifyTrackerStatusChanged\(\)/);
  }
});
