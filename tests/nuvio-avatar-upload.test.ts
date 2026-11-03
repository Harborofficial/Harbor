import "./_localstorage-stub.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { uploadNuvioCustomAvatar } from "../src/lib/nuvio/nuvio-profiles";

function setNuvioState() {
  localStorage.clear();
  localStorage.setItem("harbor.account-provider", "nuvio");
  localStorage.setItem(
    "harbor.nuvio.state.v1",
    JSON.stringify({
      session: { access_token: "token", user: { id: "acc-avatar" } },
      profiles: [{ profile_index: 1, name: "Profile 1", pin_enabled: false }],
      activeProfileIndex: 1,
    }),
  );
}

test("custom avatars upload only to Nuvio Storage", async () => {
  setNuvioState();

  let fetchedUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any) => {
    fetchedUrl = String(url);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const uploaded = await uploadNuvioCustomAvatar(png, 2);
    assert.ok(fetchedUrl.includes("/storage/v1/object/avatars/custom/acc-avatar/p2-"));
    assert.ok(
      uploaded?.startsWith(
        "https://api.nuvio.tv/storage/v1/object/public/avatars/custom/acc-avatar/p2-",
      ),
      "upload must resolve to a Nuvio Storage public URL",
    );
    assert.equal(
      /catbox|tmpfiles|freeimage/.test(uploaded ?? ""),
      false,
      "uploads must never leave for a third-party image host",
    );

    const external = await uploadNuvioCustomAvatar("https://example.com/avatar.png", 2);
    assert.equal(external, "https://example.com/avatar.png", "external URLs pass through");

    const nonImage = new Blob(["not an image"], { type: "text/plain" });
    assert.equal(await uploadNuvioCustomAvatar(nonImage, 2), null);

    const oversized = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/png" });
    assert.equal(await uploadNuvioCustomAvatar(oversized, 2), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
