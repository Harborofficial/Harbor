import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { Settings } from "../src/lib/settings";

const BASE = {
  subAssOverride: "force",
  subFontFamily: "sans",
  subFontSize: 32,
  subFontColor: "#FFFFFF",
  subBorderColor: "#000000",
  subBorderSize: 2,
  subMarginY: 4,
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

type OsdBox = { h: number; mt: number; mb: number };

function loadSubStyle() {
  const source = readFileSync(new URL("../src/lib/player/sub-style.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls: Array<[string, number]> = [];
  const module = {
    exports: {} as {
      subPosLiftPercent: (cover: number, osd: OsdBox | null, useMargins: boolean) => number;
      subStyleProperties: (
        s: Settings,
        context: Record<string, unknown>,
      ) => Array<[string, string | number]>;
      applySubPos: (s: Settings, context: Record<string, unknown>) => Promise<void>;
      applySubStyle: (s: Settings, context: Record<string, unknown>) => Promise<void>;
      applySecondarySubPos: (placement: string, marginY: number, liftPct: number) => Promise<void>;
    },
  };
  new Function("require", "module", "exports", compiled)(
    (id: string) => {
      if (id === "./mpv-tuning") return { mpvExtraOptionKeys: () => new Set<string>() };
      if (id !== "@tauri-apps/api/core") throw new Error(`Unexpected dependency: ${id}`);
      return {
        invoke: async (command: string, args: { name: string; value: number }) => {
          if (command === "mpv_set_property") calls.push([args.name, args.value]);
        },
      };
    },
    module,
    module.exports,
  );
  return { ...module.exports, calls };
}

const CONTEXT = { assNativeActive: false, imageNativeActive: false };
const settings = (extra: Record<string, unknown> = {}) =>
  ({ ...BASE, ...extra }) as unknown as Settings;
const subPos = (props: Array<[string, string | number]>) =>
  Number(props.find(([name]) => name === "sub-pos")?.[1]);
/** Where mpv puts a subtitle's lower edge: sub-margin-y below the sub-pos line. */
const lowerEdge = (pos: number, marginY: number) =>
  marginY / 720 + (1 - marginY / 720) * ((100 - pos) / 100);

test("no lift while the controls are hidden", () => {
  const { subPosLiftPercent } = loadSubStyle();
  assert.equal(subPosLiftPercent(0, { h: 1080, mt: 0, mb: 0 }, false), 0);
});

test("the lift clears the controls plus a small gap", () => {
  const { subPosLiftPercent } = loadSubStyle();
  assert.equal(subPosLiftPercent(0.2, { h: 1000, mt: 0, mb: 0 }, false), 21);
  assert.equal(subPosLiftPercent(0.2, null, false), 21);
});

test("letterbox bars under the controls reduce the lift", () => {
  const { subPosLiftPercent } = loadSubStyle();
  // 140px bars top and bottom leave a 720px video; controls cover 200px of the window.
  assert.equal(subPosLiftPercent(0.2, { h: 1000, mt: 140, mb: 140 }, false), (60 / 720) * 100 + 1);
  // Controls that fit inside the bottom bar need no lift at all.
  assert.equal(subPosLiftPercent(0.1, { h: 1000, mt: 140, mb: 140 }, false), 0);
});

test("with margins on the whole window counts as the subtitle area", () => {
  const { subPosLiftPercent } = loadSubStyle();
  assert.equal(subPosLiftPercent(0.2, { h: 1000, mt: 140, mb: 140 }, true), 21);
});

test("sub-pos is unchanged without a lift", () => {
  const { subStyleProperties } = loadSubStyle();
  assert.equal(subPos(subStyleProperties(settings(), CONTEXT)), 96);
  assert.equal(subPos(subStyleProperties(settings(), { ...CONTEXT, liftPct: 0 })), 96);
});

test("a lift puts the subtitle's lower edge exactly at the clearance", () => {
  const { subStyleProperties } = loadSubStyle();
  const pos = subPos(subStyleProperties(settings(), { ...CONTEXT, liftPct: 20 }));
  assert.ok(pos < 96);
  assert.ok(Math.abs(lowerEdge(pos, 4) - 0.2) < 1e-9);
});

test("subtitles already placed higher than the lift stay put", () => {
  const { subStyleProperties } = loadSubStyle();
  assert.equal(
    subPos(subStyleProperties(settings({ subMarginY: 40 }), { ...CONTEXT, liftPct: 20 })),
    60,
  );
});

test("the subtitle margin counts toward clearing the controls", () => {
  const { subStyleProperties } = loadSubStyle();
  // sub-pos 88 with a 12 margin already sits about 13.5% up, above a 13% clearance.
  assert.ok(lowerEdge(88, 12) > 0.13);
  assert.equal(
    subPos(subStyleProperties(settings({ subMarginY: 12 }), { ...CONTEXT, liftPct: 13 })),
    88,
  );
});

test("applySubPos writes only sub-pos", async () => {
  const h = loadSubStyle();
  await h.applySubPos(settings(), { ...CONTEXT, liftPct: 25 });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], "sub-pos");
  assert.ok(Math.abs(lowerEdge(h.calls[0][1], 4) - 0.25) < 1e-3);
});

test("showing and hiding the controls glides sub-pos instead of jumping", async () => {
  const h = loadSubStyle();
  await h.applySubStyle(settings(), CONTEXT);
  h.calls.length = 0;
  await h.applySubPos(settings(), { ...CONTEXT, liftPct: 25 });
  const up = h.calls.map(([, value]) => value);
  assert.ok(up.length > 3, `expected several steps, got ${up.length}`);
  assert.ok(up.every((value, i) => i === 0 || value <= up[i - 1]));
  assert.ok(Math.abs(lowerEdge(up.at(-1)!, 4) - 0.25) < 1e-3);
  h.calls.length = 0;
  await h.applySubPos(settings(), CONTEXT);
  assert.equal(h.calls.at(-1)?.[1], 96);
});

test("a full style apply stops a glide and wins", async () => {
  const h = loadSubStyle();
  await h.applySubStyle(settings(), CONTEXT);
  const gliding = h.applySubPos(settings(), { ...CONTEXT, liftPct: 25 });
  await h.applySubStyle(settings({ subMarginY: 30 }), CONTEXT);
  await gliding;
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(h.calls.filter(([name]) => name === "sub-pos").at(-1), ["sub-pos", 70]);
});

test("the second subtitle keeps its gap above the lifted primary", async () => {
  const h = loadSubStyle();
  await h.applySecondarySubPos("bottom", 4, 20);
  const lifted = h.calls.at(-1)![1];
  assert.ok(Math.abs(lowerEdge(lifted + 8, 4) - 0.2) < 1e-3);
  await h.applySecondarySubPos("bottom", 4, 0);
  assert.equal(h.calls.at(-1)![1], 88);
  await h.applySecondarySubPos("top", 4, 20);
  assert.equal(h.calls.at(-1)![1], 0);
});
