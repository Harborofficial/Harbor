import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

test("a long anime catalog builds only the visible page and retains episode jumps and sorting", () => {
  let page = 0;
  const settings = { episodeSort: "oldest" };
  const element = (type, props) => ({ type, props });
  const dependencies = {
    react: {
      useMemo: (fn) => fn(),
      useEffect() {},
      useRef: () => ({ current: null }),
      useState: () => [
        page,
        (value) => {
          page = value;
        },
      ],
    },
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "@/lib/settings": { useSettings: () => ({ settings }) },
    "./episode-grid-card": { EpisodeGridCard() {} },
    "./episode-pager": { EpisodePager() {} },
  };
  const source = ts.transpileModule(
    readFileSync(new URL("../src/views/detail/episode-grid.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in dependencies, name);
      return dependencies[name];
    },
    requestAnimationFrame: (fn) => fn(),
  });
  const episodes = Array.from({ length: 1400 }, (_, i) => ({ id: i + 1, number: i + 1 }));
  const built = [];
  const render = () => {
    built.length = 0;
    const tree = module.exports.EpisodeGrid({
      meta: {},
      episodes,
      itemKey: (ep) => String(ep.id),
      present: (ep) => {
        built.push(ep.number);
        return { ...ep, key: String(ep.id) };
      },
      progressFor: () => ({}),
    });
    return tree.props.children[1].props;
  };
  const pager = render();
  assert.equal(built.length, 50);
  assert.equal(built[0], 1);
  assert.equal(pager.total, 1400);
  pager.onGoToEpisode(1156);
  render();
  assert.equal(built.length, 50);
  assert.equal(built[0], 1151);
  page = 0;
  settings.episodeSort = "newest";
  render();
  assert.equal(built.length, 50);
  assert.equal(built[0], 1400);
});
