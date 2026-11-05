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
}));
const base = {
  path: "C:/temp/prepared.wav",
  durationSec: 45,
  sessionId: "test-session",
  audioLanguage: "en",
  subtitleLanguage: "de",
  enabled: true,
  crossLanguage: true,
  cues: windows.flatMap((window) =>
    window.tokens.map((token) => [token.t0 - 2, token.t1 - 2] as [number, number]),
  ),
};

function native(options: { installed?: boolean; supported?: boolean; empty?: boolean } = {}) {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ command, args });
    if (command === "asr_model_status")
      return { installed: options.installed ?? true, supported: options.supported ?? true } as T;
    if (command === "asr_ensure_model") return "C:/models/tiny.bin" as T;
    if (command === "asr_transcribe_windows") return (options.empty ? [] : windows) as T;
    throw new Error(`Unexpected command ${command}`);
  };
  return { calls, invoke };
}

test("playback recognition receives the prepared audio and audio language in either direction", async () => {
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
    const call = bridge.calls.find((call) => call.command === "asr_transcribe_windows");
    assert.equal(call?.args?.url, base.path);
    assert.equal(call?.args?.subLang, audioLanguage);
    assert.equal(call?.args?.mapSpec, "0:a:0");
    assert.equal(call?.args?.probeCount, 1);
    assert.equal(call?.args?.windowSec, 35);
    assert.equal(call?.args?.sessionId, base.sessionId);
    assert.equal(progress.length, 2);
  }
});

test("disabled recognition, unsupported builds and missing models explain why Whisper did not run", async () => {
  for (const [input, options, error] of [
    [{ ...base, enabled: false }, {}, /Enable Smart resync/],
    [{ ...base, crossLanguage: false }, {}, /cross-language matching is off/],
    [base, { supported: false }, /does not include Whisper/],
    [base, { installed: false }, /Download the Whisper/],
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
      bridge.calls.some((call) => call.command === "asr_transcribe_windows"),
      false,
    );
  }
});

test("empty transcription and cancelled playback cannot produce an offer", async () => {
  const bridge = native({ empty: true });
  await assert.rejects(
    matchPlaybackSpeech(
      base,
      bridge.invoke,
      () => {},
      () => true,
    ),
    /no usable speech/,
  );
  const cancelled = native();
  await assert.rejects(
    matchPlaybackSpeech(
      base,
      cancelled.invoke,
      () => {},
      () => false,
    ),
    /cancelled/,
  );
  assert.equal(cancelled.calls.length, 1);
});

test("unrelated subtitle timing is refused after recognition", async () => {
  await assert.rejects(
    matchPlaybackSpeech(
      { ...base, cues: [[0, 45]] },
      native().invoke,
      () => {},
      () => true,
    ),
    /Whisper processed.*did not agree/,
  );
});

test("already aligned Greek subtitle timing is a successful zero-offset result", async () => {
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
