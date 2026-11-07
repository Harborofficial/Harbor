import assert from "node:assert/strict";
import test from "node:test";
import {
  connectedMagnetProviders,
  magnetCloudProvider,
  preferredMagnetProvider,
  rememberMagnetProvider,
  validCloudJobId,
} from "../src/lib/games/magnet-debrid.ts";

const memory = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
};

test("only configured debrid services are selectable", () => {
  assert.deepEqual(connectedMagnetProviders({ rd: "secret", tb: " ", ad: "connected" }), [
    "rd",
    "ad",
  ]);
  assert.deepEqual(connectedMagnetProviders({}), []);
  assert.deepEqual(connectedMagnetProviders({ tb: "torbox" }), ["tb"]);
});

test("the only connected service is automatically selected", () => {
  assert.equal(preferredMagnetProvider("single", ["tb"]), "tb");
  assert.equal(preferredMagnetProvider("empty", []), null);
});

test("last-used provider is remembered per profile and ignores disconnected ones", () => {
  rememberMagnetProvider("profile-a", "ad");
  assert.equal(preferredMagnetProvider("profile-a", ["rd", "ad"]), "ad");
  assert.equal(preferredMagnetProvider("profile-b", ["rd", "ad"]), "rd");
  assert.equal(preferredMagnetProvider("profile-a", ["tb"]), "tb");
  rememberMagnetProvider("profile-a", "tb");
  assert.equal(preferredMagnetProvider("profile-a", ["tb", "pm"]), "tb");
});

test("magnet cloud job IDs reject traversal and malicious values", () => {
  assert.equal(validCloudJobId("index:5"), true);
  assert.equal(validCloudJobId("42"), true);
  for (const value of ["..", ".", "", "abc/def", "a\nb", "x".repeat(129), 5, null]) {
    assert.equal(validCloudJobId(value), false);
  }
});

test("only providers with cloud file browsers offer the browse action", () => {
  assert.equal(magnetCloudProvider("rd"), true);
  assert.equal(magnetCloudProvider("tb"), true);
  assert.equal(magnetCloudProvider("pm"), true);
  assert.equal(magnetCloudProvider("ad"), false);
});
