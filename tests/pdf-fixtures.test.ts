import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDF_RENDER_LIMITS, pageRenderSize } from "../src/lib/ebook/pdf-render.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/pdf/${name}`, import.meta.url)));

async function open(name: string, password?: string) {
  const task = getDocument({
    data: fixture(name),
    password,
    disableWorker: true,
    isEvalSupported: false,
    verbosity: 0,
  });
  return task.promise;
}

test("ordinary multi-page PDFs keep page order and text", async () => {
  const document = await open("ordinary-4page.pdf");
  try {
    assert.equal(document.numPages, 4);
    const page = await document.getPage(4);
    const text = await page.getTextContent();
    assert.match(text.items.map((item) => ("str" in item ? item.str : "")).join(" "), /page 4/i);
  } finally {
    await document.destroy();
  }
});

test("image-only scanned pages have no text layer", async () => {
  const document = await open("scan.pdf");
  try {
    const page = await document.getPage(1);
    const text = await page.getTextContent();
    assert.equal(
      text.items
        .map((item) => ("str" in item ? item.str : ""))
        .join("")
        .trim(),
      "",
    );
  } finally {
    await document.destroy();
  }
});

test("rotated, oversized pages report a viewport that the renderer can bound", async () => {
  const document = await open("rotated-oversized.pdf");
  try {
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    assert.equal(viewport.rotation, 90);
    assert.equal(viewport.width, 30_000);
    assert.equal(viewport.height, 20_000);
    const size = pageRenderSize(viewport.width, viewport.height);
    assert.ok(size.width <= PDF_RENDER_LIMITS.maxWidth);
    assert.ok(size.height <= PDF_RENDER_LIMITS.maxHeight);
    assert.ok(size.width * size.height <= PDF_RENDER_LIMITS.maxPixels);
    assert.ok(size.scale < 0.5);
  } finally {
    await document.destroy();
  }
});

test("embedded non-Latin fonts keep their extracted text", async () => {
  const document = await open("nonlatin.pdf");
  try {
    assert.equal(document.numPages, 2);
    const first = await document.getPage(1);
    const second = await document.getPage(2);
    assert.match(
      (await first.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join(" "),
      /Привет/,
    );
    assert.match(
      (await second.getTextContent()).items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" "),
      /Καλημέρα/,
    );
  } finally {
    await document.destroy();
  }
});

test("encrypted PDFs require the password before any page can be read", async () => {
  await assert.rejects(open("encrypted.pdf"), (error: Error) => /password/i.test(error.name));
  const document = await open("encrypted.pdf", "secret");
  try {
    assert.equal(document.numPages, 2);
  } finally {
    await document.destroy();
  }
});

test("corrupt bytes fail as a damaged document", async () => {
  await assert.rejects(open("corrupt.pdf"), (error: Error) =>
    /invalid|format|pdf/i.test(`${error.name} ${error.message}`),
  );
});
