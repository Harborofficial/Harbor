import assert from "node:assert/strict";
import test from "node:test";
import * as library from "../src/lib/music/library";
import {
  confirmAction,
  getConfirmActionState,
  resolveConfirmAction,
} from "../src/lib/confirm-action";
import {
  getPinnedMusicPlaylists,
  pinMusicPlaylist,
  unpinMusicPlaylist,
} from "../src/lib/music/pinned-playlists";
import { flushLocalJson } from "../src/lib/music/local-store";
import type { MusicPlaylist } from "../src/lib/music/types";

const playlist: MusicPlaylist = {
  id: "local-playlist",
  name: "Top 500 Songs of the 80s",
  createdAt: "1",
  updatedAt: "2",
  tracks: [],
  source: { connectorId: "youtube", sourceId: "PLw-VjHDlEOgtH-Ce-dJzPOtIm5xTVC4t2", syncedAt: "2" },
};

test("linked playlist confirmations use Harbor's in-app prompt instead of native dialogs", async () => {
  const previous = globalThis.window;
  const calls: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          calls.push(command);
          throw new Error("A native dialog must not open for an in-app confirmation");
        },
      },
      confirm: () => {
        throw new Error("window.confirm must not be used in Tauri");
      },
    },
  });
  try {
    const wait = library.confirmLinkedMusicPlaylistEdit(playlist);
    assert.equal(getConfirmActionState().open, true);
    assert.equal(getConfirmActionState().title, "Edit linked playlist?");
    assert.match(getConfirmActionState().message, /overwritten on sync/);
    resolveConfirmAction(false);
    assert.equal(await wait, false);

    const accepted = library.confirmLinkedMusicPlaylistEdit(playlist);
    resolveConfirmAction(true);
    assert.equal(await accepted, true);
    assert.equal(await library.confirmLinkedMusicPlaylistEdit({}), true);
    assert.equal(getConfirmActionState().open, false);
    assert.deepEqual(calls, []);
  } finally {
    resolveConfirmAction(false);
    if (previous === undefined) Reflect.deleteProperty(globalThis, "window");
    else globalThis.window = previous;
  }
});

test("a newer prompt cancels the unanswered one instead of leaving it waiting", async () => {
  const first = confirmAction({ title: "First", message: "First?", confirmLabel: "Go" });
  const second = confirmAction({ title: "Second", message: "Second?", confirmLabel: "Go" });
  assert.equal(await first, false);
  assert.equal(getConfirmActionState().title, "Second");
  resolveConfirmAction(true);
  assert.equal(await second, true);
  assert.equal(getConfirmActionState().open, false);
});

test("linked playlist operations expose native results and notify the library only after success", async () => {
  const previous = globalThis.window;
  const events: string[] = [];
  const calls: { command: string; args: unknown }[] = [];
  const target = new EventTarget();
  let failure = false;
  target.addEventListener("harbor:music-library-changed", (event) => events.push(event.type));
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: Object.assign(target, {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: unknown) => {
          calls.push({ command, args });
          if (failure) throw new Error("Network unavailable");
          return command === "music_unlink_playlist"
            ? { ...playlist, source: undefined }
            : playlist;
        },
      },
    }),
  });
  try {
    assert.deepEqual(await library.importLinkedMusicPlaylist(playlist.source!.sourceId), playlist);
    assert.deepEqual(calls[0], {
      command: "music_import_linked_playlist",
      args: {
        connectorId: "youtube",
        sourceId: "PLw-VjHDlEOgtH-Ce-dJzPOtIm5xTVC4t2",
      },
    });
    assert.deepEqual(await library.syncLinkedMusicPlaylist(playlist.id), playlist);
    assert.deepEqual(calls[1], {
      command: "music_sync_linked_playlist",
      args: { playlistId: "local-playlist" },
    });
    const unlinked = await library.unlinkMusicPlaylist(playlist.id);
    assert.equal(unlinked.source, undefined);
    assert.deepEqual(calls[2], {
      command: "music_unlink_playlist",
      args: { playlistId: "local-playlist" },
    });
    assert.deepEqual(events, Array(3).fill("harbor:music-library-changed"));
    failure = true;
    await assert.rejects(library.syncLinkedMusicPlaylist(playlist.id), /Network unavailable/);
    await assert.rejects(
      library.importLinkedMusicPlaylist(playlist.source!.sourceId),
      /Network unavailable/,
    );
    await assert.rejects(library.unlinkMusicPlaylist(playlist.id), /Network unavailable/);
    assert.equal(events.length, 3);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "window");
    else globalThis.window = previous;
  }
});

test("pending linked results are discarded after a profile switch but kept when the profile returns", async () => {
  const previousWindow = globalThis.window;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const target = new EventTarget();
  let active = "default";
  let finish!: (playlist: MusicPlaylist) => void;
  let notices = 0;
  const profiles = JSON.stringify({
    activeId: "default",
    profiles: [{ id: "default" }, { id: "other" }],
  });
  target.addEventListener("harbor:music-library-changed", () => {
    notices += 1;
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) =>
        key === "harbor.profiles.v1" ? profiles.replace('"default"', `"${active}"`) : null,
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: Object.assign(target, {
      __TAURI_INTERNALS__: {
        invoke: () =>
          new Promise<MusicPlaylist>((resolve) => {
            finish = resolve;
          }),
      },
    }),
  });
  pinMusicPlaylist({
    id: playlist.id,
    name: "Default profile title",
    artwork: ["custom-cover.jpg"],
  });
  const before = getPinnedMusicPlaylists();
  try {
    for (const start of [
      () => library.syncLinkedMusicPlaylist(playlist.id),
      () => library.importLinkedMusicPlaylist(playlist.source!.sourceId),
      () => library.unlinkMusicPlaylist(playlist.id),
    ]) {
      active = "default";
      const pending = start();
      active = "other";
      finish(playlist);
      await assert.rejects(pending, /profile changed/i);
      assert.deepEqual(getPinnedMusicPlaylists(), before);
      assert.equal(notices, 0);
    }
    active = "default";
    const pending = library.syncLinkedMusicPlaylist(playlist.id);
    active = "other";
    active = "default";
    finish(playlist);
    await assert.doesNotReject(pending);
    assert.equal(notices, 1);
    assert.equal(getPinnedMusicPlaylists()[0].name, playlist.name);
  } finally {
    unpinMusicPlaylist(playlist.id);
    await flushLocalJson();
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else globalThis.window = previousWindow;
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("mirror sync refreshes a pinned title without changing its artwork or shelf order", async () => {
  const previous = globalThis.window;
  pinMusicPlaylist({ id: playlist.id, name: "Old title", artwork: ["custom-cover.jpg"] });
  pinMusicPlaylist({ id: "other-pin", name: "Other playlist", artwork: [] });
  const before = getPinnedMusicPlaylists();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: Object.assign(new EventTarget(), {
      __TAURI_INTERNALS__: { invoke: async () => playlist },
    }),
  });
  try {
    await library.syncLinkedMusicPlaylist(playlist.id);
    assert.deepEqual(
      getPinnedMusicPlaylists(),
      before.map((pin) => (pin.id === playlist.id ? { ...pin, name: playlist.name } : pin)),
    );
  } finally {
    unpinMusicPlaylist(playlist.id);
    unpinMusicPlaylist("other-pin");
    await flushLocalJson();
    if (previous === undefined) Reflect.deleteProperty(globalThis, "window");
    else globalThis.window = previous;
  }
});
