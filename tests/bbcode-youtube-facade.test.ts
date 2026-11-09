import assert from "node:assert/strict";
import test from "node:test";
import { renderBbcode } from "../src/lib/social/bbcode.ts";

test("youtube bbcode renders a click-to-play facade instead of an iframe", () => {
  const html = renderBbcode(
    "before [youtube]https://www.youtube.com/watch?v=dQw4w9WgXcQ[/youtube] after",
  );
  assert.match(html, /data-harbor-youtube="dQw4w9WgXcQ"/);
  assert.match(html, /data-harbor-youtube-frame="dQw4w9WgXcQ"/);
  assert.match(html, /https:\/\/i\.ytimg\.com\/vi\/dQw4w9WgXcQ\/hqdefault\.jpg/);
  assert.doesNotMatch(html, /<iframe/i);
});

test("a malformed youtube embed stays a thumbnail-free paragraph", () => {
  const html = renderBbcode("[youtube]not a video[/youtube]");
  assert.doesNotMatch(html, /data-harbor-youtube/);
  assert.doesNotMatch(html, /<iframe/i);
});
