import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Tauri turns requireLiteralLeadingDot on by default on unix, so the `**` scope
// never reaches the thumbnail cache under ~/.cache. Turning the flag off would
// fix the images and hand the WebView ~/.ssh with them, so the one directory is
// granted at runtime instead. The flag is left alone, which means it stays off
// on Windows, where the denylist is what keeps those directories out: Tauri
// registers each deny pattern canonicalized too, so the \\?\ form is covered.
// Reaching the same file through a different UNC alias is not, and denying UNC
// wholesale would cut off media libraries that live on a network share.
test("the thumbnail cache reaches the asset protocol without widening the scope", () => {
  const scope = JSON.parse(read("src-tauri/tauri.conf.json")).app.security.assetProtocol.scope;
  assert.deepEqual(scope.allow, ["**"]);
  assert.equal(scope.requireLiteralLeadingDot, undefined);
  for (const path of [".ssh/**", ".aws/**", ".gnupg/**", ".netrc", ".git-credentials"]) {
    assert.ok(scope.deny.includes(`$HOME/${path}`), `${path} must stay denied`);
  }
  assert.match(read("src-tauri/src/lib.rs"), /thumb_cache::allow_asset_access\(app\.handle\(\)\)/);
  assert.match(
    read("src-tauri/src/thumb_cache.rs"),
    /asset_protocol_scope\(\)\s*\.allow_directory\(&dir, false\)/,
  );
});
