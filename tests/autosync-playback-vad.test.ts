import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { matchPlaybackVad } from "../src/lib/subtitles/autosync/playback-vad.ts";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/wailing-speech-timing.json", import.meta.url), "utf8"),
);

test("Wailing weak excerpts remain rejected while nearby buffered dialogue recovers the offset", async () => {
  const retryFixture = JSON.parse(
    readFileSync(new URL("./fixtures/wailing-playback-retry.json", import.meta.url), "utf8"),
  );
  for (const report of retryFixture.reports) {
    const result = await matchPlaybackVad(
      {
        path: "C:/temp/harbor-subs/live/tap-test.wav",
        sessionId: "retry-test",
        cues: retryFixture.cues.map(([a, b]: number[]) => [a - report.start, b - report.start]),
      },
      async <T>() => ({ durationSec: 46, intervals: report.intervals }) as T,
      () => true,
    );
    if (report.start < 270) assert.equal(result, null, "weak original excerpt stays rejected");
    else assert.ok(result && Math.abs(result.offsetSec - retryFixture.expectedOffsetSec) < 0.2);
  }
});
const input = {
  path: "C:/temp/harbor-subs/live/tap-test.wav",
  sessionId: "test-silero-session",
  cues: fixture.cues
    .filter((c: { credit: boolean }) => !c.credit)
    .map((c: { start: number; end: number }) => [c.start - 285, c.end - 285]) as Array<
    [number, number]
  >,
};
const speech = {
  durationSec: 35,
  intervals: fixture.speech
    .filter(([a, b]: number[]) => b > 285 && a < 320)
    .map(([a, b]: number[]) => [Math.max(a, 285) - 285, Math.min(b, 320) - 285]),
};

test("Silero playback uses the prepared WAV and recovers the measured reference without Whisper", async () => {
  const calls: string[] = [];
  const result = await matchPlaybackVad(
    input,
    async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push(command);
      assert.deepEqual(args, { path: input.path, sessionId: input.sessionId });
      return speech as T;
    },
    () => true,
  );
  assert.deepEqual(calls, ["subsync_playback_speech"]);
  assert.ok(result && Math.abs(result.offsetSec - fixture.expectedOffsetSec) < 0.2);
  assert.equal(result?.confidence, 0.65);
  const aligned = await matchPlaybackVad(
    { ...input, cues: input.cues.map(([a, b]) => [a + result!.offsetSec, b + result!.offsetSec]) },
    async <T>() => speech as T,
    () => true,
  );
  assert.equal(aligned?.offsetSec, 0);
});

test("unsupported builds, weak timing and cancelled playback stay distinct", async () => {
  assert.equal(
    await matchPlaybackVad(
      input,
      async <T>() => null as T,
      () => true,
    ),
    undefined,
  );
  assert.equal(
    await matchPlaybackVad(
      { ...input, cues: [[-40, 80]] },
      async <T>() => speech as T,
      () => true,
    ),
    null,
  );
  assert.equal(
    await matchPlaybackVad(
      input,
      async <T>() => ({ durationSec: 35, intervals: [] }) as T,
      () => true,
    ),
    null,
  );
  await assert.rejects(
    matchPlaybackVad(
      input,
      async <T>() => speech as T,
      () => false,
    ),
    /Sync cancelled/,
  );
});

test("out-of-range or invalid native speech cannot produce a correction", async () => {
  for (const report of [
    { durationSec: 90, intervals: [] },
    { durationSec: NaN, intervals: [] },
    { durationSec: 35, intervals: [[30, 42.84]] },
    { durationSec: 35, intervals: [[-1, 3]] },
    { durationSec: 35, intervals: [[5, 2]] },
  ])
    await assert.rejects(
      matchPlaybackVad(
        input,
        async <T>() => report as T,
        () => true,
      ),
      /speech-invalid/,
    );
});

test("a rejected retry does not change a later match on the same speech window", async () => {
  const diagnostics: Array<{ accepted: boolean }> = [];
  const run = (intervals: typeof speech.intervals) =>
    matchPlaybackVad(
      input,
      async <T>() => ({ ...speech, intervals }) as T,
      () => true,
      (value) => diagnostics.push(value),
    );
  const first = await run(speech.intervals);
  assert.ok(first);
  assert.equal(await run([]), null);
  assert.deepEqual(await run(speech.intervals), first);
  assert.deepEqual(
    diagnostics.map((value) => value.accepted),
    [true, false, true],
  );
});
