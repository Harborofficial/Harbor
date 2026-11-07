// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
import { autoSyncUiWatchdogMs } from "../src/views/player/hooks/use-auto-sync.helpers.ts";

const hook = readFileSync(
  new URL("../src/views/player/hooks/use-auto-sync.ts", import.meta.url),
  "utf8",
);

test("analyzing UI gets an independent, short watchdog", () => {
  assert.equal(autoSyncUiWatchdogMs("analyzing", 55_000), 65_000);
  assert.equal(autoSyncUiWatchdogMs("analyzing", 90_000), 100_000);
  assert.equal(autoSyncUiWatchdogMs("listening", 55_000), 120_000);
  assert.equal(autoSyncUiWatchdogMs("analyzing", 0), 60_000);
  assert.equal(autoSyncUiWatchdogMs("analyzing", 500_000), 115_000);
});

test("decoded playback comparison has a separate deadline before Whisper fallback", () => {
  const start = hook.indexOf('setReason("Comparing buffered speech with subtitle timing")');
  const end = hook.indexOf("const asrSessionId = newAnalysisSessionId()", start);
  const comparison = hook.slice(start, end);
  assert.match(comparison, /setAnalysisRevision/);
  assert.match(comparison, /boundedNativeProbe/);
  assert.match(comparison, /sessionId: comparisonSessionId/);
  assert.match(comparison, /cancelNativeAnalysis\(comparisonSessionId\),\s*30_000/);
  assert.match(
    hook,
    /Buffered audio was decoded, but comparing it with subtitle timing took too long/,
  );
});

test("visible analysis watchdog is not cleared by the native deadline controller", () => {
  assert.match(hook, /UI safety watchdog, independent of the analysis promise's clearDeadline/);
  assert.match(hook, /if \(status !== "analyzing" && status !== "listening"\) return;/);
  assert.match(hook, /autoSyncUiWatchdogMs\(phase, activeAnalysisDeadlineRef\.current\)/);
  assert.match(hook, /const watchdog = window\.setTimeout\(/);
  assert.match(hook, /return \(\) => window\.clearTimeout\(watchdog\)/);
  assert.match(hook, /setStatus\("error"\);\s*\}, limitMs\)/);
  assert.match(hook, /failure=\$\{code\}/);
});

test("orphaned cancellation resolves the analyzing status instead of just clearing its timer", () => {
  assert.match(
    hook,
    /statusScopeRef\.current === statusScope && statusRef\.current === "analyzing"/,
  );
  assert.match(
    hook,
    /statusRef\.current === "analyzing"\) \{[\s\S]*?setReason\(null\);\s*setStatus\("idle"\);/,
  );
  assert.match(hook, /cancelNativeAnalysis\(nativeSessionId\)/);
});

test("retries restart the watchdog even if the visible phase name stays the same", () => {
  assert.match(hook, /const \[analysisRevision, setAnalysisRevision\] = useState\(0\)/);
  assert.match(hook, /setAnalysisRevision\(\(revision\) => revision \+ 1\)/);
  assert.match(
    hook,
    /\[status, analysisRevision, mediaKey, clearDeadline, isCurrentAutoSyncScope\]/,
  );
});

test("transitioning from embedded subtitle extraction to audio analysis restarts the UI watchdog", () => {
  const start = hook.indexOf('armDeadline("embedded")');
  const embeddedRead = hook.indexOf("await readEmbeddedReference(");
  const audioStart = hook.indexOf('armDeadline("audio")');
  const watchdogReset = hook.indexOf("setAnalysisRevision((revision) => revision + 1)", audioStart);
  const audioAnalysis = hook.indexOf("const ctx = {", audioStart);
  assert.ok(start > 0 && start < embeddedRead && embeddedRead < audioStart);
  assert.ok(audioStart < watchdogReset && watchdogReset < audioAnalysis);
  // A stale or cancelled scope must not start either timer again.
  assert.match(
    hook.slice(embeddedRead, audioStart),
    /if \(cancelled\.current \|\| !isCurrentAutoSyncScope\(statusScope\)\) return;/,
  );
  assert.match(
    hook,
    /\[status, analysisRevision, mediaKey, clearDeadline, isCurrentAutoSyncScope\]/,
  );
});

test("an embedded deadline abandons the old session before handing off to buffered audio", () => {
  const deadline = hook.slice(
    hook.indexOf("const armDeadline"),
    hook.indexOf('armDeadline("prepare")'),
  );
  const guard = deadline.indexOf(
    "if (cancelled.current || !isCurrentAutoSyncScope(statusScope)) return;",
  );
  const cancel = deadline.indexOf("cancelNativeAnalysis(nativeSessionId)");
  const fallback = deadline.indexOf("playbackFallbackRef.current(true)");
  assert.ok(guard >= 0 && guard < cancel && cancel < fallback);
  assert.match(deadline, /phase === "embedded" \? EMBEDDED_REFERENCE_DEADLINE_MS : budget/);
  const budget = Number(
    /EMBEDDED_REFERENCE_DEADLINE_MS = ([\d_]+)/.exec(hook)?.[1].replaceAll("_", ""),
  );
  assert.ok(budget > 18_000 + 30_000, "allow the index and concurrent excerpt reads to finish");
  assert.ok(
    budget < autoSyncUiWatchdogMs("analyzing", 0),
    "UI watchdog must not preempt extraction",
  );
  assert.match(
    deadline,
    /if \(phase === "embedded" && playbackFallbackRef.current\) \{\s*playbackFallbackRef.current\(true\);\s*return;/,
  );
});
