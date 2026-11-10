// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";

import { subStyleProperties } from "../src/lib/player/sub-style.ts";
import { assNormalizeSource } from "../src/views/player/hooks/use-ass-normalize.ts";
import { DEFAULT } from "../src/lib/settings/defaults.ts";
import type { Settings } from "../src/lib/settings/types.ts";

const ASS_NATIVE = { assNativeActive: true, imageNativeActive: false };

function props(settings: Settings, context = ASS_NATIVE): Map<string, unknown> {
  return new Map(subStyleProperties(settings, context));
}

test("Match my size still scales ASS subtitles when the header cannot be read", () => {
  const settings: Settings = {
    ...DEFAULT,
    subAssOverride: "no",
    subAssNormalizeSize: true,
    subFontSize: 26,
  };

  const written = props(settings);
  // mpv ignores sub-scale under sub-ass-override=no, which made the size slider a no-op.
  assert.equal(written.get("sub-ass-override"), "scale");
  assert.equal(written.get("sub-scale"), 26 / 32);
  // Keeping the file's look still means its own style and sign placement.
  assert.equal(written.get("sub-use-margins"), "no");
  assert.equal(written.get("sub-ass-force-margins"), "no");
  assert.equal(written.get("sub-pos"), 100);
});

test("a resolved ASS header replaces the plain size scale", () => {
  const settings: Settings = {
    ...DEFAULT,
    subAssOverride: "no",
    subAssNormalizeSize: true,
    subFontSize: 26,
  };

  const written = props(settings, { ...ASS_NATIVE, assScale: 0.5735 });
  assert.equal(written.get("sub-ass-override"), "scale");
  assert.equal(written.get("sub-scale"), 0.5735);
});

test("the fallback does not override another mode or a non-ASS track", () => {
  const normalizeOn: Settings = { ...DEFAULT, subAssNormalizeSize: true, subFontSize: 26 };

  assert.equal(props({ ...normalizeOn, subAssOverride: "force" }).get("sub-ass-override"), "force");
  assert.equal(props({ ...normalizeOn, subAssOverride: "font" }).get("sub-ass-override"), "yes");
  assert.equal(props({ ...normalizeOn, subAssOverride: "strip" }).get("sub-ass-override"), "strip");
  assert.equal(
    props(normalizeOn, { assNativeActive: false, imageNativeActive: false }).get(
      "sub-ass-override",
    ),
    "no",
  );
  assert.equal(props({ ...normalizeOn, subAssNormalizeSize: false }).get("sub-ass-override"), "no");
});

test("normalization reads the file mpv is playing, not the provider URL", () => {
  assert.equal(
    assNormalizeSource({
      id: "1",
      label: "Prepared",
      kind: "subtitle",
      selected: true,
      external: true,
      externalFilename: "C:/Users/me/AppData/Local/Temp/harbor-subs/prepared/1/subtitle.ass",
      url: "https://provider.test/subtitle.ass",
    }),
    "C:/Users/me/AppData/Local/Temp/harbor-subs/prepared/1/subtitle.ass",
  );
  assert.equal(
    assNormalizeSource({
      id: "2",
      label: "Remote",
      kind: "subtitle",
      selected: true,
      external: true,
      externalFilename: "https://subs.test/show.ass",
    }),
    "https://subs.test/show.ass",
  );
  assert.equal(
    assNormalizeSource({
      id: "3",
      label: "Embedded",
      kind: "subtitle",
      selected: true,
    }),
    null,
  );
});
