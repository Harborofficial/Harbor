import assert from "node:assert/strict";
import test from "node:test";
import { PdfDocumentError, pdfError } from "../src/lib/ebook/pdf.ts";

test("password-protected PDFs get a clear password message", () => {
  const error = pdfError(
    Object.assign(new Error("No password given"), { name: "PasswordException" }),
  );
  assert.equal(error.kind, "password");
  assert.match(error.message, /password-protected/i);
});

test("damaged PDFs are distinguished from unreadable files", () => {
  const corrupt = pdfError(
    Object.assign(new Error("Invalid PDF structure"), { name: "InvalidPDFException" }),
  );
  assert.equal(corrupt.kind, "corrupt");
  assert.match(corrupt.message, /damaged/i);

  const inaccessible = pdfError(new Error("No such file or directory (os error 2)"));
  assert.equal(inaccessible.kind, "inaccessible");
  assert.match(inaccessible.message, /could not be read/i);
});

test("cancellation is reported without a password or corruption diagnosis", () => {
  const controller = new AbortController();
  controller.abort();
  const error = pdfError(new Error("anything"), controller.signal);
  assert.equal(error.kind, "cancelled");
  assert.match(error.message, /cancelled/i);

  const aborted = pdfError(Object.assign(new Error("aborted"), { name: "AbortError" }));
  assert.equal(aborted.kind, "cancelled");
});

test("an existing PDF error keeps its message and kind", () => {
  const original = new PdfDocumentError("This PDF is password-protected.", "password");
  assert.equal(pdfError(original), original);
});
