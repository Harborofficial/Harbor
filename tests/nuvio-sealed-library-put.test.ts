import "./_localstorage-stub.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { cloudLibraryPutDetailed } from "../src/lib/stremio-write-queue";

test("cloudLibraryPutDetailed reports sealed Nuvio writes without touching the queue", async () => {
  localStorage.clear();
  localStorage.setItem("harbor.account-provider", "nuvio");

  let fetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetches++;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const result = await cloudLibraryPutDetailed("auth", {
      _id: "tt-sealed",
      type: "movie",
      name: "Sealed",
      state: {},
    } as any);
    assert.deepEqual(result, { ok: true, sealed: true });
    assert.equal(fetches, 0, "a sealed write must not reach the network");
    assert.equal(
      localStorage.getItem("harbor.stremio.write-queue.v1"),
      null,
      "a sealed write must not queue a Stremio mutation",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
