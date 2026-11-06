// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { fetchImageObjectUrl } from "../src/views/manga/manga-reader/reader-utils.ts";

test("header-fetched manga image blobs preserve the actual format when the source omits content type", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async () => ({ ok: true, status: 200, body: "iVBORw0KGgoAAAAA" }),
      },
    },
  });
  let url: string | undefined;
  try {
    url = await fetchImageObjectUrl("https://source.example/page", {
      Referer: "https://source.example/chapter",
    });
    assert.equal((await fetch(url)).headers.get("content-type"), "image/png");
  } finally {
    if (url) URL.revokeObjectURL(url);
    delete globalThis.window;
  }
});
