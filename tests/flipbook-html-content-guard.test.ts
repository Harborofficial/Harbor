// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  disposeFlipbook,
  guardPageLoaded,
  type FlipMainInstance,
} from "../src/views/manga/manga-reader/flipbook.ts";

const VENDOR = readFileSync(
  new URL("../public/flipbook/js/flipbook.min.js", import.meta.url),
  "utf8",
);

function installDom(): { dom: JSDOM; restore: () => void } {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://harbor.test/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const names = [
    "window",
    "document",
    "Node",
    "DocumentFragment",
    "Element",
    "HTMLElement",
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of names) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: (dom.window as unknown as Record<string, unknown>)[name],
    });
  }
  return {
    dom,
    restore() {
      for (const name of names) {
        const descriptor = previous.get(name);
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      dom.window.close();
    },
  };
}

function fakeVendor(
  window: Window,
  content: unknown,
  args: unknown[] = [],
): {
  proto: Record<string, unknown> & {
    loadPageHTML: (
      this: FlipMainInstance,
      page: number,
      cb: (...args: unknown[]) => unknown,
    ) => unknown;
    pageLoaded: (this: FlipMainInstance, ...args: unknown[]) => unknown;
  };
  calls: Array<{ name: string; self: unknown; args: unknown[] }>;
} {
  const calls: Array<{ name: string; self: unknown; args: unknown[] }> = [];
  const proto = {
    loadPageHTML(
      this: FlipMainInstance,
      page: number,
      callback: (...values: unknown[]) => unknown,
    ) {
      calls.push({ name: "loadPageHTML", self: this, args: [page] });
      return callback.call(this, content, page, ...args);
    },
    pageLoaded(this: FlipMainInstance, ...values: unknown[]) {
      calls.push({ name: "pageLoaded", self: this, args: values });
      return undefined;
    },
  };
  Object.defineProperty(window, "FLIPBOOK", {
    configurable: true,
    value: { Main: { prototype: proto } },
  });
  guardPageLoaded();
  return { proto, calls };
}

function mainInstance(): FlipMainInstance & { options: Record<string, unknown> } {
  return { options: {} };
}

test("normalizes every callback content shape to a real DOM node", () => {
  const { dom, restore } = installDom();
  try {
    const element = dom.window.document.createElement("section");
    const fragment = dom.window.document.createDocumentFragment();
    const jquery = { jquery: "3.7.1", 0: element, length: 1, get: () => element };
    const cases: Array<[string, unknown, Node]> = [
      ["empty object", {}, dom.window.document.createElement("div")],
      ["null", null, dom.window.document.createElement("div")],
      ["undefined", undefined, dom.window.document.createElement("div")],
      ["element", element, element],
      ["fragment", fragment, fragment],
      ["jquery", jquery, element],
    ];

    for (const [label, content, expected] of cases) {
      const { proto } = fakeVendor(dom.window, content);
      const main = mainInstance();
      let result: unknown;
      proto.loadPageHTML.call(main, 3, (value: unknown) => {
        result = value;
      });
      assert.ok(result instanceof dom.window.Node, label);
      if (label === "empty object" || label === "null" || label === "undefined") {
        assert.equal((result as HTMLElement).innerHTML, "", label);
        assert.notEqual(result, expected, label);
      } else {
        assert.equal(result, expected, label);
      }
    }

    const { proto } = fakeVendor(dom.window, "<span>Chapter</span>");
    const main = mainInstance();
    let result: unknown;
    proto.loadPageHTML.call(main, 1, (value: unknown) => {
      result = value;
    });
    assert.ok(result instanceof dom.window.HTMLElement);
    assert.equal((result as HTMLElement).innerHTML, "<span>Chapter</span>");
  } finally {
    restore();
  }
});

test("preserves callback this, page number, extra arguments, and invocation count", () => {
  const { dom, restore } = installDom();
  try {
    const { proto } = fakeVendor(dom.window, "<b>page</b>", ["extra"]);
    const main = mainInstance();
    let calls = 0;
    const selves: unknown[] = [];
    let values: unknown[] = [];
    proto.loadPageHTML.call(
      main,
      9,
      function (this: unknown, _content: unknown, ...args: unknown[]) {
        calls += 1;
        selves.push(this);
        values = args;
      },
    );
    assert.equal(calls, 1);
    assert.equal(selves[0], main);
    assert.deepEqual(values, [9, "extra"]);

    const first = proto.loadPageHTML;
    guardPageLoaded();
    assert.equal(proto.loadPageHTML, first, "the guard is idempotent");
    assert.equal(
      (proto as { __harborPageHtmlContentGuard?: boolean }).__harborPageHtmlContentGuard,
      true,
    );
  } finally {
    restore();
  }
});

test("first and last sheets, odd page counts, RTL and cover:false settle", async () => {
  const { dom, restore } = installDom();
  try {
    async function loadSheet(
      proto: {
        loadPageHTML: (
          this: FlipMainInstance,
          page: number,
          cb: (...args: unknown[]) => unknown,
        ) => unknown;
      },
      pageCount: number,
      sheet: number,
      side: "front" | "back",
      rtl: boolean,
      cover: boolean,
    ): Promise<{ content: Node; page: number | undefined; args: unknown[] }> {
      const index = side === "front" ? 2 * sheet : 2 * sheet + 1;
      const page = (rtl ? 2 * pageCount - index - 1 : index) - (cover ? 0 : 1);
      if (page < 0) {
        return new Promise((resolve) =>
          proto.loadPageHTML.call(mainInstance(), page, (content, ...args) => {
            resolve({ content: content as Node, page: args[0] as number | undefined, args });
          }),
        );
      }
      return new Promise((resolve) =>
        proto.loadPageHTML.call(mainInstance(), page, (content, ...args) => {
          resolve({ content: content as Node, page: args[0] as number | undefined, args });
        }),
      );
    }

    for (const rtl of [false, true]) {
      for (const pageCount of [1, 3, 4, 5]) {
        const { proto } = fakeVendor(dom.window, dom.window.document.createElement("div"));
        for (const sheet of [
          0,
          Math.max(0, Math.floor(pageCount / 2) - 1),
          Math.floor(pageCount / 2),
        ]) {
          for (const side of ["front", "back"] as const) {
            const result = await loadSheet(proto, pageCount, sheet, side, rtl, false);
            assert.ok(result.content instanceof dom.window.Node);
            assert.equal(result.content.parentNode, null);
          }
        }
      }
    }
  } finally {
    restore();
  }
});

test("late page callbacks after disposal settle without crashing or updating the reader", async () => {
  const { dom, restore } = installDom();
  try {
    let pending: ((content: unknown, ...args: unknown[]) => unknown) | undefined;
    const calls: string[] = [];
    const proto = {
      loadPageHTML(
        this: FlipMainInstance,
        _page: number,
        callback: (...values: unknown[]) => unknown,
      ) {
        pending = callback;
        return Promise.resolve();
      },
      pageLoaded(this: FlipMainInstance) {
        calls.push("pageLoaded");
        return undefined;
      },
    };
    Object.defineProperty(dom.window, "FLIPBOOK", {
      configurable: true,
      value: { Main: { prototype: proto } },
    });
    guardPageLoaded();
    const main = mainInstance();
    let resolved: unknown;
    const settled = new Promise<void>((resolve) => {
      const promise = proto.loadPageHTML.call(main, 4, (content: unknown) => {
        resolved = content;
        resolve();
      });
      assert.ok(promise instanceof Promise);
    });
    disposeFlipbook(main);
    proto.pageLoaded.call(main, { index: 4 });
    assert.deepEqual(calls, [], "destroyed reader page state is untouched");
    await settled;
    assert.ok(resolved instanceof dom.window.Node);
    assert.equal((resolved as HTMLElement).innerHTML, "");

    // Reopening uses the same prototype but a fresh reader.
    const reopened = mainInstance();
    const reopenedPromise = new Promise<void>((resolve) => {
      proto.loadPageHTML.call(reopened, 0, (content: unknown) => {
        assert.ok(content instanceof dom.window.Node);
        resolve();
      });
    });
    pending?.call(reopened, {}, 0);
    await reopenedPromise;
  } finally {
    restore();
  }
});

test("the real vendor negative-index callback produces an empty DOM node", async () => {
  const { dom, restore } = installDom();
  try {
    const script = dom.window.document.createElement("script");
    script.textContent = VENDOR;
    dom.window.document.body.appendChild(script);
    script.remove();
    const proto = (
      dom.window as unknown as {
        FLIPBOOK: {
          Main: {
            prototype: {
              loadPageHTML: (
                this: FlipMainInstance,
                page: number,
                cb: (...args: unknown[]) => unknown,
              ) => unknown;
            };
          };
        };
      }
    ).FLIPBOOK.Main.prototype;
    guardPageLoaded();
    const main = Object.assign(Object.create(proto), {
      options: { pages: [] },
    }) as FlipMainInstance & {
      options: Record<string, unknown>;
    };
    let content: unknown;
    let args: unknown[] = [];
    await proto.loadPageHTML.call(main, -1, (value, ...rest) => {
      content = value;
      args = rest;
    });
    assert.ok(content instanceof dom.window.Node);
    assert.equal((content as HTMLElement).innerHTML, "");
    assert.deepEqual(args, []);

    let positive: unknown;
    await proto.loadPageHTML.call(main, 0, (value) => {
      positive = value;
    });
    assert.ok(positive instanceof dom.window.Node);
  } finally {
    restore();
  }
});
