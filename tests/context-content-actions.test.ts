// @ts-expect-error Node test types are outside browser config.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside browser config.
import test from "node:test";
import { contentActions } from "../src/components/context-menu/content-actions.tsx";

test("a linked poster keeps its independent page link without any image commands", () => {
  const actions = contentActions({
    image: {
      src: "https://images.example.org/poster.png",
      publicUrl: "https://images.example.org/poster.png",
    },
    link: "https://games.example.org/game",
  });
  assert.deepEqual(
    actions.map((action) => action.id),
    ["link:open", "link:copy"],
  );
});

test("an image alone or a link to that same image has no contextual commands", () => {
  for (const image of [
    { src: "https://images.example.org/poster.png" },
    {
      src: "https://images.example.org/poster.png",
      publicUrl: "https://images.example.org/poster.png",
    },
    {
      src: "https://images.example.org/small.png",
      originalSrc: "https://images.example.org/full.png",
    },
    { src: "blob:https://example.org/fixture" },
    { src: "data:image/png;base64,iVBORw0KGgo=" },
  ]) {
    assert.deepEqual(contentActions({ image }), []);
    assert.deepEqual(contentActions({ image, link: image.src }), []);
    if (image.originalSrc) assert.deepEqual(contentActions({ image, link: image.originalSrc }), []);
  }
});

test("selected text keeps its own command even when an image has no commands", () => {
  const actions = contentActions({
    selection: "selected words",
    image: { src: "blob:https://example.org/fixture" },
  });
  assert.deepEqual(
    actions.map((action) => action.id),
    ["selection:copy"],
  );
});

test("ordinary links preserve opening and safe copying without adding image tools", () => {
  const actions = contentActions({ link: "https://site.example.org/page" });
  assert.deepEqual(
    actions.map((action) => action.id),
    ["link:open", "link:copy"],
  );
  const privateLink = contentActions({ link: "https://site.example.org/page?token=fixture" });
  assert.deepEqual(
    privateLink.map((action) => action.id),
    ["link:open"],
  );
});
