import assert from "node:assert/strict";
import test from "node:test";
import { matchesDownloadFilter } from "../src/views/downloads/downloads-visibility.ts";

const row = (status: "canceled" | "done" | "downloading" | "paused" | "error" | "interrupted") => ({ status });

test("All excludes manually canceled records without deleting the underlying download history", () => {
  const entries = [row("done"), row("canceled"), row("canceled"), row("paused"), row("downloading")];
  const visible = entries.filter((item) => matchesDownloadFilter(item, "all"));
  assert.deepEqual(visible.map((item) => item.status), ["done", "paused", "downloading"]);
  assert.equal(entries.length, 5);
});

test("Canceled filter preserves access for inspecting and deleting manually stopped transfers", () => {
  const entries = [row("canceled"), row("done"), row("canceled"), row("error")];
  assert.deepEqual(
    entries.filter((item) => matchesDownloadFilter(item, "canceled")).map((item) => item.status),
    ["canceled", "canceled"],
  );
});

test("active, saved, and issues filters retain their existing semantics", () => {
  const entries = [row("canceled"), row("paused"), row("downloading"), row("done"), row("error"), row("interrupted")];
  assert.deepEqual(entries.filter((d) => matchesDownloadFilter(d, "active")).map((d) => d.status), ["paused", "downloading"]);
  assert.deepEqual(entries.filter((d) => matchesDownloadFilter(d, "saved")).map((d) => d.status), ["done"]);
  assert.deepEqual(entries.filter((d) => matchesDownloadFilter(d, "issues")).map((d) => d.status), ["error", "interrupted"]);
});

test("default list and the header Downloads popover share the same canceled exclusion rule", () => {
  assert.equal(matchesDownloadFilter(row("canceled"), "all"), false);
  assert.equal(matchesDownloadFilter(row("done"), "all"), true);
});
