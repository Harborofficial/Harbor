import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Tauri turns requireLiteralLeadingDot on by default on unix, so the `**` scope
// never reaches the thumbnail cache under ~/.cache. Turning the flag off would
// fix the images and hand the WebView ~/.ssh with them, so the one directory is
// granted at runtime instead.
test("the thumbnail cache reaches the asset protocol without widening the scope", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.deepEqual(config.app.security.assetProtocol.scope, ["**"]);
  assert.match(read("src-tauri/src/lib.rs"), /thumb_cache::allow_asset_access\(app\.handle\(\)\)/);
  assert.match(
    read("src-tauri/src/thumb_cache.rs"),
    /asset_protocol_scope\(\)\s*\.allow_directory\(&dir, false\)/,
  );
});
