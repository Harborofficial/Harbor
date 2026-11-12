// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import ts from "typescript";

type Font = {
  id: string;
  name: string;
  format: string;
  family?: string;
  dataUrl?: string;
};

type FontInstall = {
  libassFontExt: (format: string) => string | null;
  installCustomFont: (font: Font, dataUrl: string) => Promise<boolean>;
  listInstalledSubFonts: () => Promise<string[] | null>;
  removeCustomFont: (id: string) => Promise<boolean>;
  syncSubFontsToDisk: (fonts: Font[]) => Promise<Set<string>>;
};

type Harness = {
  exports: FontInstall;
  files: () => string[];
  calls: Array<{ command: string; args?: Record<string, unknown> }>;
  failList: (fail: boolean) => void;
  holdInstalls: () => () => void;
};

function fontHarness(initial: string[] = [], blobs: Record<string, string | null> = {}): Harness {
  const source = readFileSync(
    new URL("../src/lib/player/sub-font-install.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

  (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };

  const files = new Set(initial);
  const calls: Harness["calls"] = [];
  let listFails = false;
  let gate: Promise<void> | null = null;

  const invoke = async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    if (command === "list_sub_fonts") {
      if (listFails) throw new Error("list failed");
      return [...files];
    }
    if (command === "install_sub_font") {
      if (gate) await gate;
      files.add(String(args?.id));
      return;
    }
    if (command === "remove_sub_font") {
      files.delete(String(args?.id));
      return;
    }
    throw new Error(`unexpected command ${command}`);
  };

  const module = { exports: {} as Partial<FontInstall> };
  new Function("require", "module", "exports", compiled)(
    (id: string) => {
      if (id === "@/lib/font-storage") {
        return { loadFontData: async (fontId: string) => blobs[fontId] ?? null };
      }
      if (id === "@tauri-apps/api/core") return { invoke };
      throw new Error(`Unexpected dependency: ${id}`);
    },
    module,
    module.exports,
  );

  return {
    exports: module.exports as FontInstall,
    files: () => [...files].sort(),
    calls,
    failList: (fail) => {
      listFails = fail;
    },
    holdInstalls: () => {
      let release = () => {};
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        gate = null;
        release();
      };
    },
  };
}

const DATA_URL = "data:font/ttf;base64,AAEAAA==";

function ttf(id: string): Font {
  return { id, name: id, format: "truetype", family: id, dataUrl: DATA_URL };
}

test("sync installs missing fonts and leaves other installed files alone", async () => {
  const h = fontHarness(["stale", "kept"], { kept: DATA_URL });
  const installed = await h.exports.syncSubFontsToDisk([
    { id: "kept", name: "Kept", format: "truetype" },
    ttf("new"),
  ]);
  assert.deepEqual(h.files(), ["kept", "new", "stale"]);
  assert.deepEqual([...installed].sort(), ["kept", "new", "stale"]);
  assert.equal(h.calls.filter((call) => call.command === "install_sub_font").length, 1);
  assert.equal(
    h.calls.some((call) => call.command === "remove_sub_font"),
    false,
  );
});

test("a failed listing still installs every font and removes nothing", async () => {
  const h = fontHarness(["existing"], { existing: DATA_URL });
  h.failList(true);

  const installed = await h.exports.syncSubFontsToDisk([ttf("new")]);
  assert.equal(
    h.calls.some((call) => call.command === "remove_sub_font"),
    false,
  );
  assert.deepEqual([...installed], ["new"]);
});

test("a font whose browser blob is gone stays usable when its file is installed", async () => {
  const h = fontHarness(["installedy"], {});

  const installed = await h.exports.syncSubFontsToDisk([
    { id: "installedy", name: "Installed", format: "truetype" },
  ]);
  assert.deepEqual([...installed], ["installedy"]);
  assert.equal(
    h.calls.some((call) => call.command === "install_sub_font"),
    false,
  );
});

test("a font with no blob and no installed file cannot reach styled subtitles", async () => {
  const h = fontHarness([], {});

  const installed = await h.exports.syncSubFontsToDisk([
    { id: "missing", name: "Missing", format: "truetype" },
  ]);
  assert.deepEqual([...installed], []);
  assert.equal(h.files().length, 0);
});

test("sync calls are serialized so the same font is installed once", async () => {
  const h = fontHarness([], { a: DATA_URL });
  const release = h.holdInstalls();

  const first = h.exports.syncSubFontsToDisk([ttf("a")]);
  const second = h.exports.syncSubFontsToDisk([ttf("a")]);

  await new Promise((resolve) => setTimeout(resolve, 5));
  release();
  await Promise.all([first, second]);

  assert.deepEqual(h.files(), ["a"]);
  assert.equal(h.calls.filter((call) => call.command === "install_sub_font").length, 1);
  assert.deepEqual(
    h.calls.map((call) => call.command),
    ["list_sub_fonts", "install_sub_font", "list_sub_fonts"],
  );
});

test("removing a font deletes only its own file", async () => {
  const h = fontHarness(["a", "b"], {});
  assert.equal(await h.exports.removeCustomFont("a"), true);
  assert.deepEqual(h.files(), ["b"]);
});

test("WOFF fonts are kept away from libass instead of being silently skipped", async () => {
  const h = fontHarness([], {});

  assert.equal(h.exports.libassFontExt("woff"), null);
  assert.equal(h.exports.libassFontExt("woff2"), null);
  assert.equal(h.exports.libassFontExt("truetype"), "ttf");
  assert.equal(h.exports.libassFontExt("opentype"), "otf");

  assert.equal(
    await h.exports.installCustomFont(
      { id: "woff", name: "Woff", format: "woff" },
      "data:font/woff;base64,AAAA",
    ),
    false,
  );
  assert.equal(h.files().length, 0);
});

test("an imported font is written immediately and can be listed", async () => {
  const h = fontHarness([], {});
  assert.equal(
    await h.exports.installCustomFont(
      { id: "fresh", name: "Fresh", format: "opentype" },
      "data:font/otf;base64,T1RUTw==",
    ),
    true,
  );
  assert.deepEqual(h.files(), ["fresh"]);
  assert.deepEqual(await h.exports.listInstalledSubFonts(), ["fresh"]);
});

test("the settings page installs fonts outside the cancellable preview effect", () => {
  const settings = readFileSync(new URL("../src/lib/settings.tsx", import.meta.url), "utf8");
  assert.match(settings, /syncSubFontsToDisk\(settings\.customFonts \?\? \[\]\)/);
  const picker = readFileSync(
    new URL("../src/views/settings/player-panel/subtitle-section.tsx", import.meta.url),
    "utf8",
  );
  assert.match(picker, /await installCustomFont\(font, dataUrl\)/);
  assert.match(picker, /selectedStyledUnavailable/);
});
