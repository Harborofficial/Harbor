import test from "node:test";
import assert from "node:assert/strict";
import { hostCheckNote } from "../src/lib/games/source-hosts.ts";
import en from "../src/lib/i18n/locales/en/game-source-discovery.ts";

test("offline host-directory reports cannot be mistaken for link-specific checks",()=>{
  assert.equal(hostCheckNote("down"),"games.sources.host.downNote");
  assert.match(en["games.sources.host.downNote"],/not a test of your specific link/);
  assert.equal(en["games.sources.host.down"],"Provider reports unavailable");
});
test("unknown and cloud-only hosts retain informational notes",()=>{
  assert.equal(hostCheckNote("unknown"),"games.sources.host.unknownNote");
  assert.equal(hostCheckNote("queue"),"games.sources.host.queueNote");
  assert.equal(hostCheckNote("available"),"games.sources.host.fileNote");
});
