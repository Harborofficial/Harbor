import assert from "node:assert/strict";
import test from "node:test";
import { readSessionState, writeSessionState } from "../src/lib/session-state.ts";

test("session values round-trip in module memory", () => {
  assert.equal(readSessionState("session-state:test"), undefined);
  writeSessionState("session-state:test", { filter: "anime", page: 2 });
  assert.deepEqual(readSessionState("session-state:test"), { filter: "anime", page: 2 });
  writeSessionState("session-state:test", { filter: "movies", page: 0 });
  assert.deepEqual(readSessionState("session-state:test"), { filter: "movies", page: 0 });
});

test("different keys keep independent values", () => {
  writeSessionState("session-state:a", "alpha");
  writeSessionState("session-state:b", "beta");
  assert.equal(readSessionState("session-state:a"), "alpha");
  assert.equal(readSessionState("session-state:b"), "beta");
});
