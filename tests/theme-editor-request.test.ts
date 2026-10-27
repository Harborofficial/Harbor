import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeThemeEditorRequest,
  requestThemeEditor,
  subscribeThemeEditorRequest,
} from "../src/views/settings/theme-panel/theme-editor-store";

test("a theme editor request reaches mounted listeners and a later mount", () => {
  let calls = 0;
  const unsubscribe = subscribeThemeEditorRequest(() => calls++);
  requestThemeEditor();
  assert.equal(calls, 1);
  assert.equal(consumeThemeEditorRequest(), true);
  assert.equal(consumeThemeEditorRequest(), false);

  unsubscribe();
  requestThemeEditor();
  assert.equal(calls, 1);
  assert.equal(consumeThemeEditorRequest(), true);
});
