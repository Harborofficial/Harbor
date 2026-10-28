import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { hasUncachedMarker, isCached } from "../src/lib/streams/cached.ts";
import { addonInstanceKey, needsDownload } from "../src/views/play-picker/picker-utils.ts";
import { shouldIgnoreSourceDrawerKey } from "../src/views/play-picker/keyboard.ts";

test("source drawer keyboard guard leaves focused controls to their normal activation", () => {
  const dom = new JSDOM(`<main id="picker">
    <button id="play">Play</button>
    <a id="back" href="#">Back</a>
    <select id="source"></select>
    <div id="remote" role="button" tabindex="0"></div>
    <div id="editable" contenteditable="true"></div>
  </main>`);
  const picker = dom.window.document.querySelector<HTMLElement>("#picker")!;

  for (const id of ["play", "back", "source", "remote", "editable"]) {
    const target = dom.window.document.getElementById(id)!;
    assert.equal(shouldIgnoreSourceDrawerKey(target, picker), true, id);
  }
  assert.equal(shouldIgnoreSourceDrawerKey(picker, picker), false);
  dom.window.close();
});

test("source drawer keyboard guard ignores keys while another dialog is active", () => {
  const dom = new JSDOM(`<main id="picker"><div id="page"></div></main>
    <div role="dialog" aria-modal="true"><p>Other dialog</p></div>`);
  const picker = dom.window.document.querySelector<HTMLElement>("#picker")!;
  const target = dom.window.document.getElementById("page")!;

  assert.equal(shouldIgnoreSourceDrawerKey(target, picker), true);
  dom.window.close();
});

test("source drawer keyboard guard ignores non-interactive overlay regions outside the picker", () => {
  const dom = new JSDOM(`<main id="picker"><div id="page"></div></main>
    <div id="overlay"><div id="overlay-background"></div></div>`);
  const picker = dom.window.document.querySelector<HTMLElement>("#picker")!;
  const target = dom.window.document.getElementById("overlay-background")!;

  assert.equal(shouldIgnoreSourceDrawerKey(target, picker), true);
  dom.window.close();
});

test("addon filter identity distinguishes transport instances and plugin URLs", () => {
  const first = { addonId: "torrentio", addonUrl: "https://example.test/manifest?rd=one" };
  const second = { addonId: "torrentio", addonUrl: "https://example.test/manifest?rd=two" };
  const plugin = { addonId: "custom-plugin-id", addonUrl: "harbor-plugin://custom-plugin-id" };
  const addonNamedPlugin = { addonId: "plugin.catalog", addonUrl: "https://other.test/manifest" };

  assert.notEqual(addonInstanceKey(first), addonInstanceKey(second));
  assert.equal(addonInstanceKey(plugin), plugin.addonUrl);
  assert.equal(addonInstanceKey(addonNamedPlugin), addonNamedPlugin.addonUrl);
});

test("📥 stays out of uncached and download-required text markers", () => {
  const textMarker = { name: "📥 Example" };
  assert.equal(hasUncachedMarker(textMarker), false);
  assert.equal(needsDownload(textMarker as never), false);

  const direct = { url: "https://hdhub.example/📥/movie", cached: {}, name: "Example" };
  assert.equal(isCached(direct, []), true);
  assert.equal(hasUncachedMarker(direct), false);
  assert.equal(needsDownload(direct as never), false);
});
