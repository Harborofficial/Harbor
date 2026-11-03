import "./_localstorage-stub.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  dismissNextUpInNuvioCloud,
  pullDismissedNextUpKeysFromNuvio,
} from "../src/lib/nuvio/nuvio-sync";

test("a failed dismissal push survives the next cloud pull", async () => {
  localStorage.clear();
  localStorage.setItem("harbor.account-provider", "nuvio");
  localStorage.setItem(
    "harbor.nuvio.state.v1",
    JSON.stringify({
      session: { access_token: "token", user: { id: "acc-dismiss" } },
      profiles: [{ profile_index: 1, name: "Profile 1", pin_enabled: false }],
      activeProfileIndex: 1,
    }),
  );

  const cloudDismissals: string[] = [];
  let failPush = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any, opts?: any) => {
    const u = String(url);
    if (u.includes("sync_pull_profile_settings_blob")) {
      return new Response(
        JSON.stringify([
          {
            settings_json: {
              version: 4,
              features: {
                continue_watching_settings_payload: JSON.stringify({
                  dismissedNextUpKeys: [...cloudDismissals],
                }),
              },
            },
          },
        ]),
        { status: 200 },
      );
    }
    if (u.includes("sync_push_profile_settings_blob")) {
      if (failPush) return new Response("offline", { status: 503 });
      const body = JSON.parse(opts?.body ?? "{}");
      const raw = body?.p_settings_json?.features?.continue_watching_settings_payload;
      if (raw) {
        const payload = JSON.parse(raw) as { dismissedNextUpKeys?: string[] };
        cloudDismissals.splice(
          0,
          cloudDismissals.length,
          ...(Array.isArray(payload.dismissedNextUpKeys) ? payload.dismissedNextUpKeys : []),
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const dismissed = await dismissNextUpInNuvioCloud(1, "tt1234567", 1, 2);
    assert.equal(dismissed, false, "a failed push must report failure");

    const pulled = await pullDismissedNextUpKeysFromNuvio(1);
    assert.ok(
      pulled.has("tt1234567|-1|-1"),
      "an unacknowledged dismissal must survive a pull that omits it",
    );

    failPush = false;
    const retried = await dismissNextUpInNuvioCloud(1, "tt1234567", 1, 2);
    assert.equal(retried, true, "the retried push must succeed");

    // Another device un-dismisses after the push was acknowledged.
    cloudDismissals.length = 0;
    const afterAck = await pullDismissedNextUpKeysFromNuvio(1);
    assert.equal(
      afterAck.has("tt1234567|-1|-1"),
      false,
      "an acknowledged dismissal must follow the cloud again",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
