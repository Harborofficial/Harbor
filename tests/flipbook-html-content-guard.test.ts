// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { guardPageLoaded } from "../src/views/manga/manga-reader/flipbook.ts";

test("flipbook page HTML is normalized to a DOM node before Book3 consumes it", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const created: Array<{ innerHTML: string }> = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => {
        const node = { innerHTML: "" };
        created.push(node);
        return node;
      },
    },
  });

  try {
    for (const content of ["<a class='pageClickArea'></a>", undefined]) {
      const proto = {
        loadPageHTML(_page: number, callback: (value: unknown, page: number) => void) {
          callback.call(this, content, _page);
        },
      };
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { FLIPBOOK: { Main: { prototype: proto } } },
      });
      guardPageLoaded();

      let result: unknown;
      proto.loadPageHTML.call({ options: {} }, 0, (value) => {
        result = value;
      });
      assert.equal(result, created.at(-1));
      assert.equal(
        (result as { innerHTML: string }).innerHTML,
        typeof content === "string" ? content : "",
      );
    }
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
