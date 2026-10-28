import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("a premature EOF reload resumes at the position where the stream died", () => {
  const source = readFileSync(
    new URL("../src/views/player/hooks/use-auto-retry.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("stream ended prematurely at");
  const end = source.indexOf("if (!resumedAfterTruncatedRef.current) return;");
  assert.ok(start > -1 && end > start, "premature EOF reload block is present");

  const block = source.slice(start, end);
  // A same-URL reload is a recovery, not a new play. Without the position the
  // fresh session starts at zero and the viewer loses their place.
  assert.match(block, /startAtSec: pos > 1 \? pos : undefined/);
});
