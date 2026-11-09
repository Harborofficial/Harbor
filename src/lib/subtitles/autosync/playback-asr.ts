import { crossLanguagePlaybackOffset } from "./drift-dsp";
import { normalizeLang } from "../language";

type Window = {
  startSec: number;
  lenSec: number;
  tokens: Array<{ text: string; t0: number; t1: number }>;
};

/** Only the prepared local playback WAV is passed to recognition. */
export async function matchPlaybackSpeech(
  input: {
    path: string;
    durationSec: number;
    cues: Array<[number, number]>;
    audioLanguage?: string;
    subtitleLanguage?: string;
    enabled: boolean;
    crossLanguage: boolean;
    sessionId: string;
  },
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
  progress: (message: string) => void,
  isCurrent: () => boolean,
): Promise<{ offsetSec: number; confidence: number }> {
  if (!input.enabled)
    throw new Error(
      "Whisper was not used. Enable Smart resync with speech recognition in Auto sync settings.",
    );
  const audio = normalizeLang(input.audioLanguage ?? "");
  const subtitle = normalizeLang(input.subtitleLanguage ?? "");
  if (
    audio &&
    subtitle &&
    audio !== "und" &&
    subtitle !== "und" &&
    audio !== subtitle &&
    !input.crossLanguage
  ) {
    throw new Error(
      "Whisper cross-language matching is off. Enable Match subtitles across languages in Auto sync settings.",
    );
  }
  const status = await invoke<{ supported: boolean; installed: boolean }>("asr_model_status");
  if (!isCurrent()) throw new Error("Sync cancelled.");
  if (!status.supported)
    throw new Error(
      "Whisper was not used because this Harbor build does not include Whisper support.",
    );
  if (!status.installed)
    throw new Error(
      "Whisper was not used. Download the Whisper speech model in Auto sync settings.",
    );
  const modelPath = await invoke<string | null>("asr_ensure_model");
  if (!modelPath) throw new Error("The installed Whisper model could not be opened.");
  if (!isCurrent()) throw new Error("Sync cancelled.");
  progress("Recognizing buffered dialogue with Whisper");
  const windows = await invoke<Window[]>("asr_transcribe_windows", {
    url: input.path,
    headers: null,
    durationSec: input.durationSec,
    subLang: audio && audio !== "und" ? audio : null,
    probeCount: 1,
    windowSec: Math.min(35, input.durationSec - 10),
    modelPath,
    mapSpec: "0:a:0",
    sessionId: input.sessionId,
  });
  if (!isCurrent()) throw new Error("Sync cancelled.");
  const speech: Array<[number, number]> = windows.flatMap((window) =>
    window.tokens
      .filter(
        (token) =>
          /[\p{L}\p{N}]/u.test(token.text) &&
          Number.isFinite(token.t0) &&
          Number.isFinite(token.t1) &&
          token.t1 > token.t0,
      )
      .map((token) => [token.t0, token.t1] as [number, number]),
  );
  if (!speech.length)
    throw new Error(
      "Whisper ran on the buffered audio but returned no usable speech timestamps. Try a clearer dialogue scene.",
    );
  progress("Comparing Whisper speech timestamps with subtitles");
  const offsetSec = crossLanguagePlaybackOffset(speech, input.cues, windows, 30);
  if (offsetSec === null)
    throw new Error(
      "Whisper processed the buffered audio, but the speech and subtitle timing did not agree on a reliable shift. Try another dialogue scene or Manual offset.",
    );
  // A local timing estimate is offered for review, never episode-wide verification.
  return { offsetSec, confidence: 0.65 };
}
