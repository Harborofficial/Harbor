import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RELEASES_URL } from "../src/lib/updater/release-links.ts";

test("rollback release actions open the official repository", () => {
  assert.equal(RELEASES_URL, "https://github.com/Harborofficial/Harbor/releases");

  for (const path of [
    "rollback-row.tsx",
    "rollback-row/version-item.tsx",
    "rollback-row/version-notes-modal.tsx",
  ]) {
    const source = readFileSync(new URL(`../src/views/settings/${path}`, import.meta.url), "utf8");
    assert.match(source, /import \{ RELEASES_URL \} from "@\/lib\/updater\/release-links"/);
    assert.match(source, /openUrl\(RELEASES_URL\)/);
    assert.doesNotMatch(source, /github\.com\/harborstremio\/harbor\/releases/i);
  }
});
