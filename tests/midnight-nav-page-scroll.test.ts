// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { JSDOM } from "jsdom";
import { isPageScroller, pageScrollTop } from "../src/themes/midnight/nav-scroll";

/**
 * jsdom lays nothing out, so a box is stated rather than measured: the page is 900 tall and 1400
 * wide, and each container is given the size the browser would have given it.
 */
function box<T extends HTMLElement>(
  el: T,
  {
    clientHeight,
    clientWidth,
    scrollHeight,
  }: { clientHeight: number; clientWidth: number; scrollHeight: number },
): T {
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: clientWidth, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  return el;
}

function scrolls<T extends HTMLElement>(el: T): T {
  el.style.overflowY = "auto";
  return el;
}

function clips<T extends HTMLElement>(el: T): T {
  el.style.overflowY = "hidden";
  return el;
}

function board() {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="shell">
      <main id="page">
        <header id="head"></header>
        <div id="bodyScroll"></div>
        <div id="rail"></div>
        <div id="pageScroll"><div id="synopsis"></div></div>
      </main>
    </div>
    <div id="portal" role="dialog"><div id="dialogScroll"></div></div>
  </body>`);
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    getComputedStyle: dom.window.getComputedStyle,
  });
  const doc = dom.window.document;
  const page = box(clips(doc.getElementById("page")!), {
    clientHeight: 900,
    clientWidth: 1400,
    scrollHeight: 900,
  });
  return { doc, page };
}

test("the viewport and the page element are the page moving", () => {
  const { doc, page } = board();
  assert.ok(isPageScroller(doc, page), "the document scrolls the page");
  assert.ok(isPageScroller(doc.documentElement, page));
  assert.ok(isPageScroller(doc.body, page));
  assert.ok(isPageScroller(page, page), "main itself is the classic page scroller");
  // A wrapper that scrolls <main> is the page too, which is how the bar behaved before per-view
  // containers existed.
  assert.ok(isPageScroller(doc.getElementById("shell")!, page));
});

test("a view that clips its main hands scrolling to its body container", () => {
  const { doc, page } = board();
  // Calendar's shape: <main> clips, .calendar-body-scroll carries the page.
  const body = box(scrolls(doc.getElementById("bodyScroll")!), {
    clientHeight: 760,
    clientWidth: 1360,
    scrollHeight: 4000,
  });
  assert.ok(isPageScroller(body, page), "the page's own container must recede the bar");
});

test("a rail beside the content scrolls to be read, not to browse", () => {
  const { doc, page } = board();
  box(scrolls(doc.getElementById("bodyScroll")!), {
    clientHeight: 760,
    clientWidth: 1000,
    scrollHeight: 4000,
  });
  const rail = box(scrolls(doc.getElementById("rail")!), {
    clientHeight: 760,
    clientWidth: 360,
    scrollHeight: 2000,
  });
  assert.ok(!isPageScroller(rail, page), "a narrow column is not the page however tall it is");
});

test("a pane under the scroller that already moves the page is not the page", () => {
  const { doc, page } = board();
  const body = box(scrolls(doc.getElementById("bodyScroll")!), {
    clientHeight: 760,
    clientWidth: 1360,
    scrollHeight: 4000,
  });
  const synopsis = box(scrolls(doc.createElement("div")), {
    clientHeight: 700,
    clientWidth: 1300,
    scrollHeight: 3000,
  });
  body.appendChild(synopsis);
  assert.ok(!isPageScroller(synopsis, page), "reading a long synopsis must not slide the bar away");
});

test("the pages that scroll main keep their panels out of the gesture", () => {
  const { doc } = board();
  // A view whose <main> is the scroller: anything below it is a panel.
  const page = box(scrolls(doc.getElementById("page")!), {
    clientHeight: 900,
    clientWidth: 1400,
    scrollHeight: 5000,
  });
  const synopsis = box(scrolls(doc.getElementById("synopsis")!), {
    clientHeight: 800,
    clientWidth: 1300,
    scrollHeight: 2400,
  });
  doc.getElementById("pageScroll")!.appendChild(synopsis);
  assert.ok(isPageScroller(page, page));
  assert.ok(!isPageScroller(synopsis, page));
});

test("a dialog or menu portalled out of the page is not the page", () => {
  const { doc, page } = board();
  const sheet = box(scrolls(doc.getElementById("dialogScroll")!), {
    clientHeight: 880,
    clientWidth: 1390,
    scrollHeight: 3000,
  });
  assert.ok(!isPageScroller(sheet, page), "a full-size overlay still is not the page");
  assert.ok(!isPageScroller(doc.getElementById("portal")!, page));
});

test("a scroll offset is read the same way for the viewport and for a container", () => {
  const { doc } = board();
  Object.defineProperty(dom_window(), "scrollY", { value: 240, configurable: true });
  assert.equal(pageScrollTop(doc), 240, "the document reports the viewport offset");
  const container = doc.getElementById("bodyScroll")!;
  Object.defineProperty(container, "scrollTop", { value: 80, configurable: true });
  assert.equal(pageScrollTop(container), 80);
});

function dom_window(): Window {
  return (globalThis as unknown as { window: Window }).window;
}
