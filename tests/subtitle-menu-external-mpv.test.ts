import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const body = read("src/components/player/subtitle-menu/menu-body.tsx");
const tv = read("src/views/big-picture/player/bp-player-subtitles.tsx");
const NOTE = /Harbor sends its subtitles to your mpv\. Pick one in mpv's own subtitle menu\./;

test("with your own mpv, the subtitle panel says where Harbor's subtitles went", () => {
  assert.match(body, /const externalMpv = externalMpvEnabled\(/);
  assert.match(body, NOTE);
  // Harbor's own list is always empty then, so "No subtitles found yet" would be wrong.
  assert.match(body, /!externalMpv &&\s*\(?\s*<EmptyState/);
});

test("the note doesn't wait for the subtitle search, only its button does", () => {
  assert.match(body, /\{\(externalMpv \|\| \(searchIdle && totalExternal === 0\)\) && \(/);
  assert.match(body, /\{searchIdle && \(\s*<button[\s\S]*?search\?\.refresh\(\)/);
});

test("the TV subtitle panel says the same with your own mpv", () => {
  assert.match(tv, /const externalMpv = externalMpvEnabled\(settings\);/);
  assert.match(tv, /\{externalMpv && \(\s*<p className=\{NOTE\}>/);
  assert.match(tv, NOTE);
  // An empty list there means mpv has the subtitles, not that the filters hide them.
  assert.match(tv, /visible\.length === 0 && !externalMpv && \(/);
});
