import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot } from "react-dom/client";

// Exercise the production builders/components while isolating music providers,
// native saving, and the third-party WebGL reader from these menu contracts.
function load(relative: string, dependencies: Record<string, any>) {
  const output = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", output)(
    (id: string) => {
      assert.ok(id in dependencies, `unmocked boundary ${id}`);
      return dependencies[id];
    },
    module,
    module.exports,
  );
  return module.exports;
}

const icons = new Proxy({}, { get: () => () => null });
const nothing = () => {};
const navigation = { goToArtist: nothing, goToAlbum: nothing };
const translate = (key: string) => key;
const common = {
  react: React,
  "react/jsx-runtime": jsx,
  "@/components/icons/music-icons": icons,
  "lucide-react": icons,
  "@/components/anchored-menu": { AnchoredMenu: () => null },
  "@/lib/i18n": { useT: () => translate },
  "@/lib/music/artwork-save": {
    saveArtwork: () => assert.fail("no image saving from a context menu"),
  },
};

test("music track menus retain playback and text copying without a save-artwork command", async () => {
  const { useMusicTrackMenuItems } = load("../src/components/music/music-track-menu.tsx", {
    ...common,
    "@/components/icons/more-like-this-icon": { MoreLikeThisIcon: () => null },
    "@/lib/music/navigation": {},
    "@/lib/music/playback-origin": {
      getMusicPlaybackOrigin: () => null,
      musicOriginName: () => "",
      musicTitleTarget: () => ({ kind: "album" }),
    },
    "@/lib/music/player": { getMusicState: () => ({ current: null }) },
    "@/lib/music/use-track-liked": { useMusicTrackLiked: () => false },
    "./use-artist-credits": { useArtistCredits: () => [] },
    "./music-navigate": { useMusicNavigate: () => navigation },
  });
  let played = 0;
  const items = useMusicTrackMenuItems(
    {
      id: "fixture",
      title: "Fixture",
      artist: "Artist",
      artwork: "https://images.example.org/art.jpg",
    },
    { onPlay: () => played++ },
  );
  assert.deepEqual(
    items.map((item: any) => item.id),
    ["play", "similar", "copy"],
  );
  await items[0].run();
  assert.equal(played, 1);
});

test("music album, artist and playlist menus omit image saving without losing their normal actions", async () => {
  const { musicItemMenuItems } = load("../src/components/music/music-item-menu.tsx", {
    ...common,
    "@/components/music/music-cover-card": {
      coverCardTitle: (item: any) => item.title || item.name,
    },
    "@/components/music/music-navigate": { useMusicNavigate: () => navigation },
    "@/components/music/music-playlist-picker": {},
    "@/components/music/music-track-menu": {},
    "@/lib/music/player": {},
    "@/lib/music/pinned-playlists": {},
  });
  for (const kind of ["album", "artist", "playlist"]) {
    let opened = 0;
    const items = musicItemMenuItems({
      t: translate,
      item: {
        kind,
        id: "fixture",
        name: "Fixture",
        title: "Fixture",
        artwork: "https://images.example.org/art.jpg",
      },
      onOpen: () => opened++,
    });
    assert.deepEqual(
      items.map((item: any) => item.id),
      ["open"],
    );
    await items[0].run();
    assert.equal(opened, 1);
  }
});

test("book-view reader pages remain a trusted reader target without image actions or a viewer portal", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    Element: dom.window.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let targetFactory: any;
  const opened: any[] = [];
  let viewerMounts = 0;
  (window as any).FlipBook = class {
    toggleSound() {}
    dispose() {}
    destroy() {}
  };
  const { BookFlip } = load("../src/views/manga/manga-reader/book-view.tsx", {
    react: React,
    "react/jsx-runtime": jsx,
    "lucide-react": icons,
    "@/lib/context-menu": {
      useContextMenu: () => ({ open: (_event: any, target: any) => opened.push(target) }),
      useContextTarget: (factory: any) => {
        targetFactory = factory;
        return nothing;
      },
    },
    "@/components/context-image-viewer": {
      ContextImageViewer: () => {
        viewerMounts++;
        return null;
      },
    },
    "@/lib/i18n": { useT: () => translate },
    "./flipbook": { guardPageLoaded: nothing, hasNativeZoom: () => false },
    "./reader-utils": { measureAspect: async () => 1.4 },
  });
  const root = createRoot(document.querySelector("#root")!);
  try {
    await React.act(() =>
      root.render(
        jsx.jsx(BookFlip, {
          pages: ["https://images.example.org/page.png"],
          rtl: false,
          bg: "black",
          resumePage: 0,
          soundEnabled: false,
          onProgress: nothing,
        }),
      ),
    );
    await React.act(() =>
      window.dispatchEvent(
        new dom.window.CustomEvent("r3d-pagechange", {
          detail: { page: "1", name: "harborBook" },
        }),
      ),
    );
    assert.equal(targetFactory().kind, "actions");
    assert.deepEqual(targetFactory().actions(), []);
    const reader = document.querySelector("[tabindex='0']")!;
    await React.act(() =>
      reader.dispatchEvent(
        new dom.window.MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.deepEqual(opened.at(-1).actions(), []);
    assert.equal(viewerMounts, 0);
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
  }
});
