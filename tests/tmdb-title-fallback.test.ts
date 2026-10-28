import assert from "node:assert/strict";
import test from "node:test";
import {
  pickTmdbTitle,
  shouldUseEnglishTitle,
  tmdbEnglishTitle,
} from "../src/lib/providers/tmdb/tmdb-title-fallback.ts";

const SPANISH = "No dejes a los niños solos";
const ENGLISH = "Don't Leave the Kids Alone";

test("missing translations fall back to English for every non-English metadata language", () => {
  for (const targetLanguage of ["ar-SA", "fr-FR", "de-DE", "ja-JP", "tr-TR", "pt-BR"]) {
    assert.equal(
      pickTmdbTitle({
        localized: SPANISH,
        original: SPANISH,
        english: ENGLISH,
        originalLanguage: "es",
        targetLanguage,
        translateTitles: true,
      }),
      ENGLISH,
      targetLanguage,
    );
  }
});

test("a real translation always beats English", () => {
  const arabicTitle = "الشر المقيم - مرحبا بكم في مدينة راكون";
  assert.equal(
    pickTmdbTitle({
      localized: arabicTitle,
      original: "Resident Evil: Welcome to Raccoon City",
      english: "Resident Evil: Welcome to Raccoon City",
      originalLanguage: "en",
      targetLanguage: "ar-SA",
      translateTitles: true,
    }),
    arabicTitle,
  );
});

test("an original in the selected language is never replaced", () => {
  const arabicTitle = "فيلم عربي";
  assert.equal(
    pickTmdbTitle({
      localized: arabicTitle,
      original: arabicTitle,
      english: "An Arabic Film",
      originalLanguage: "ar",
      targetLanguage: "ar-SA",
      translateTitles: true,
    }),
    arabicTitle,
  );
});

test("English metadata and an English original keep the localized value", () => {
  assert.equal(
    pickTmdbTitle({
      localized: SPANISH,
      original: SPANISH,
      english: ENGLISH,
      originalLanguage: "es",
      targetLanguage: "en-US",
      translateTitles: true,
    }),
    SPANISH,
  );
  assert.equal(
    pickTmdbTitle({
      localized: "Resident Evil",
      original: "Resident Evil",
      english: "Resident Evil",
      originalLanguage: "en",
      targetLanguage: "ar-SA",
      translateTitles: true,
    }),
    "Resident Evil",
  );
});

test("translate titles off keeps the localized value", () => {
  assert.equal(
    shouldUseEnglishTitle({
      localized: SPANISH,
      original: SPANISH,
      originalLanguage: "es",
      targetLanguage: "ar-SA",
      translateTitles: false,
    }),
    false,
  );
  assert.equal(
    pickTmdbTitle({
      localized: SPANISH,
      original: SPANISH,
      english: ENGLISH,
      originalLanguage: "es",
      targetLanguage: "ar-SA",
      translateTitles: false,
    }),
    SPANISH,
  );
});

test("a missing English title keeps the localized value", () => {
  assert.equal(
    pickTmdbTitle({
      localized: SPANISH,
      original: SPANISH,
      originalLanguage: "es",
      targetLanguage: "ar-SA",
      translateTitles: true,
    }),
    SPANISH,
  );
});

test("an absent original title is not proof of a missing translation", () => {
  assert.equal(
    shouldUseEnglishTitle({
      localized: SPANISH,
      original: "",
      originalLanguage: "es",
      targetLanguage: "ar-SA",
      translateTitles: true,
    }),
    false,
  );
});

test("whitespace is ignored when comparing localized and original", () => {
  assert.equal(
    shouldUseEnglishTitle({
      localized: `  ${SPANISH} `,
      original: SPANISH,
      originalLanguage: "es",
      targetLanguage: "ar-SA",
      translateTitles: true,
    }),
    true,
  );
});

test("the English translation block is read for movies and series", () => {
  assert.equal(
    tmdbEnglishTitle({
      translations: [
        { iso_639_1: "ar", data: { title: "عنوان" } },
        { iso_639_1: "en", data: { title: "An English Title" } },
      ],
    }),
    "An English Title",
  );
  assert.equal(
    tmdbEnglishTitle({
      translations: [{ iso_639_1: "en", data: { name: "An English Series" } }],
    }),
    "An English Series",
  );
  assert.equal(tmdbEnglishTitle({ translations: [] }), undefined);
  assert.equal(tmdbEnglishTitle(undefined), undefined);
});
