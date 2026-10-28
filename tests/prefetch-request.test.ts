import assert from "node:assert/strict";
import test from "node:test";
import { clearPrefetchedRequests, prefetchRequest } from "../src/lib/streams/prefetch-request.ts";

test("foreground adopts an unfinished prefetch despite background cancellation", async () => {
  clearPrefetchedRequests();
  let finish!: (value: string[]) => void;
  let calls = 0;
  const load = async () => {
    calls++;
    return new Promise<string[]>((resolve) => {
      finish = resolve;
    });
  };
  const usable = (value: string[]) => value.length > 0;
  const background = new AbortController();
  const first = prefetchRequest("episode", background.signal, true, load, usable);
  await Promise.resolve();
  const next = prefetchRequest("episode", new AbortController().signal, false, load, usable);
  background.abort();
  await assert.rejects(first);
  finish(["source"]);
  assert.deepEqual(await next, ["source"]);
  assert.equal(calls, 1);
  clearPrefetchedRequests();
});

test("empty prefetch answers and expired answers are queried again", async () => {
  clearPrefetchedRequests();
  let calls = 0;
  const load = async () => {
    calls++;
    return calls === 1 ? [] : ["source"];
  };
  const usable = (value: string[]) => value.length > 0;
  const signal = new AbortController().signal;
  await prefetchRequest("episode", signal, true, load, usable);
  await prefetchRequest("episode", signal, true, load, usable);
  assert.equal(calls, 2);
  const original = Date.now;
  try {
    const now = Date.now();
    Date.now = () => now + 91_000;
    await prefetchRequest("episode", signal, false, load, usable);
    assert.equal(calls, 3);
  } finally {
    Date.now = original;
    clearPrefetchedRequests();
  }
});
