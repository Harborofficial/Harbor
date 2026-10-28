import assert from "node:assert/strict";
import test from "node:test";
import { episodeReleaseCountdown } from "../src/lib/episode-release-countdown.ts";

test("counts exact releases in days, hours and rounded-up minutes", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  assert.deepEqual(episodeReleaseCountdown("2026-10-22T16:23:01Z", now), {
    kind: "time",
    days: 1,
    hours: 4,
    minutes: 24,
  });
  assert.deepEqual(episodeReleaseCountdown("2026-10-21T15:30:00+02:00", now), {
    kind: "time",
    days: 0,
    hours: 1,
    minutes: 30,
  });
  assert.deepEqual(episodeReleaseCountdown("2026-10-21T12:00:01Z", now), {
    kind: "time",
    days: 0,
    hours: 0,
    minutes: 1,
  });
  assert.equal(episodeReleaseCountdown("2026-10-21T12:00:00Z", now), null);
});

test("date-only and midnight placeholders use calendar days, not fabricated hours", () => {
  const now = new Date(2026, 9, 21, 23, 59).getTime();
  for (const date of ["2026-10-22", "2026-10-22T00:00:00.000Z", "2026-10-22T19:00:00"]) {
    assert.deepEqual(episodeReleaseCountdown(date, now), { kind: "days", days: 1 });
  }
  assert.equal(episodeReleaseCountdown("2026-10-21", now), null);
  assert.equal(episodeReleaseCountdown("2026-10-20", now), null);
});

test("ignores missing and invalid release dates", () => {
  for (const date of [
    null,
    undefined,
    "",
    "unknown",
    "2026-02-30",
    "2026-13-01",
    "2026-10-22Tbad",
  ]) {
    assert.equal(episodeReleaseCountdown(date), null);
  }
});
