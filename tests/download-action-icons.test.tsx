import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { DownloadPauseResumeIcon } from "../src/components/download-action-icons";

const stylesheet = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const iconStyles = stylesheet.slice(
  stylesheet.indexOf(".download-pause-resume-icon {"),
  stylesheet.indexOf(".download-cancel-icon {"),
);

for (const paused of [false, true]) {
  test(`download control shows only ${paused ? "resume" : "pause"}`, () => {
    const markup = renderToStaticMarkup(<DownloadPauseResumeIcon paused={paused} size={14} />);
    const dom = new JSDOM(`<style>${iconStyles}</style>${markup}`);
    try {
      const visible = dom.window.document.querySelector(
        `[data-icon="${paused ? "resume" : "pause"}"]`,
      );
      const hidden = dom.window.document.querySelector(
        `[data-icon="${paused ? "pause" : "resume"}"]`,
      );
      assert.ok(visible);
      assert.ok(hidden);
      assert.equal(dom.window.getComputedStyle(visible).opacity, "1");
      assert.equal(dom.window.getComputedStyle(hidden).opacity, "0");
    } finally {
      dom.window.close();
    }
  });
}
