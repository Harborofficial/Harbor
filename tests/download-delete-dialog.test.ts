import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { DownloadDeleteButton } from "../src/components/download-delete-button.tsx";
import { downloadConfirmation } from "../src/lib/download/confirmation.ts";

test("download deletion opens outside the row, protects the popover, and retains failed confirmations", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
  });
  dom.window.matchMedia = (() => ({ matches: true })) as typeof dom.window.matchMedia;
  const { createRoot } = await import("react-dom/client");
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  let runs = 0;
  let path = "C:/downloads/Episode.mkv";
  let fail = true;
  let outsideClicks = 0;
  document.addEventListener("mousedown", () => outsideClicks++);
  const source = {
    actions: () => [
      {
        id: "delete",
        label: "Delete file",
        confirmation: downloadConfirmation(
          [{ id: "one", title: "Episode", path }],
          "delete",
          "Episode",
          "actor",
        ),
        run: async () => {
          runs++;
          if (fail) throw new Error("File locked");
        },
      },
    ],
  };
  const click = async (element: Element) =>
    act(async () => {
      element.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
      element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
  const dialogButton = () => document.querySelectorAll("[role='dialog'] button")[1];
  try {
    await act(() =>
      root.render(
        createElement(DownloadDeleteButton, { source, actionId: "delete", children: "Delete" }),
      ),
    );
    await click(container.querySelector("button")!);
    const dialog = document.querySelector("[role='dialog']")!;
    assert.ok(dialog);
    assert.equal(container.contains(dialog), false, "confirmation cannot expand or clip the row");
    assert.equal(document.activeElement?.textContent, "Cancel");
    assert.equal(runs, 0);
    await click(dialogButton());
    assert.equal(outsideClicks, 0, "modal interaction must not dismiss the downloads popover");
    assert.equal(runs, 1);
    assert.equal(document.querySelector("[role='alert']")?.textContent, "File locked");
    path = "C:/downloads/Replacement.mkv";
    await click(dialogButton());
    assert.equal(runs, 1, "changed file scope must not be deleted");
    assert.match(document.querySelector("[role='alert']")!.textContent!, /changed/);
    path = "C:/downloads/Episode.mkv";
    fail = false;
    await click(dialogButton());
    assert.equal(runs, 2, "retry executes after explicit confirmation");
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    assert.equal(document.querySelector("[role='dialog']"), null);
  } finally {
    await act(() => root.unmount());
    dom.window.close();
  }
});
