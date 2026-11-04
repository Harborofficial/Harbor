import "./_localstorage-stub.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  clearAllNuvioPinCaches,
  getPinCacheKey,
  rememberNuvioPin,
  verifyNuvioPin,
  verifyNuvioPinLocally,
} from "../src/lib/nuvio/nuvio-profiles";
import { hashProfilePassword } from "../src/lib/profile-password";

function setNuvioState() {
  localStorage.clear();
  localStorage.setItem("harbor.account-provider", "nuvio");
  localStorage.setItem(
    "harbor.nuvio.state.v1",
    JSON.stringify({
      session: { access_token: "token", user: { id: "acc-pin" } },
      profiles: [{ profile_index: 1, name: "Profile 1", pin_enabled: true }],
      activeProfileIndex: 1,
    }),
  );
}

test("nuvio PIN cache stores a salted PBKDF2 digest", async () => {
  setNuvioState();
  clearAllNuvioPinCaches();

  await rememberNuvioPin(1, "1234");
  const stored = localStorage.getItem(getPinCacheKey(1, "acc-pin"));
  assert.ok(stored?.startsWith("pbkdf2$120000$"), "cache must use a versioned PBKDF2 digest");
  assert.equal(await verifyNuvioPinLocally(1, "1234"), true);
  assert.equal(await verifyNuvioPinLocally(1, "9999"), false);
});

test("legacy fixed-salt PIN digests still verify and upgrade in place", async () => {
  setNuvioState();
  clearAllNuvioPinCaches();

  localStorage.setItem(getPinCacheKey(1, "acc-pin"), await hashProfilePassword("1234"));
  assert.equal(await verifyNuvioPinLocally(1, "1234"), true, "legacy digest must still verify");

  let upgraded: string | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    upgraded = localStorage.getItem(getPinCacheKey(1, "acc-pin"));
    if (upgraded?.startsWith("pbkdf2$")) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(upgraded?.startsWith("pbkdf2$"), "legacy digest must be replaced after verification");
});

test("repeated PIN failures throttle locally and surface retry_after", async () => {
  setNuvioState();
  clearAllNuvioPinCaches();

  let serverCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any) => {
    if (String(url).includes("verify_profile_pin")) {
      serverCalls++;
      return new Response(JSON.stringify({ unlocked: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await verifyNuvioPin(1, "0000");
      assert.equal(result.unlocked, false);
    }
    const callsBeforeBlock = serverCalls;
    const blocked = await verifyNuvioPin(1, "0000");
    assert.equal(blocked.unlocked, false);
    assert.ok(
      (blocked.retry_after_seconds ?? 0) > 0,
      "a blocked profile must report the remaining cooldown",
    );
    assert.equal(serverCalls, callsBeforeBlock, "blocked attempts must not reach the server");
  } finally {
    globalThis.fetch = originalFetch;
    clearAllNuvioPinCaches();
  }
});
