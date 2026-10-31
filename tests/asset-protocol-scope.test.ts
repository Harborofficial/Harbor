import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tauri defaults requireLiteralLeadingDot to true on unix, which makes the `**`
// scope refuse every path holding a dot directory. The thumbnail cache lives in
// ~/.cache/app.harbor, so with the default every cached image is refused by the
// asset protocol and the poster falls through to its gradient plate.
test("the asset protocol scope reaches the dot directories the caches live in", () => {
  const config = JSON.parse(
    readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  const scope = config.app.security.assetProtocol.scope;
  assert.deepEqual(scope.allow, ["**"]);
  assert.equal(scope.requireLiteralLeadingDot, false);
  // Turning the flag off also exposes the dot directories that hold credentials,
  // which nothing in the app ever serves through the asset protocol.
  for (const dir of [".ssh", ".aws", ".gnupg"]) {
    assert.ok(scope.deny.includes(`$HOME/${dir}/**`), `${dir} must stay denied`);
  }
});
