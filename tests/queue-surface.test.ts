import assert from "node:assert/strict";
import test from "node:test";
import { hookHarness } from "./helpers/hook-harness.ts";

function allowed(topKind: string, type?: string, metaLiveContext = false) {
  const hook = hookHarness("src/hooks/use-queue-surface.ts", "useQueueSurface", {
    "@/lib/view": {
      useView: () => ({ topKind, meta: type ? { type } : null, metaLiveContext }),
    },
  });
  try {
    return hook.render();
  } finally {
    hook.unmount();
  }
}

for (const type of ["movie", "series", "anime"]) {
  test(`queue controls are available on ${type} details`, () => {
    assert.equal(allowed("meta", type), true);
  });
  test(`live ${type} details do not enable queue controls`, () => {
    assert.equal(allowed("meta", type, true), false);
  });
}

test("unsupported and missing metadata do not enable queue controls", () => {
  for (const type of [undefined, "tv", "channel", "manga", "ebook", "music"]) {
    assert.equal(allowed("meta", type), false);
  }
});

test("existing supported pages retain queue access", () => {
  for (const page of [
    "home",
    "movies",
    "shows",
    "anime",
    "discover",
    "catalogs",
    "episode-detail",
  ]) {
    assert.equal(allowed(page), true);
  }
});

test("unrelated pages do not enable the floating queue surface", () => {
  for (const page of ["settings", "library", "player", "picker", "manga"]) {
    assert.equal(allowed(page, "movie"), false);
  }
});
