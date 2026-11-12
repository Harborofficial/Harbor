// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// BRIDGE.md is documentation, not a generated asset; a checkout that does not
// carry it still checks the code wiring below.
const docPath = new URL("../android-extension-compat/docs/BRIDGE.md", import.meta.url);
const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : null;
const dispatch = read("android-extension-compat/src/host/BridgeServer.kt");
const moduleCommands = read("src-tauri/extensions-module/src/commands.rs");
const registry = read("src-tauri/src/lib.rs");
const wire = read("src/lib/streams/plugins/extension/bridge.ts");
const browse = read("src/lib/catalog-browse.ts");

test("the catalogue methods the desktop side sends are the ones the bridge answers", () => {
  for (const [command, method] of [
    ["capstan_catalogue", "catalogue"],
    ["capstan_catalogue_page", "cataloguePage"],
  ] as const) {
    if (doc != null)
      assert.match(doc, new RegExp(`\\| \`${method}\``), `BRIDGE.md must document ${method}`);
    assert.match(
      dispatch,
      new RegExp(`"${method}" ->`),
      `the Android bridge must answer ${method}`,
    );
    assert.match(
      moduleCommands,
      new RegExp(`"${command}" => \\("${method}"`),
      `the bridge must dispatch ${method}`,
    );
    assert.match(wire, new RegExp(`command: "${command}"`), `bridge.ts must send ${command}`);
  }
  assert.match(
    wire,
    /args: \{ providerId, row, page \}/,
    "cataloguePage is addressed by row name, not by row data",
  );
});

test("both catalogue commands are registered, so neither is an engine with no caller", () => {
  assert.match(
    registry,
    /native_module::native_module_call,/,
    "the native module bridge must be registered",
  );
  for (const command of ["capstan_catalogue", "capstan_catalogue_page"]) {
    assert.match(moduleCommands, new RegExp(`"${command}" =>`), `${command} must exist`);
    assert.match(wire, new RegExp(`command: "${command}"`), `${command} must be called`);
  }
});

test("a page is read out of the sections the bridge writes, not a flat list", () => {
  const page = wire.slice(wire.indexOf("export async function bridgeCataloguePage"));
  assert.match(page, /list<unknown>\(raw, "sections"\)/, "sections carry the named lists");
  assert.match(page, /list<BridgeSearchItem>\(section, "items"\)/, "items live inside a section");
  assert.match(page, /hasNext === true/, "the last page must be recognised");
});

test("a plugin's own catalogs go through the browse surface every addon catalog uses", () => {
  assert.match(
    browse,
    /const out: BrowseCatalog\[\] = extensionCatalogs\(opts\.pluginRows\);/,
    "listBrowseCatalogs must include the plugin rows",
  );
  const fetcher = browse.slice(browse.indexOf("export function browseFetcher"));
  const branch = fetcher.indexOf("isExtensionCatalogueBase(cat.base)");
  const addon = fetcher.indexOf("createAddonCatalogFetcher(cursor");
  assert.ok(branch >= 0, "browseFetcher must recognise a plugin catalog");
  assert.ok(addon > branch, "the plugin branch is taken before the addon fetcher is built");
});
