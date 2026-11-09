import { crossLanguagePlaybackOffset, type SpeechTimingDiagnostic } from "./drift-dsp";

/** undefined means this build lacks Silero; null means detection found no reliable match. */
export async function matchPlaybackVad(
  input: { path: string; cues: Array<[number, number]>; sessionId: string },
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
  isCurrent: () => boolean,
  diagnose?: (value: SpeechTimingDiagnostic) => void,
): Promise<{ offsetSec: number; confidence: number } | null | undefined> {
  const speech = await invoke<{
    durationSec: number;
    intervals: Array<[number, number]>;
  } | null>("subsync_playback_speech", { path: input.path, sessionId: input.sessionId });
  if (!isCurrent()) throw new Error("Sync cancelled.");
  if (speech === null) return undefined;
  const { durationSec, intervals } = speech;
  if (
    !Number.isFinite(durationSec) ||
    durationSec < 30 ||
    durationSec > 46 ||
    intervals.some(
      ([a, b]) => !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a || b > durationSec,
    )
  ) {
    throw new Error("cache-audio-speech-invalid");
  }
  const offsetSec = crossLanguagePlaybackOffset(
    intervals,
    input.cues,
    [{ startSec: 0, lenSec: durationSec }],
    30,
    diagnose,
  );
  // As with Whisper, one local scene can only support a reviewable offset offer.
  return offsetSec === null ? null : { offsetSec, confidence: 0.65 };
}
