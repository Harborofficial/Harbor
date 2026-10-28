export type TmdbTranslationData = {
  title?: string;
  name?: string;
  overview?: string;
  tagline?: string;
};

export type TmdbTranslations = {
  translations?: Array<{
    iso_639_1?: string;
    data?: TmdbTranslationData;
  }>;
};

export function tmdbLanguageBase(language: string | null | undefined): string {
  return language?.trim().toLowerCase().split("-")[0] ?? "";
}

/** The English translation block TMDB appends to a detail response, if present. */
export function tmdbEnglishTranslation(
  translations: TmdbTranslations | null | undefined,
): TmdbTranslationData | undefined {
  return translations?.translations?.find((entry) => entry?.iso_639_1 === "en")?.data;
}

export function tmdbEnglishTitle(
  translations: TmdbTranslations | null | undefined,
): string | undefined {
  const data = tmdbEnglishTranslation(translations);
  const title = data?.title || data?.name;
  return title?.trim() || undefined;
}

/**
 * TMDB returns the original-language title when the requested language has no
 * translation. Only a value that still equals the original proves the translation
 * is missing: a script test cannot tell Spanish from English for an Arabic user.
 */
export function shouldUseEnglishTitle(args: {
  localized: string;
  original: string;
  originalLanguage?: string | null;
  targetLanguage?: string | null;
  translateTitles: boolean;
}): boolean {
  if (!args.translateTitles) return false;
  const target = tmdbLanguageBase(args.targetLanguage);
  if (!target || target === "en") return false;
  const localized = args.localized.trim();
  const original = args.original.trim();
  if (!localized || !original || localized !== original) return false;
  const originalLanguage = tmdbLanguageBase(args.originalLanguage);
  if (!originalLanguage || originalLanguage === "en" || originalLanguage === target) return false;
  return true;
}

export function pickTmdbTitle(args: {
  localized: string;
  original: string;
  english?: string | null;
  originalLanguage?: string | null;
  targetLanguage?: string | null;
  translateTitles: boolean;
}): string {
  const localized = args.localized.trim();
  const original = args.original.trim();
  const english = args.english?.trim();
  if (english && shouldUseEnglishTitle(args)) return english;
  return localized || original;
}
