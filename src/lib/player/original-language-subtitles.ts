import { normalizeLang } from "@/lib/subtitles/language";

export function originalLanguageSubtitlePolicy(
  enabled: boolean,
  originalLanguage: string | null,
): "normal" | "off" | "english" {
  if (!enabled) return "normal";
  const language = normalizeLang(originalLanguage ?? "");
  return !language || language === "en" ? "off" : "english";
}
