import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import type { Addon } from "../src/lib/addons.ts";
import { clearAddonStreamCache, fetchAddonStreams } from "../src/lib/streams/addons.ts";

const addon: Addon = {
  manifest: {
    id: "community.aiostreams",
    name: "AIOStreams",
    resources: [{ name: "stream", types: ["series"], idPrefixes: ["tt"] }],
    types: ["series"],
    idPrefixes: ["tt"],
  },
  transportUrl: "https://addon.example/manifest.json",
};

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

test("a prefetched addon answer is reused instead of asked twice", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    assert.match(requestUrl(input), /\/stream\/series\/tt123:1:2\.json$/);
    return new Response(
      JSON.stringify({ streams: [{ name: "1080p", url: "https://cdn.example/episode-2" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    clearAddonStreamCache();
    const req = { type: "series", ids: ["tt123:1:2"] };
    const first = await fetchAddonStreams(
      [addon],
      req,
      new AbortController().signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
    assert.equal(first.length, 1);
    assert.equal(calls, 1);

    const second = await fetchAddonStreams([addon], req, new AbortController().signal);
    assert.equal(second.length, 1);
    assert.equal(calls, 1, "the second call has to come from the response cache");

    await fetchAddonStreams([addon], req, new AbortController().signal);
    assert.equal(calls, 2, "foreground answers are not retained after consumption");

    clearAddonStreamCache();
    await fetchAddonStreams([addon], req, new AbortController().signal);
    assert.equal(calls, 3, "refresh drops the cache so the addon is asked again");
  } finally {
    globalThis.fetch = original;
    clearAddonStreamCache();
  }
});
