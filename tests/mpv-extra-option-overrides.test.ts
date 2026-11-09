// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { hasCustomMpvSubtitleStyle, mpvExtraOptionKeys } from "../src/lib/player/mpv-tuning.ts";

import { subStyleProperties } from "../src/lib/player/sub-style.ts";
import { DEFAULT } from "../src/lib/settings/defaults.ts";
import type { Settings } from "../src/lib/settings/types.ts";

const context = { assNativeActive: false, imageNativeActive: false };

test("visual mpv subtitle overrides request native subtitles", () => {
  assert.equal(hasCustomMpvSubtitleStyle("sub-font=Arial\nsub-pos=100"), true);
  assert.equal(hasCustomMpvSubtitleStyle("sub-line-spacing=-6"), true);
  assert.equal(hasCustomMpvSubtitleStyle("# sub-font=Arial\nbrightness=5"), false);
  assert.equal(hasCustomMpvSubtitleStyle("sub-visibility=no\nosd-font=Arial"), false);
});

test("Advanced options parse like mpv.conf lines", () => {
  assert.deepEqual(
    [
      ...mpvExtraOptionKeys(
        "--sub-spacing=2\n sub-border-size = 3\nsub-scale 1.2\n# note\n// note\nterminal=yes\n\nSUB-BOLD=yes\n--  sub-italic\n",
      ),
    ],
    ["sub-spacing", "sub-border-size", "sub-scale", "sub-bold", "sub-italic"],
  );
});

test("subtitle style writes every property Harbor owns by default", () => {
  const settings: Settings = { ...DEFAULT, mpvExtraOptions: "" };
  const props = new Map(subStyleProperties(settings, context));
  assert.equal(props.get("sub-spacing"), 0);
  assert.equal(props.get("sub-border-size"), 0);
  assert.equal(props.get("sub-scale"), 1);
  assert.equal(props.get("sub-color"), "#FFFFFFFF");
});

test("explicit mpv.conf subtitle options survive Harbor's style pass", () => {
  const settings: Settings = {
    ...DEFAULT,
    mpvExtraOptions: "sub-spacing=2\nsub-border-size=3\n--sub-scale=1.2",
  };
  const props = new Map(subStyleProperties(settings, context));
  assert.equal(props.has("sub-spacing"), false);
  assert.equal(props.has("sub-border-size"), false);
  assert.equal(props.has("sub-scale"), false);
  // Everything the user did not pin is still applied from Harbor's settings.
  assert.equal(props.get("sub-color"), "#FFFFFFFF");
  assert.equal(props.get("sub-margin-y"), 12);
  assert.equal(props.get("sub-ass-override"), "no");
});

test("mpv aliases count as the same subtitle property", () => {
  const shadow = new Map(
    subStyleProperties({ ...DEFAULT, mpvExtraOptions: "sub-shadow-color=#000000" }, context),
  );
  assert.equal(shadow.has("sub-shadow-color"), false);
  assert.equal(shadow.has("sub-back-color"), false);

  const outline = new Map(
    subStyleProperties(
      { ...DEFAULT, mpvExtraOptions: "sub-outline-color=#ff0000\nsub-outline-size=3" },
      context,
    ),
  );
  assert.equal(outline.has("sub-border-color"), false);
  assert.equal(outline.has("sub-border-size"), false);
});

test("non-subtitle options do not disturb the subtitle style pass", () => {
  const settings: Settings = { ...DEFAULT, mpvExtraOptions: "brightness=5\nhwdec=auto" };
  const props = new Map(subStyleProperties(settings, context));
  assert.equal(props.get("sub-spacing"), 0);
  assert.equal(props.get("sub-border-size"), 0);
});

test("requested subtitle preset keeps every supported style property", () => {
  const options = [
    "sub-use-margins=yes",
    "sub-pos=100",
    "sub-margin-y=2",
    "sub-font=Arial",
    "sub-font-size=43",
    "sub-color=#ffffff",
    "sub-border-color=#000000",
    "sub-border-size=2",
    "sub-shadow-offset=1",
    "sub-shadow-color=#000000",
    "sub-spacing=0",
    "sub-line-spacing=-6",
    "sub-ass-override=force",
    "osd-font=Arial",
    "osd-font-size=43",
    "osd-margin-y=50",
  ].join("\n");
  assert.equal(hasCustomMpvSubtitleStyle(options), true);
  const keys = mpvExtraOptionKeys(options);
  const props = new Map(subStyleProperties({ ...DEFAULT, mpvExtraOptions: options }, context));
  for (const key of keys) {
    if (!key.startsWith("sub-")) continue;
    assert.equal(props.has(key), false, `${key} was overwritten by Harbor`);
  }
  assert.equal(props.has("sub-back-color"), false, "shadow alias must be preserved");
});
