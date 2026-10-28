import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { HarborSocialArt } from "../src/views/account/harbor-social-art.tsx";
import { HarborSocialCover } from "../src/views/account/harbor-social-cover.tsx";

test("multiple vector covers resolve their definitions independently without raster or focus targets", () => {
  const markup = renderToStaticMarkup(
    <>
      <HarborSocialArt />
      <HarborSocialArt />
    </>,
  );
  const dom = new JSDOM(markup);
  try {
    assert.equal(dom.window.document.querySelectorAll("svg").length, 2);
    const allIds = new Set<string>();
    for (const svg of dom.window.document.querySelectorAll("svg")) {
      assert.equal(svg.getAttribute("aria-hidden"), "true");
      assert.equal(svg.getAttribute("focusable"), "false");
      assert.equal(svg.querySelector("image, foreignObject, a, [tabindex]"), null);
      const localIds = new Set(Array.from(svg.querySelectorAll("[id]"), (el) => el.id));
      assert.ok(localIds.size > 0);
      for (const id of localIds) {
        assert.ok(!allIds.has(id), "each cover owns its gradient and clipping definitions");
        allIds.add(id);
      }
      for (const el of svg.querySelectorAll("*")) {
        for (const attr of Array.from(el.attributes)) {
          const reference =
            attr.value.match(/^url\(#(.+)\)$/)?.[1] ??
            (attr.name === "href" && attr.value.startsWith("#") ? attr.value.slice(1) : null);
          if (reference) assert.ok(localIds.has(reference), "references stay within this SVG");
        }
      }
    }
  } finally {
    dom.window.close();
  }
});

test("visibility and closing stop the same cover without replaying or retaining subscriptions", async () => {
  const dom = new JSDOM("<div id='root'></div>");
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  const visibilityListeners = new Set<EventListenerOrEventListenerObject>();
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  document.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: any,
  ) => {
    if (type === "visibilitychange") visibilityListeners.add(listener);
    add(type, listener, options);
  }) as typeof document.addEventListener;
  document.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: any,
  ) => {
    if (type === "visibilitychange") visibilityListeners.delete(listener);
    remove(type, listener, options);
  }) as typeof document.removeEventListener;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  try {
    await React.act(() => root.render(<HarborSocialCover active />));
    const cover = document.querySelector<HTMLElement>(".harbor-social-cover")!;
    const svg = cover.querySelector("svg")!;
    assert.equal(cover.dataset.paused, "false");
    assert.equal(visibilityListeners.size, 1);
    hidden = true;
    await React.act(() => document.dispatchEvent(new dom.window.Event("visibilitychange")));
    assert.equal(cover.dataset.paused, "true");
    hidden = false;
    await React.act(() => document.dispatchEvent(new dom.window.Event("visibilitychange")));
    assert.equal(cover.dataset.paused, "false");
    await React.act(() => root.render(<HarborSocialCover active />));
    assert.ok(cover.querySelector("svg") === svg, "ordinary rerenders retain the animation nodes");
    await React.act(() => root.render(<HarborSocialCover active={false} />));
    assert.equal(cover.dataset.active, "false");
    assert.ok(cover.querySelector("svg") === svg);
  } finally {
    await React.act(() => root.unmount());
    assert.equal(visibilityListeners.size, 0, "unmount removes the visibility listener");
    dom.window.close();
  }
});
