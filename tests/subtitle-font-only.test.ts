import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { Settings } from "../src/lib/settings";

const BASE = {
  subAssOverride: "no",
  subFontFamily: "serif",
  subFontSize: 32,
  subFontColor: "#FFFFFF",
  subBorderColor: "#000000",
  subBorderSize: 0,
  subMarginY: 10,
  subAlignX: "center",
  subStyle: "shadow",
  subOpacity: 1,
  subBoxOpacity: 0.6,
  subBoxColor: "#000000",
  subLineSpacing: 0,
  subBold: false,
  subHideSdh: false,
  customFonts: [],
};

/**
 * Reads a list option the way mpv does when it gets text: items split at commas, and a
 * backslash right before a comma keeps that comma inside the item. mpv keeps "" as one empty item.
 */
function mpvParseList(text: string): string[] {
  const items: string[] = [];
  let item = "";
  for (const ch of text) {
    if (ch === "," && item.endsWith("\\")) {
      item = `${item.slice(0, -1)},`;
    } else if (ch === ",") {
      items.push(item);
      item = "";
    } else {
      item += ch;
    }
  }
  items.push(item);
  return items;
}

/**
 * Loads a fresh copy of sub-style.ts against a fake mpv that starts with `overrides` as its
 * sub-ass-style-overrides list, and records the mpv properties each apply sets.
 */
function styleHarness(overrides: string[] = []) {
  const source = readFileSync(new URL("../src/lib/player/sub-style.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let calls: Array<[string, unknown]> = [];
  let list = [...overrides];
  let reads = 0;
  type Mode = Settings["subAssOverride"];
  const module = {
    exports: {} as {
      applySubStyle: (s: Settings, context: Record<string, unknown>) => Promise<void>;
      isAssLookMode: (mode: Mode) => boolean;
      flipAssOverride: (mode: Mode, before: Mode) => { mode: Mode; before: Mode };
    },
  };
  new Function("require", "module", "exports", compiled)(
    (id: string) => {
      if (id !== "@tauri-apps/api/core") throw new Error(`Unexpected dependency: ${id}`);
      return {
        invoke: async (command: string, args: { name: string; value: unknown }) => {
          if (command === "mpv_set_property") {
            calls.push([args.name, args.value]);
            if (args.name === "sub-ass-style-overrides") list = mpvParseList(String(args.value));
          }
          if (command === "mpv_get_property_list" && args.name === "sub-ass-style-overrides") {
            reads += 1;
            return [...list];
          }
        },
      };
    },
    module,
    module.exports,
  );
  return {
    exports: module.exports,
    /** mpv's sub-ass-style-overrides items right now. */
    list: () => list,
    reads: () => reads,
    /** A new mpv starts with these overrides from the user's own options. */
    restartMpv(items: string[]) {
      list = [...items];
    },
    async apply(settings: Record<string, unknown>) {
      calls = [];
      await module.exports.applySubStyle({ ...BASE, ...settings } as unknown as Settings, {
        assNativeActive: true,
        imageNativeActive: false,
      });
      return new Map(calls);
    },
  };
}

test("Change font only keeps the ASS look and swaps in the user's font", async () => {
  const h = styleHarness();
  const props = await h.apply({ subAssOverride: "font" });
  assert.equal(props.get("sub-ass-override"), "yes");
  assert.deepEqual(h.list(), ["FontName=Times New Roman"]);
  assert.equal(props.get("sub-ass-force-margins"), "no");
  assert.equal(props.get("sub-pos"), 100);
});

test("Change font only adds the font to the overrides mpv already has", async () => {
  const h = styleHarness(["ScaledBorderAndShadow=yes"]);
  await h.apply({ subAssOverride: "font" });
  assert.deepEqual(h.list(), ["ScaledBorderAndShadow=yes", "FontName=Times New Roman"]);
});

test("leaving Change font only puts mpv's own overrides back exactly", async () => {
  const own = ["Default.FontName=Comic, Neue", "Default.Bold=1"];
  const h = styleHarness(own);
  await h.apply({ subAssOverride: "font" });
  const props = await h.apply({ subAssOverride: "force" });
  assert.equal(props.get("sub-ass-override"), "force");
  assert.deepEqual(h.list(), own);
});

test("leaving Change font only removes Harbor's font when mpv had no overrides", async () => {
  const h = styleHarness();
  await h.apply({ subAssOverride: "font" });
  await h.apply({ subAssOverride: "no" });
  assert.deepEqual(h.list().filter(Boolean), []);
});

test("other modes never read or change mpv's style overrides", async () => {
  const h = styleHarness(["ScaledBorderAndShadow=yes"]);
  for (const mode of ["no", "scale", "force"]) {
    const props = await h.apply({ subAssOverride: mode });
    assert.equal(props.has("sub-ass-style-overrides"), false, mode);
  }
  assert.equal(h.reads(), 0);
  assert.deepEqual(h.list(), ["ScaledBorderAndShadow=yes"]);
});

test("a comma in a custom font name stays inside the font name", async () => {
  const h = styleHarness();
  await h.apply({
    subAssOverride: "font",
    subFontFamily: "custom:mine",
    customFonts: [{ id: "mine", name: "Mine", family: "Comic, Neue" }],
  });
  assert.deepEqual(h.list(), ["FontName=Comic, Neue"]);
});

test("a new font while Change font only is on replaces Harbor's font, not mpv's list", async () => {
  const h = styleHarness(["ScaledBorderAndShadow=yes"]);
  await h.apply({ subAssOverride: "font" });
  await h.apply({
    subAssOverride: "font",
    subFontFamily: "custom:mine",
    customFonts: [{ id: "mine", name: "Mine", family: "Mine Sans" }],
  });
  assert.deepEqual(h.list(), ["ScaledBorderAndShadow=yes", "FontName=Mine Sans"]);
});

test("a new mpv keeps its own overrides while Change font only stays on", async () => {
  const h = styleHarness(["Old=1"]);
  await h.apply({ subAssOverride: "font" });
  h.restartMpv(["New=1"]);
  await h.apply({ subAssOverride: "font" });
  assert.deepEqual(h.list(), ["New=1", "FontName=Times New Roman"]);
  await h.apply({ subAssOverride: "no" });
  assert.deepEqual(h.list(), ["New=1"]);
});

test("leaving after mpv restarted leaves the new mpv's overrides alone", async () => {
  const h = styleHarness(["Old=1"]);
  await h.apply({ subAssOverride: "font" });
  h.restartMpv(["New=1"]);
  const props = await h.apply({ subAssOverride: "no" });
  assert.equal(props.has("sub-ass-style-overrides"), false);
  assert.deepEqual(h.list(), ["New=1"]);
});

test("switching on and straight back off ends with mpv's own overrides", async () => {
  const h = styleHarness(["ScaledBorderAndShadow=yes"]);
  await Promise.all([h.apply({ subAssOverride: "font" }), h.apply({ subAssOverride: "no" })]);
  assert.deepEqual(h.list(), ["ScaledBorderAndShadow=yes"]);
});

test("the player's override switch goes back to the mode from before", () => {
  const { isAssLookMode, flipAssOverride } = styleHarness().exports;
  // "Change font only" keeps each subtitle's look, so the switch shows off.
  assert.equal(isAssLookMode("font"), true);
  assert.equal(isAssLookMode("force"), false);
  const on = flipAssOverride("font", "no");
  assert.deepEqual(on, { mode: "force", before: "font" });
  assert.deepEqual(flipAssOverride(on.mode, on.before), { mode: "font", before: "font" });
  assert.deepEqual(flipAssOverride("scale", "no"), { mode: "force", before: "scale" });
  assert.deepEqual(flipAssOverride("yes", "no"), { mode: "no", before: "no" });
});

test("the player's override switch uses these mode rules", () => {
  const menu = readFileSync(
    new URL("../src/components/player/sub-style-bar/advanced-menu.tsx", import.meta.url),
    "utf8",
  );
  assert.match(menu, /const overrideOn = !isAssLookMode\(settings\.subAssOverride\);/);
  assert.match(menu, /flipAssOverride\(settings\.subAssOverride, assModeBeforeOverride\)/);
  assert.match(menu, /assModeBeforeOverride = next\.before;/);
});
