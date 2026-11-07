import { isKnownLanguage, languageName, normalizeLang } from "@/lib/subtitles/language";

/** Stored in preferredAudioLangs so the title's own language can lead the preference list. */
export const ORIGINAL_AUDIO_LANG = "Original";

export function expandOriginalAudioLang(
  langs: string[],
  originalLanguage: string | undefined,
  isAnime: boolean,
): string[] {
  if (!langs.includes(ORIGINAL_AUDIO_LANG)) return langs;
  const code = normalizeLang(originalLanguage);
  const original =
    code && isKnownLanguage(code) ? languageName(code) : isAnime ? "Japanese" : undefined;
  const out: string[] = [];
  for (const lang of langs) {
    const value = lang === ORIGINAL_AUDIO_LANG ? original : lang;
    if (!value) continue;
    const valueCode = normalizeLang(value);
    if (out.some((item) => normalizeLang(item) === valueCode)) continue;
    out.push(value);
  }
  return out;
}
