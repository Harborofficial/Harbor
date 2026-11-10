import { normalizeLang } from "../language";

export const MOONSHINE_LANGUAGES = [
  ["en", "English"],
  ["ar", "Arabic"],
  ["de", "German"],
  ["es", "Spanish"],
  ["ja", "Japanese"],
  ["zh", "Mandarin"],
  ["tl", "Tagalog"],
  ["vi", "Vietnamese"],
] as const;

export type MoonshineLanguage = (typeof MOONSHINE_LANGUAGES)[number][0];
export type MoonshineLanguageMode = "auto" | MoonshineLanguage;
export type MoonshineModelStatus = {
  supported: boolean;
  runtimeInstalled: boolean;
  installed: boolean;
  language: string;
};

const supported = new Set<string>(MOONSHINE_LANGUAGES.map(([code]) => code));

export function isMoonshineLanguage(code: string): code is MoonshineLanguage {
  return supported.has(code);
}

export function moonshineLanguageName(code: string): string {
  return MOONSHINE_LANGUAGES.find(([key]) => key === code)?.[1] ?? code;
}

/**
 * Resolve only from an explicit override or the currently selected AUDIO track.
 * Never infer from subtitle language, media title, region or another installed
 * model, since a mistaken ASR language produces misleading timing suggestions.
 */
export function resolveMoonshineLanguage(
  preference: string | null | undefined,
  audioTrackLanguage: string | null | undefined,
): MoonshineLanguage | null {
  const moonshineCode = (value: string) => {
    const normalized = normalizeLang(value);
    const base = normalized.split("-")[0];
    return isMoonshineLanguage(base) ? base : null;
  };
  if (preference && preference !== "auto") {
    return moonshineCode(preference);
  }
  return moonshineCode(audioTrackLanguage ?? "");
}

// The full auto-sync pipeline can discover that speech recognition needs a
// model without going through Sync from playback. Only the active player can
// turn this signal into a prompt. There is no download side effect here.
const missingModelListeners = new Set<(language: MoonshineLanguage) => void>();
export function onMoonshineModelMissing(
  callback: (language: MoonshineLanguage) => void,
): () => void {
  missingModelListeners.add(callback);
  return () => {
    missingModelListeners.delete(callback);
  };
}
export function announceMoonshineModelMissing(language: MoonshineLanguage): void {
  for (const listener of missingModelListeners) listener(language);
}

export const MOONSHINE_MISSING_MODEL_CODE = "moonshine-model-not-installed";

export function moonshineMissingModelError(language: MoonshineLanguage): Error {
  return new Error(`${MOONSHINE_MISSING_MODEL_CODE}:${language}`);
}

export function moonshineMissingModelLanguage(error: unknown): MoonshineLanguage | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.startsWith(`${MOONSHINE_MISSING_MODEL_CODE}:`)) return null;
  const code = message.slice(MOONSHINE_MISSING_MODEL_CODE.length + 1);
  return isMoonshineLanguage(code) ? code : null;
}
