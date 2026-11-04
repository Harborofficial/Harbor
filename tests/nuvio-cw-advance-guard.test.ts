import test from "node:test";
import assert from "node:assert/strict";
import { shouldAdvanceContentWatchedCard } from "../src/lib/nuvio/nuvio-sync";

test("a legacy caught-up card advances once for a new server watched mark", () => {
  assert.equal(shouldAdvanceContentWatchedCard({ t: 100 }, 200), true);
});

test("an advanced card does not advance again for the same server mark", () => {
  assert.equal(shouldAdvanceContentWatchedCard({ t: 200, serverWatchedAt: 200 }, 200), false);
});

test("a locally newer card is never dragged back by an older server mark", () => {
  assert.equal(shouldAdvanceContentWatchedCard({ t: 300 }, 200), false);
});

test("a later server watched mark allows one more advance", () => {
  assert.equal(shouldAdvanceContentWatchedCard({ t: 200, serverWatchedAt: 200 }, 300), true);
});

test("a server row without a timestamp still advances only once", () => {
  assert.equal(shouldAdvanceContentWatchedCard({ t: 100 }, 0), true);
  assert.equal(shouldAdvanceContentWatchedCard({ t: 100, serverWatchedAt: 0 }, 0), false);
});
