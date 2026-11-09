// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const source = readFileSync(
  new URL("../src/components/ThreeLiquidGlassSurface.tsx", import.meta.url),
  "utf8",
);

test("liquid glass does not ship the Three.js runtime or types", () => {
  assert.equal(packageJson.dependencies?.three, undefined);
  assert.equal(packageJson.devDependencies?.["@types/three"], undefined);
  assert.doesNotMatch(source, /from ["']three["']/);
});

test("liquid glass does not keep a GPU render loop alive", () => {
  assert.doesNotMatch(source, /getContext\("webgl/);
  assert.doesNotMatch(source, /requestAnimationFrame/);
  assert.doesNotMatch(source, /<canvas/);
  assert.match(source, /linear-gradient/);
  assert.match(source, /backdropFilter:\s+blurEnabled \?/);
  assert.doesNotMatch(source, /WebkitBackdropFilter/);
});

test("liquid glass keeps its public compatibility props", () => {
  assert.doesNotMatch(source, /spectralStrength/);
  assert.match(source, /refractionStrength/);
  assert.match(source, /lensStrength/);
  assert.match(source, /alwaysActive/);
  assert.match(source, /surfaceClassName/);
  assert.match(source, /variant/);
  assert.match(source, /backdropBlur/);
});

test("MPV scope replaces both regular glass variants and preserves the app preference", () => {
  const settings = {
    liquidGlass: true,
    experimentalLiquidGlassEnabled: false,
    defaultLiquidGlassBlur: 8,
    defaultLiquidGlassTint: 20,
  };
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const dependencies: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": { jsx: React.createElement, jsxs: React.createElement },
    "@/lib/settings": { useSettings: () => ({ settings }) },
    "@/components/ExperimentalLiquidGlassSurface": {
      ExperimentalLiquidGlassSurface: () =>
        React.createElement("div", { "data-test-enhanced": "" }),
    },
  };
  const loaded = { exports: {} as Record<string, any> };
  new Function("require", "exports", compiled)(
    (name: string) => dependencies[name],
    loaded.exports,
  );
  const render = (enabled: boolean) =>
    renderToStaticMarkup(
      React.createElement(
        loaded.exports.NativePlayerGlassContext.Provider,
        { value: enabled },
        React.createElement(loaded.exports.ThreeLiquidGlassSurface, { radius: "20px" }, "Volume"),
      ),
    );
  for (const enhanced of [false, true]) {
    settings.experimentalLiquidGlassEnabled = enhanced;
    const scoped = render(true);
    assert.doesNotMatch(scoped, /linear-gradient|data-test-enhanced|data-liquid-glass=/);
    assert.match(scoped, /data-native-glass-surface/);
    assert.match(scoped, /Volume/);
    assert.match(render(false), enhanced ? /data-test-enhanced/ : /data-liquid-glass=/);
    assert.equal(settings.liquidGlass, true);
  }
});
