// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { hoverPeekOwner } from "../src/lib/hover-preview/ownership";
import {
  midnightPreviewEnabled,
  type MidnightPreviewGate,
} from "../src/themes/midnight/preview-gate";

const CLEAR_GATE: MidnightPreviewGate = {
  finePointer: true,
  hoverPreviewEnabled: true,
  cardHoverStyle: "default",
  layout: "midnight",
  playing: false,
  pickerOpen: false,
  chromeHidden: false,
  searchOpen: false,
  menuOpen: false,
};

test("the hover preview setting decides whether any card appears at all", () => {
  // Off is the shipped default and means the user asked for no peek: neither owner may draw one.
  for (const layout of ["midnight", "sidebar", "topdock", "stremio"] as const) {
    assert.equal(
      hoverPeekOwner({ hoverPreviewEnabled: false, cardHoverStyle: "default", layout }),
      "none",
      `${layout} must stay quiet while the setting is off`,
    );
    assert.equal(
      midnightPreviewEnabled({ ...CLEAR_GATE, hoverPreviewEnabled: false, layout }),
      false,
      `${layout} must not treat an unchecked setting as a request for its card`,
    );
  }
});

test("Midnight takes the built-in card over instead of running beside it", () => {
  for (const cardHoverStyle of ["default", "marquee"] as const) {
    assert.equal(
      hoverPeekOwner({ hoverPreviewEnabled: true, cardHoverStyle, layout: "sidebar" }),
      "harbor",
    );
    assert.equal(
      hoverPeekOwner({ hoverPreviewEnabled: true, cardHoverStyle, layout: "midnight" }),
      "theme",
    );
  }
});

test("hover styles drawn per card are left to the host untouched", () => {
  for (const cardHoverStyle of [
    "none",
    "elegant",
    "frosted",
    "cinema",
    "spotlight",
    "custom",
  ] as const) {
    for (const layout of ["midnight", "sidebar"] as const) {
      assert.equal(
        hoverPeekOwner({ hoverPreviewEnabled: true, cardHoverStyle, layout }),
        "none",
        `${cardHoverStyle} on ${layout} belongs to neither panel`,
      );
      assert.equal(
        midnightPreviewEnabled({ ...CLEAR_GATE, cardHoverStyle, layout }),
        false,
        `the theme must not add a card to ${cardHoverStyle}`,
      );
    }
  }
});

test("the two card owners are never both claiming one hover", () => {
  const styles = [
    "none",
    "default",
    "marquee",
    "elegant",
    "frosted",
    "cinema",
    "spotlight",
    "custom",
  ] as const;
  for (const hoverPreviewEnabled of [true, false]) {
    for (const cardHoverStyle of styles) {
      // One layout is on screen at a time, so the claim is checked per layout: whichever is active,
      // exactly one of the two may draw the card.
      for (const layout of ["midnight", "sidebar"] as const) {
        const claim = { hoverPreviewEnabled, cardHoverStyle, layout };
        const harbor = hoverPeekOwner(claim) === "harbor";
        const theme = midnightPreviewEnabled({ ...CLEAR_GATE, ...claim });
        assert.ok(!(harbor && theme), `both owners claimed ${cardHoverStyle} on ${layout}`);
      }
    }
  }
});

test("the theme's own clears still hold the card back", () => {
  for (const busy of ["playing", "pickerOpen", "chromeHidden", "searchOpen", "menuOpen"] as const) {
    assert.equal(
      midnightPreviewEnabled({ ...CLEAR_GATE, [busy]: true }),
      false,
      `${busy} must keep the card away`,
    );
  }
  assert.equal(midnightPreviewEnabled({ ...CLEAR_GATE, finePointer: false }), false);
  assert.equal(midnightPreviewEnabled(CLEAR_GATE), true);
});
