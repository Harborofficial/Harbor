import assert from "node:assert/strict";
import test from "node:test";
import { matchPlaybackSpeech } from "../src/lib/subtitles/autosync/playback-asr.ts";

const windows = [
  {
    startSec: 5,
    lenSec: 10,
    tokens: [
      [5.2, 6.4],
      [8.1, 10.7],
      [12.4, 14.2],
    ],
  },
  {
    startSec: 18.2,
    lenSec: 10,
    tokens: [
      [18.8, 21.4],
      [22.3, 23.2],
      [25.5, 28],
    ],
  },
  {
    startSec: 31.4,
    lenSec: 10,
    tokens: [
      [31.6, 32.3],
      [34.9, 36.5],
      [38.1, 40.9],
    ],
  },
].map((window) => ({
  ...window,
  tokens: window.tokens.map(([t0, t1]) => ({ t0, t1, text: "speech" })),
  stats: {
    recognizedLines: 3,
    wordCandidates: 3,
    wordIntervals: 3,
    audioPeak: 0.4,
    audioRms: 0.06,
  },
}));

const base = {
  path: "C:/temp/prepared.wav",
  durationSec: 45,
  sessionId: "test-session",
  audioLanguage: "en",
  subtitleLanguage: "de",
  modelLanguage: "auto",
  enabled: true,
  crossLanguage: true,
  cues: windows.flatMap((window) =>
    window.tokens.map((token) => [token.t0 - 2, token.t1 - 2] as [number, number]),
  ),
};

type NativeOptions = {
  installed?: boolean;
  supported?: boolean;
  runtimeInstalled?: boolean;
  output?: unknown;
};

function native(options: NativeOptions = {}) {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ command, args });
    if (command === "moonshine_model_status")
      return {
        installed: options.installed ?? true,
        supported: options.supported ?? true,
        runtimeInstalled: options.runtimeInstalled ?? true,
      } as T;
    if (command === "moonshine_transcribe_windows") return (options.output ?? windows) as T;
    throw new Error(`Unexpected command ${command}`);
  };
  return { calls, invoke };
}

test("Moonshine transcribes prepared playback audio using the selected audio language", async () => {
  for (const [audioLanguage, subtitleLanguage] of [
    ["en", "de"],
    ["de", "en"],
  ]) {
    const bridge = native();
    const progress: string[] = [];
    const result = await matchPlaybackSpeech(
      { ...base, audioLanguage, subtitleLanguage },
      bridge.invoke,
      (message) => progress.push(message),
      () => true,
    );
    assert.ok(Math.abs(result.offsetSec - 2) < 0.15);
    const call = bridge.calls.find((call) => call.command === "moonshine_transcribe_windows");
    assert.equal(call?.args?.url, base.path);
    assert.equal(call?.args?.subLang, audioLanguage);
    assert.equal(call?.args?.mapSpec, "0:a:0");
    assert.equal(call?.args?.probeCount, 1);
    assert.equal(call?.args?.windowSec, 35);
    assert.equal(call?.args?.sessionId, base.sessionId);
    assert.equal(progress.length, 2);
  }
});

test("explicit Moonshine language overrides the audio metadata for testing", async () => {
  const bridge = native();
  await matchPlaybackSpeech(
    { ...base, audioLanguage: "de", modelLanguage: "en" },
    bridge.invoke,
    () => {},
    () => true,
  );
  assert.equal(
    bridge.calls.find((call) => call.command === "moonshine_transcribe_windows")?.args?.subLang,
    "en",
  );
});

test("disabled recognition, missing runtime and missing models explain why Moonshine did not run", async () => {
  for (const [input, options, error] of [
    [{ ...base, enabled: false }, {}, /Enable Smart resync/],
    [{ ...base, crossLanguage: false }, {}, /Cross-language matching is off/],
    [base, { supported: false }, /requires Python 3/],
    [base, { runtimeInstalled: false }, /Install the Moonshine testing runtime/],
    [base, { installed: false }, /moonshine-model-not-installed:en/],
  ] as const) {
    const bridge = native(options);
    await assert.rejects(
      matchPlaybackSpeech(
        input,
        bridge.invoke,
        () => {},
        () => true,
      ),
      error,
    );
    assert.equal(
      bridge.calls.some((call) => call.command === "moonshine_transcribe_windows"),
      false,
    );
  }
});

test("no transcript is reported separately from recognized speech without timestamps", async () => {
  const cases = [
    { output: [], expected: /did not recognize speech/ },
    {
      output: [
        { startSec: 5, lenSec: 35, tokens: [], stats: { audioPeak: 0.3, recognizedLines: 2 } },
      ],
      expected: /recognized some dialogue but could not provide reliable word or phrase timestamps/,
    },
    {
      output: [
        { startSec: 5, lenSec: 35, tokens: [], stats: { audioPeak: 0.0001, recognizedLines: 0 } },
      ],
      expected: /extracted playback audio is nearly silent/,
    },
  ];
  for (const { output, expected } of cases) {
    await assert.rejects(
      matchPlaybackSpeech(
        base,
        native({ output }).invoke,
        () => {},
        () => true,
      ),
      expected,
    );
  }
});

test("Moonshine diagnostics contain timing counts but no transcript text", async () => {
  const bridge = native();
  const received: unknown[] = [];
  const result = await matchPlaybackSpeech(
    base,
    bridge.invoke,
    () => {},
    () => true,
    (diagnostic) => {
      received.push(diagnostic);
    },
  );
  assert.ok(result.offsetSec > 0);
  assert.deepEqual(received, [
    {
      modelLanguage: "en",
      windows: 3,
      recognizedLines: 9,
      wordCandidates: 9,
      wordIntervals: 9,
      lineIntervals: 0,
      audioRms: 0.06,
      audioPeak: 0.4,
      chunkRetries: 0,
      retryRecognizedLines: 0,
      retryWordCandidates: 0,
      retryTimedIntervals: 0,
      acceptedIntervals: 9,
    },
  ]);
});

test("cancelled playback cannot produce an offer", async () => {
  const bridge = native();
  await assert.rejects(
    matchPlaybackSpeech(
      base,
      bridge.invoke,
      () => {},
      () => false,
    ),
    /cancelled/,
  );
  assert.equal(bridge.calls.length, 1);
});

test("unrelated subtitle timing is refused after Moonshine recognition", async () => {
  await assert.rejects(
    matchPlaybackSpeech(
      { ...base, cues: [[0, 45]] },
      native().invoke,
      () => {},
      () => true,
    ),
    /Moonshine processed.*did not agree/,
  );
});

test("already aligned foreign-language subtitle timing is a successful zero-offset result", async () => {
  for (const shift of [0, 0.1, -0.1]) {
    const cues: Array<[number, number]> = windows.flatMap((window) =>
      window.tokens.map((token) => [token.t0 + shift, token.t1 + shift]),
    );
    const result = await matchPlaybackSpeech(
      { ...base, subtitleLanguage: "el", cues },
      native().invoke,
      () => {},
      () => true,
    );
    assert.equal(result.offsetSec, 0);
  }
});
