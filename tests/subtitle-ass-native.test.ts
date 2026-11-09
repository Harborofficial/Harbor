import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const usePlayerMedia = readFileSync(
  new URL("../src/views/player/hooks/use-player-media.ts", import.meta.url),
  "utf8",
);

test("mpv draws ASS subtitles from addons like embedded ones, also with Use my style", () => {
  const rule = usePlayerMedia.match(/const subAssNative =([^;]+);/)?.[1] ?? "";
  assert.match(rule, /subEmbed && selectedAssSub/);
  // Sending addon ASS to Harbor's HTML overlay with "Use my style" moved every sign to the bottom.
  assert.doesNotMatch(rule, /external/);
  assert.doesNotMatch(rule, /subAssOverridden/);
});
