// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import type { Addon } from "../src/lib/addons.ts";
import { addonTimeoutFor } from "../src/lib/streams/addons.ts";

function addon(name: string): Addon {
  return {
    manifest: { id: name.toLowerCase(), name },
    transportUrl: "https://example.test/manifest.json",
  } as Addon;
}

test("AIOStreams gets a longer budget without raising other addons", () => {
  const aio = addon("AIOStreams");
  assert.equal(addonTimeoutFor(aio, 15_000), 60_000);
  assert.equal(addonTimeoutFor(aio, 30_000), 60_000);
  assert.equal(addonTimeoutFor(aio, 90_000), 90_000);

  assert.equal(addonTimeoutFor(addon("Torrentio"), 30_000), 30_000);
  assert.equal(addonTimeoutFor(addon("Unknown addon"), 30_000), 30_000);
  assert.equal(addonTimeoutFor(addon("Unknown addon"), 8_000), 8_000);
});
