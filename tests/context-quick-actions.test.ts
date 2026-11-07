import assert from "node:assert/strict";
import test from "node:test";
import {
  contextNavigationFooter,
  partitionContextActions,
} from "../src/lib/context-quick-actions.ts";

const back = { id: "page:back", label: "Back", disabled: true };
const settings = { id: "page:go:settings", label: "Settings", run: () => {} };
const nav = [
  back,
  { id: "page:go-to", label: "Go to", children: [settings, { id: "page:go:home", label: "Home" }] },
  { id: "page:my-profile", label: "Open my profile" },
  { id: "page:refresh", label: "Refresh" },
];
const background = {
  kind: "actions",
  id: "page:home",
  label: "Page actions",
  scope: "page-background",
  actions: () => nav,
};
const partition = partitionContextActions as (
  ...args: any[]
) => ReturnType<typeof partitionContextActions>;

test("only explicit unoccupied background gets Back and Settings; copy stays a row", () => {
  const copy = { id: "collection:copy", label: "Copy share link" };
  for (const target of [
    undefined,
    { kind: "actions" },
    { kind: "meta", player: true },
    { ...background, image: { src: "fixture.png" } },
    { ...background, link: "https://fixture.invalid" },
    { ...background, selection: "Selected" },
    { ...background, navigation: false },
  ]) {
    const result = partition([copy], [], nav, target);
    assert.deepEqual(result.quick, [], JSON.stringify(target));
    assert.deepEqual(result.entity, [copy], "copying is retained as a normal command");
  }
  assert.deepEqual(partition(nav, [], nav, background).quick, [back, settings]);
});

test("background navigation order is stable and Settings is removed from Go to", () => {
  const result = partition(nav, [], nav, background);
  const footer = contextNavigationFooter(nav, result.quick);
  assert.deepEqual(
    footer.map((a) => a.id),
    ["page:my-profile", "page:go-to", "page:refresh"],
  );
  assert.deepEqual(
    footer[1].children?.map((a) => a.id),
    ["page:go:home"],
  );
  assert.deepEqual(result.entity, [], "background does not duplicate its own navigation rows");
});

test("empty items never inherit global navigation and selected text remains a row", () => {
  const selected = { id: "selection:copy", label: "Copy selected text" };
  const result = partition([], [selected], nav, { kind: "content", selection: "fixture" });
  assert.deepEqual(result.quick, []);
  assert.deepEqual(result.content, [selected]);
  assert.deepEqual(partition([], [], nav, { kind: "actions" }), {
    quick: [],
    entity: [],
    content: [],
  });
});

test("extracting background Settings preserves its inherited disabled/PIN capability", () => {
  const result = partition(
    [],
    [],
    [
      {
        id: "page:go-to",
        label: "Go to",
        disabled: true,
        reason: "PIN required",
        children: [settings],
      },
    ],
    background,
  );
  assert.equal(result.quick[0].disabled, true);
  assert.equal(result.quick[0].reason, "PIN required");
});
