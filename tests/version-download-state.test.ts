// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { versionDownloadSession } from "../src/lib/updater/version-download-state.ts";

test("version downloads retain progress and completion while the page is closed", () => {
  const session = versionDownloadSession("1.0.2", "https://example.test/installer.exe", "verified");
  let notifications = 0;
  const unsubscribe = session.subscribe(() => {
    notifications += 1;
  });
  session.set({ phase: "downloading", progress: { received: 40, total: 100, verifying: false } });
  unsubscribe();
  session.set({ progress: { received: 65, total: 100, verifying: false } });
  assert.equal(notifications, 1);
  const reopened = versionDownloadSession(
    "1.0.2",
    "https://example.test/installer.exe",
    "verified",
  );
  assert.equal(reopened, session);
  assert.equal(reopened.snapshot().phase, "downloading");
  assert.equal(reopened.snapshot().progress.received, 65);
  session.set({ phase: "staged" });
  assert.equal(reopened.snapshot().phase, "staged");
  assert.equal(
    versionDownloadSession("1.0.3", "https://example.test/other.exe", "verified").snapshot().phase,
    "checking",
  );
});
