import assert from "node:assert/strict";
import test from "node:test";
import { readM3uHeaderEpgUrls } from "../src/lib/iptv/m3u.ts";

test("reads url-tvg from the EXTM3U header", () => {
  const text =
    '#EXTM3U url-tvg="https://cdn.example.com/guide.xml.gz"\n' +
    '#EXTINF:-1 tvg-id="one" group-title="News",One\nhttps://cdn.example.com/one.ts';
  assert.deepEqual(readM3uHeaderEpgUrls(text, "https://cdn.example.com/playlist.m3u"), [
    "https://cdn.example.com/guide.xml.gz",
  ]);
});

test("reads x-tvg-url and tvg-url with single or double quotes", () => {
  const x = "#EXTM3U x-tvg-url='https://guide.example.com/a.xml'\n";
  const tvg = '#EXTM3U tvg-url="https://guide.example.com/b.xml"\n';
  assert.deepEqual(readM3uHeaderEpgUrls(x), ["https://guide.example.com/a.xml"]);
  assert.deepEqual(readM3uHeaderEpgUrls(tvg), ["https://guide.example.com/b.xml"]);
});

test("splits comma-separated guide URLs and dedupes them", () => {
  const text =
    '#EXTM3U url-tvg="https://a.example.com/one.xml, https://b.example.com/two.xml" ' +
    'x-tvg-url="https://a.example.com/one.xml"\n';
  assert.deepEqual(readM3uHeaderEpgUrls(text), [
    "https://a.example.com/one.xml",
    "https://b.example.com/two.xml",
  ]);
});

test("resolves relative guide URLs against the playlist URL", () => {
  const text = '#EXTM3U url-tvg="guides/epg.xml"\n';
  assert.deepEqual(readM3uHeaderEpgUrls(text, "https://host.example.com/live/playlist.m3u"), [
    "https://host.example.com/live/guides/epg.xml",
  ]);
});

test("handles a BOM before the header", () => {
  const text = '\uFEFF#EXTM3U url-tvg="https://cdn.example.com/epg.xml"\n';
  assert.deepEqual(readM3uHeaderEpgUrls(text), ["https://cdn.example.com/epg.xml"]);
});

test("ignores missing headers, non-http URLs, and headers after the first line", () => {
  assert.deepEqual(readM3uHeaderEpgUrls("#EXTINF:-1,One\nhttps://example.com/1.ts"), []);
  assert.deepEqual(readM3uHeaderEpgUrls('#EXTM3U url-tvg="file:///tmp/epg.xml"'), []);
  assert.deepEqual(
    readM3uHeaderEpgUrls("#EXTINF:-1,One\n#EXTM3U url-tvg=\"https://example.com/epg.xml\""),
    [],
  );
});
