import { crossLanguagePlaybackOffset } from "./drift-dsp";
import { normalizeLang } from "../language";
import { resolveMoonshineLanguage, moonshineMissingModelError } from "./moonshine-models";

type Window = {
  startSec: number;
  lenSec: number;
  tokens: Array<{ text: string; t0: number; t1: number }>;
  stats?: {
    recognizedLines?: number;
    wordCandidates?: number;
    wordIntervals?: number;
    lineIntervals?: number;
    audioRms?: number;
    audioPeak?: number;
    chunkRetry?: boolean;
    retryRecognizedLines?: number;
    retryWordCandidates?: number;
    retryLineIntervals?: number;
    retryTimedIntervals?: number;
  };
};

export type MoonshineTimingDiagnostic = {
  modelLanguage: string;
  windows: number;
  recognizedLines: number;
  wordCandidates: number;
  wordIntervals: number;
  lineIntervals: number;
  audioRms: number;
  audioPeak: number;
  chunkRetries: number;
  retryRecognizedLines: number;
  retryWordCandidates: number;
  retryTimedIntervals: number;
  acceptedIntervals: number;
};

/** The short prepared playback audio is transcribed in an isolated Moonshine worker. */
export async function matchPlaybackSpeech(
  input: {
    path: string;
    durationSec: number;
    cues: Array<[number, number]>;
    audioLanguage?: string;
    subtitleLanguage?: string;
    modelLanguage?: string;
    enabled: boolean;
    crossLanguage: boolean;
    sessionId: string;
  },
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
  progress: (message: string) => void,
  isCurrent: () => boolean,
  diagnose?: (value: MoonshineTimingDiagnostic) => void,
): Promise<{ offsetSec: number; confidence: number }> {
  if (!input.enabled)
    throw new Error(
      "Moonshine was not used. Enable Smart resync with speech recognition in Auto sync settings.",
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
      "Cross-language matching is off. Enable Match subtitles across languages in Auto sync settings.",
    );
  }
  const modelLanguage = resolveMoonshineLanguage(input.modelLanguage, input.audioLanguage);
  if (!modelLanguage) {
    throw new Error(
      input.modelLanguage && input.modelLanguage !== "auto"
        ? "Moonshine does not support the chosen override language. Silero remains available."
        : "Moonshine cannot select a supported model from this audio track. Silero remains available; you can choose a language manually in Settings.",
    );
  }
  const status = await invoke<{
    supported: boolean;
    runtimeInstalled: boolean;
    installed: boolean;
  }>("moonshine_model_status", { language: modelLanguage });
  if (!isCurrent()) throw new Error("Sync cancelled.");
  if (!status.supported)
    throw new Error("Moonshine testing requires Python 3. Install Python first.");
  if (!status.runtimeInstalled)
    throw new Error("Install the Moonshine testing runtime in Auto sync settings first.");
  if (!status.installed) throw moonshineMissingModelError(modelLanguage);
  progress("Recognizing buffered dialogue with Moonshine");
  const windows = await invoke<Window[]>("moonshine_transcribe_windows", {
    url: input.path,
    headers: null,
    durationSec: input.durationSec,
    subLang: modelLanguage,
    probeCount: 1,
    windowSec: Math.min(35, input.durationSec - 10),
    mapSpec: "0:a:0",
    sessionId: input.sessionId,
  });
  if (!isCurrent()) throw new Error("Sync cancelled.");
  const totals = windows.reduce(
    (stats, window) => {
      const next = window.stats;
      stats.recognizedLines += next?.recognizedLines ?? 0;
      stats.wordCandidates += next?.wordCandidates ?? 0;
      stats.wordIntervals += next?.wordIntervals ?? 0;
      stats.lineIntervals += next?.lineIntervals ?? 0;
      stats.audioRms = Math.max(stats.audioRms, next?.audioRms ?? 0);
      stats.audioPeak = Math.max(stats.audioPeak, next?.audioPeak ?? 0);
      stats.chunkRetries += next?.chunkRetry ? 1 : 0;
      stats.retryRecognizedLines += next?.retryRecognizedLines ?? 0;
      stats.retryWordCandidates += next?.retryWordCandidates ?? 0;
      stats.retryTimedIntervals += next?.retryTimedIntervals ?? 0;
      return stats;
    },
    {
      modelLanguage,
      windows: windows.length,
      recognizedLines: 0,
      wordCandidates: 0,
      wordIntervals: 0,
      lineIntervals: 0,
      audioRms: 0,
      audioPeak: 0,
      chunkRetries: 0,
      retryRecognizedLines: 0,
      retryWordCandidates: 0,
      retryTimedIntervals: 0,
      acceptedIntervals: 0,
    },
  );
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
  totals.acceptedIntervals = speech.length;
  diagnose?.(totals);
  if (!speech.length) {
    if (totals.audioPeak < 0.002 && totals.windows > 0) {
      throw new Error(
        "The extracted playback audio is nearly silent. Play a scene with audible dialogue and try again.",
      );
    }
    if (totals.recognizedLines + totals.retryRecognizedLines === 0) {
      throw new Error(
        "Moonshine did not recognize speech in the sampled audio. Check that its selected language matches the audio track, or try a different dialogue scene.",
      );
    }
    throw new Error(
      "Moonshine recognized some dialogue but could not provide reliable word or phrase timestamps for this sample. Try another dialogue scene.",
    );
  }
  progress("Comparing Moonshine speech timestamps with subtitles");
  const offsetSec = crossLanguagePlaybackOffset(speech, input.cues, windows, 30);
  if (offsetSec === null)
    throw new Error(
      "Moonshine processed the audio, but the speech and subtitle timing did not agree on a reliable shift. Try another dialogue scene or Manual offset.",
    );
  return { offsetSec, confidence: 0.65 };
}
