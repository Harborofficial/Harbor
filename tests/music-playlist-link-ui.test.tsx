import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import type { MusicPlaylist } from "../src/lib/music/types";

const linked: MusicPlaylist = {
  id: "local-playlist",
  name: "Top 500 Songs of the 80s",
  createdAt: "1",
  updatedAt: "2",
  source: { connectorId: "youtube", sourceId: "PLw-VjHDlEOgtH-Ce-dJzPOtIm5xTVC4t2", syncedAt: "2" },
  tracks: [],
};

test("link dialog validates input, reports native failures, and creates one linked playlist", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  Object.defineProperty(dom.window, "matchMedia", { value: () => ({ matches: true }) });
  const calls: string[] = [];
  let fail = true;
  Object.defineProperty(dom.window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      invoke: async (command: string, args: unknown) => {
        calls.push(command);
        assert.equal(command, "music_import_linked_playlist");
        assert.deepEqual(args, {
          connectorId: "youtube",
          sourceId: "PLw-VjHDlEOgtH-Ce-dJzPOtIm5xTVC4t2",
        });
        if (fail) throw new Error("Playlist unavailable");
        return linked;
      },
    },
  });
  const { createRoot } = await import("react-dom/client");
  const { MusicPlaylistLinkDialog, MusicPlaylistLinkActions } =
    await import("../src/components/music/music-playlist-link");
  const { ConfirmActionModal } = await import("../src/components/confirm-action-modal");
  const root = createRoot(dom.window.document.getElementById("root")!);
  let imported: MusicPlaylist | undefined;
  let closed = false;
  const submit = async () =>
    act(async () => {
      dom.window.document
        .querySelector("form")!
        .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
  const enter = async (value: string) =>
    act(async () => {
      const input = dom.window.document.querySelector("input")!;
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  try {
    await act(async () =>
      root.render(
        <MusicPlaylistLinkDialog
          onClose={() => {
            closed = true;
          }}
          onImported={(value) => {
            imported = value;
          }}
        />,
      ),
    );
    assert.ok(dom.window.document.querySelector('[role="dialog"]'));
    await enter("not-a-playlist");
    await submit();
    assert.equal(calls.length, 0);
    assert.ok(dom.window.document.querySelector('[role="alert"]'));
    await enter("https://music.youtube.com/playlist?list=PLw-VjHDlEOgtH-Ce-dJzPOtIm5xTVC4t2");
    await submit();
    assert.match(
      dom.window.document.querySelector('[role="alert"]')!.textContent!,
      /Playlist unavailable/,
    );
    assert.equal(imported, undefined);
    assert.equal(closed, false);
    fail = false;
    await submit();
    assert.deepEqual(imported, linked);
    assert.equal(calls.length, 2);
    await act(async () => {
      await new Promise((resolve) => dom.window.setTimeout(resolve, 1));
    });
    assert.equal(closed, true);

    const operations: string[] = [];
    Object.defineProperty(dom.window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string) => {
          operations.push(command);
          if (fail) throw new Error("Sync failed");
          return command === "music_unlink_playlist" ? { ...linked, source: undefined } : linked;
        },
      },
    });
    let updated: MusicPlaylist | undefined;
    const renderActions = async (playlist: MusicPlaylist) =>
      act(async () =>
        root.render(
          <>
            <MusicPlaylistLinkActions
              playlist={playlist}
              onUpdated={(value) => {
                updated = value;
              }}
            />
            <ConfirmActionModal />
          </>,
        ),
      );
    await renderActions(linked);
    assert.match(dom.window.document.body.textContent!, /Linked to YouTube Music/);
    const button = (text: string) =>
      [...dom.window.document.querySelectorAll("button")].find((item) =>
        item.textContent!.includes(text),
      )!;
    const dialogButton = (text: string) =>
      [...dom.window.document.querySelector('[role="dialog"]')!.querySelectorAll("button")].find(
        (item) => item.textContent!.includes(text),
      )!;
    await act(async () => button("Sync now").click());
    assert.ok(dom.window.document.querySelector('[role="dialog"]'));
    await act(async () => dialogButton("Cancel").click());
    assert.equal(operations.length, 0, "cancelled sync does not invoke native commands");
    fail = true;
    await act(async () => button("Sync now").click());
    await act(async () => dialogButton("Sync now").click());
    assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!, /Sync failed/);
    assert.equal(updated, undefined);
    fail = false;
    await act(async () => button("Sync now").click());
    await act(async () => dialogButton("Sync now").click());
    assert.deepEqual(updated, linked);
    await act(async () => button("Unlink").click());
    await act(async () => dialogButton("Unlink").click());
    assert.equal(updated!.source, undefined);
    const mix: MusicPlaylist = {
      ...linked,
      name: "Mix – Smart",
      source: {
        connectorId: "youtube",
        sourceId: "RDGMEMCMFH2exzjBeE_zAHHJOdxgVMWUJYt4Zs3Ko:05VSCSna5WA",
        syncedAt: "2",
      },
    };
    Object.defineProperty(dom.window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string, args: { sourceId?: string }) => {
          assert.equal(command, "music_import_linked_playlist");
          assert.deepEqual(args, {
            connectorId: "youtube",
            sourceId: "RDGMEMCMFH2exzjBeE_zAHHJOdxgVMWUJYt4Zs3Ko:05VSCSna5WA",
          });
          return mix;
        },
      },
    });
    await act(async () =>
      root.render(
        <>
          <MusicPlaylistLinkDialog
            onClose={() => {}}
            onImported={(value) => {
              imported = value;
            }}
          />
          <ConfirmActionModal />
        </>,
      ),
    );
    await enter(
      "https://www.youtube.com/watch?v=05VSCSna5WA&list=RDGMEMCMFH2exzjBeE_zAHHJOdxgVMWUJYt4Zs3Ko&index=14",
    );
    await submit();
    assert.deepEqual(imported, mix);
    await act(async () =>
      root.render(
        <>
          <MusicPlaylistLinkActions playlist={mix} onUpdated={() => {}} />
          <ConfirmActionModal />
        </>,
      ),
    );
    assert.match(dom.window.document.body.textContent!, /current queue.*snapshot/i);
    await act(async () => button("Sync now").click());
    assert.match(
      dom.window.document.querySelector('[role="dialog"]')!.textContent!,
      /current queue.*snapshot/i,
    );
    await act(async () => dialogButton("Cancel").click());
    await act(async () =>
      root.render(
        <>
          <MusicPlaylistLinkActions
            playlist={{ ...linked, source: undefined }}
            onUpdated={() => {}}
          />
          <ConfirmActionModal />
        </>,
      ),
    );
    assert.equal(dom.window.document.querySelector("button"), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
