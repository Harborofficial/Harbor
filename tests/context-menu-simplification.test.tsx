import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import * as icons from "lucide-react";
import * as context from "../src/lib/context-menu.tsx";
import * as content from "../src/lib/context-content.ts";
import * as partition from "../src/lib/context-quick-actions.ts";
import * as backgroundPolicy from "../src/lib/context-page-background.ts";
import * as surface from "../src/components/context-menu/menu-surface.tsx";
import * as actionItems from "../src/components/context-menu/action-items.tsx";
import * as contentActions from "../src/components/context-menu/content-actions.tsx";
import * as playerSources from "../src/components/context-menu/player-actions.tsx";

function harness() {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://fixture.invalid",
    pretendToBeVisual: true,
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    Element: dom.window.Element,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    innerWidth: dom.window.innerWidth,
    innerHeight: dom.window.innerHeight,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    MutationObserver: dom.window.MutationObserver,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    MouseEvent: dom.window.MouseEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.matchMedia = (() => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  })) as any;
  const empty = () => {};
  let api!: ReturnType<typeof context.useContextMenu>;
  let lastReads = 0;
  let copied = 0;
  let queueSurface = false;
  const queued: string[] = [];
  let player: any = null;
  let watched: any = { loading: true, summary: null, refresh: empty };
  const nav = [
    { id: "page:back", label: "Back", run: empty },
    { id: "page:my-profile", label: "Open my profile", run: empty },
    {
      id: "page:go-to",
      label: "Go to",
      children: [
        { id: "page:go:home", label: "Home", run: empty },
        { id: "page:go:settings", label: "Settings", run: empty },
      ],
    },
    { id: "page:refresh", label: "Refresh", run: empty },
  ];
  const page: context.ContextMenuTarget = {
    kind: "actions",
    id: "page:home",
    label: "Page actions",
    scope: "page-background",
    actions: () => nav,
  };
  const view = {
    topKind: "home",
    topPath: "/home",
    openMeta: empty,
    openManga: empty,
    setView: empty,
    openQueue: empty,
    openPicker: empty,
    openPerson: empty,
    openService: empty,
    openAddonDetail: empty,
    openSettings: empty,
  };
  const deps: Record<string, any> = {
    react: React,
    "react/jsx-runtime": jsx,
    "lucide-react": icons,
    "@/lib/context-menu": context,
    "@/lib/context-content": content,
    "@/lib/context-quick-actions": partition,
    "@/lib/context-page-background": backgroundPolicy,
    "@/lib/context-actions": {},
    "@/lib/i18n": { t: (s: string) => s, useT: () => (s: string) => s },
    "@/lib/active-addon": { useActiveAddon: () => null },
    "@/components/player/copy-link-button": { copyText: async () => true },
    "@/components/lists/list-toast": { emitListToast: empty },
    "@/lib/deep-link": { shareDeepLink: (type: string, id: string) => `${type}:${id}` },
    "@/lib/auth": { useAuth: () => ({ user: null }) },
    "@/lib/queue": {
      queueAdd: (meta: { id: string }) => queued.push(meta.id),
      queueIndexOf: (meta: { id: string }) => queued.indexOf(meta.id),
    },
    "@/lib/membership-operations": {},
    "@/lib/stremio": {},
    "@/lib/queue-resolve-episode": {},
    "@/hooks/use-queue-surface": { useQueueSurface: () => queueSurface },
    "@/lib/player-actions": { usePlayerActions: () => player, currentPlayerActions: () => player },
    "@/lib/playback-history": {
      capturePlaybackActor: () => "fixture",
      isPlaybackActorCurrent: () => true,
    },
    "@/lib/together/provider": {
      useTogether: () => ({ snapshot: { state: "idle" }, sendSummon: empty }),
    },
    "@/lib/view": { useView: () => ({ ...view, player }) },
    "@/lib/watchlist": { useInWatchlist: () => false },
    "@/lib/media-context-actions": {
      setContextWatchlist: empty,
      setContextFavorite: empty,
      setContextWatched: empty,
      requireMediaActionSuccess: empty,
    },
    "@/lib/context-watched-state": { useContextWatchedState: () => watched },
    "@/lib/providers/tmdb": { useTmdbImdbId: () => undefined },
    "@/lib/media-favorites": { useIsFavorite: () => false },
    "@/lib/title-backdrop": { getTitleBackdrop: () => undefined },
    "./context-menu/my-list-submenu": {
      MyListSubmenu: ({ children }: any) => (
        <>
          <button role="menuitem">Add to list</button>
          {children}
        </>
      ),
    },
    "@/lib/settings": {
      useSettings: () => ({
        settings: { navCustomization: { order: [], hidden: [] } },
        update: empty,
      }),
    },
    "@/chrome/nav-items": {},
    "@/chrome/nav-edit-mode": { useNavEditMode: () => false },
    "@/lib/manga-favorites": {
      useMangaFavorites: () => ({ toggle: empty }),
      useIsMangaFavorite: () => false,
    },
    "@/lib/manga-progress": {
      useMangaProgressEntry: () => null,
      useReadMangaChapterIds: () => new Set(),
    },
    "@/lib/manga-bookmarks": { useMangaBookmarks: () => [] },
    "@/lib/manga-downloads": {},
    "@/lib/manga/read-intent": {},
    "@/lib/manga-lists": {},
    "@/lib/manga/api": {},
    "@/lib/manga/chapter-identity": {},
    "@/lib/profiles": {
      useProfiles: () => ({ activeProfile: { id: "fixture" }, activeId: "fixture" }),
    },
    "@/lib/theme-auth": { currentAuthor: () => null, subscribeAuthor: () => empty },
    "./context-menu/menu-surface": surface,
    "./context-menu/action-items": actionItems,
    "./context-menu/content-actions": contentActions,
    "@/components/context-image-viewer": {
      ContextImageViewer: () => <div data-unwanted-image-viewer />,
    },
    "./context-image-viewer": { ContextImageViewer: () => <div data-unwanted-image-viewer /> },
    "@/lib/social/external-link-policy": {},
    "@/chrome/context-page-navigation": {
      usePageContextTarget: ({ includePlayer = false } = {}) =>
        player && !includePlayer ? null : page,
    },
    "./context-menu/use-manual-download": {
      useManualDownload: () => ({ beginManualDownload: empty, manualDownloadDialog: null }),
    },
    "./context-menu/last-playback-command": {
      LastPlaybackCommand: ({ enabled, children }: any) => {
        if (enabled) lastReads++;
        const action = enabled
          ? { id: "playback:last:fixture", label: "Resume last watched", run: empty }
          : null;
        return children(
          action,
          action ? (
            <actionItems.ActionItems source={{ actions: () => [action] }} onClose={empty} />
          ) : null,
        );
      },
    },
    "./context-menu/menu-brand-footer": {
      MenuBrandFooter: () => <div data-context-brand-footer />,
    },
    "./context-menu/player-actions": playerSources,
  };
  const output = ts.transpileModule(
    readFileSync(new URL("../src/components/context-menu.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", output)(
    (name: string) => {
      assert.ok(name in deps, `unexpected dependency ${name}`);
      return deps[name];
    },
    module,
    module.exports,
  );
  function App() {
    api = context.useContextMenu();
    const emptyCard = context.useContextTarget(() => ({
      kind: "actions",
      id: "empty-card",
      label: "Card",
      actions: () => [],
    }));
    return (
      <>
        <main id="background" data-context-page-background>
          <button id="control">Independent control</button>
          <div id="empty-card" ref={emptyCard}>
            Occupied card space
          </div>
        </main>
        <img id="image" src="https://fixture.invalid/poster.png" />
        <input id="editor" />
        <module.exports.ContextMenu />
      </>
    );
  }
  const root = createRoot(document.getElementById("root")!);
  const render = () =>
    React.act(() =>
      root.render(
        <context.ContextMenuProvider>
          <App />
        </context.ContextMenuProvider>,
      ),
    );
  const open = async (target: context.ContextMenuTarget) => {
    await React.act(() => api.openAt({ x: 20, y: 20 }, target));
  };
  const labels = () =>
    [...document.querySelectorAll('[role="menu"] > .context-menu-motion [role="menuitem"]')].map(
      (e) => e.textContent?.trim(),
    );
  return {
    dom,
    root,
    render,
    open,
    page,
    labels,
    get reads() {
      return lastReads;
    },
    get state() {
      return api.state;
    },
    copy: () => copied++,
    get copied() {
      return copied;
    },
    set watched(value: any) {
      watched = value;
    },
    set player(value: any) {
      player = value;
    },
    set queueSurface(value: boolean) {
      queueSurface = value;
    },
    get queued() {
      return queued;
    },
    dispose: async () => {
      await React.act(() => root.unmount());
      dom.window.close();
    },
  };
}

test("actual menus reserve navigation/last playback for declared background and keep entity Copy as a row", async () => {
  const h = harness();
  await h.render();
  try {
    await h.open(h.page);
    assert.deepEqual(h.labels(), [
      "Back",
      "Settings",
      "Resume last watched",
      "Open my profile",
      "Go to",
      "Refresh",
    ]);
    assert.ok(document.querySelector("[data-context-quick]"));
    const before = h.reads;
    await h.open({
      kind: "actions",
      id: "collection",
      label: "Collection",
      actions: () => [{ id: "collection:copy", label: "Copy share link", run: h.copy }],
    });
    assert.deepEqual(h.labels(), ["Copy share link"]);
    assert.equal(document.querySelector("[data-context-quick]") === null, true);
    assert.equal(h.reads, before, "item menus never resolve last playback");
    await React.act(() =>
      (
        document.querySelector('[data-context-action="collection:copy"]') as HTMLButtonElement
      ).click(),
    );
    assert.equal(h.copied, 1);
    await h.open({ kind: "content", image: { src: "https://fixture.invalid/image.png" } });
    assert.equal(
      document.querySelector('[role="menu"]') === null,
      true,
      "empty image target does not become a page menu",
    );
    assert.equal(
      h.state === null,
      true,
      "an empty target releases the menu ownership, not only its surface",
    );
  } finally {
    await h.dispose();
  }
});

test("rendered movie menu has no toolbar, image/sharing/waiting tools, or orphan watched separator", async () => {
  const h = harness();
  await h.render();
  try {
    await h.open({
      kind: "meta",
      meta: { id: "fixture", type: "movie", name: "Movie", poster: "fixture.png" },
    });
    assert.deepEqual(h.labels(), [
      "View details",
      "Download",
      "Add to watchlist",
      "Add to favorites",
      "Add to list",
    ]);
    assert.equal(document.querySelector('[role="separator"]') === null, true);
    assert.equal(document.querySelector("[data-context-quick]") === null, true);
    assert.equal(h.reads, 0);
    const download = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (e) => e.textContent === "Download",
    )!;
    download.focus();
    h.watched = { loading: false, summary: { status: "watched", unavailable: [] }, refresh() {} };
    await h.render();
    assert.ok(h.labels().includes("Mark as unwatched"));
    assert.equal(document.activeElement, download, "late watched status preserves focused command");
  } finally {
    await h.dispose();
  }
});

test("the official queue command remains available on queue-enabled surfaces", async () => {
  const h = harness();
  h.queueSurface = true;
  await h.render();
  const target: context.ContextMenuTarget = {
    kind: "meta",
    meta: { id: "queue-movie", type: "movie", name: "Queue movie" },
  };
  try {
    await h.open(target);
    assert.ok(h.labels().includes("Add to queue"));
    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Add to queue",
    )!;
    await React.act(async () => add.click());
    assert.deepEqual(h.queued, ["queue-movie"]);
    await h.open(target);
    const existing = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "In your queue",
    )!;
    assert.ok(existing);
    assert.equal(existing.disabled, true);
    assert.equal(document.querySelector("[data-context-quick]") === null, true);
  } finally {
    await h.dispose();
  }
});

test("managed image context is consumed and native editing remains untouched", async () => {
  const h = harness();
  await h.render();
  try {
    const imageEvent = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await React.act(() => document.getElementById("image")!.dispatchEvent(imageEvent));
    assert.equal(imageEvent.defaultPrevented, true);
    assert.equal(document.querySelector('[role="menu"]') === null, true);
    const editEvent = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await React.act(() => document.getElementById("editor")!.dispatchEvent(editEvent));
    assert.equal(editEvent.defaultPrevented, false);
    assert.equal(document.querySelector('[role="menu"]') === null, true);
  } finally {
    await h.dispose();
  }
});

test("empty cards and independent controls are not background, while true page space is", async () => {
  const h = harness();
  await h.render();
  try {
    for (const id of ["empty-card", "control"]) {
      const event = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      await React.act(() => document.getElementById(id)!.dispatchEvent(event));
      assert.equal(event.defaultPrevented, true);
      assert.equal(document.querySelector('[role="menu"]') === null, true, id);
    }
    const event = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await React.act(() => document.getElementById("background")!.dispatchEvent(event));
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(h.labels(), [
      "Back",
      "Settings",
      "Resume last watched",
      "Open my profile",
      "Go to",
      "Refresh",
    ]);
  } finally {
    await h.dispose();
  }
});

test("a docked live player keeps page-background navigation without adding it to the player menu", async () => {
  const h = harness();
  const meta = { id: "playing", type: "movie", name: "Playing" };
  h.player = { meta, src: {}, toggleFullscreen() {} };
  await h.render();
  try {
    await h.open(h.page);
    assert.deepEqual(h.labels(), [
      "Back",
      "Settings",
      "Resume last watched",
      "Open my profile",
      "Go to",
      "Refresh",
    ]);
    await h.open({ kind: "meta", player: true, meta });
    assert.equal(document.querySelector("[data-context-quick]") === null, true);
    assert.equal(
      h
        .labels()
        .some((label) => /Back|Settings|last watched|my profile|Go to|Refresh/.test(label ?? "")),
      false,
    );
    assert.ok(h.labels().includes("Full screen"));
  } finally {
    await h.dispose();
  }
});
