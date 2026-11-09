import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TEXTS = [
  ["views/settings/player-panel/subtitle-section.tsx", "Change font only"],
  [
    "views/settings/player-panel/subtitle-section.tsx",
    "Styled (ASS) subs keep their colors, size, and sign placement, but use your font.",
  ],
  [
    "components/player/subtitle-menu/menu-body.tsx",
    "Harbor sends its subtitles to your mpv. Pick one in mpv's own subtitle menu.",
  ],
  [
    "views/big-picture/player/bp-player-subtitles.tsx",
    "Harbor sends its subtitles to your mpv. Pick one in mpv's own subtitle menu.",
  ],
];

const LANGUAGES = [
  "ar",
  "de",
  "es",
  "fr",
  "hi",
  "id",
  "it",
  "ja",
  "ko",
  "pl",
  "pt",
  "ru",
  "tr",
  "vi",
  "zh",
];

test("the Change font only and own-mpv subtitle texts are translated in every language", async () => {
  const base = new URL("../src/", import.meta.url);
  for (const [file, text] of TEXTS) {
    const source = await readFile(new URL(file, base), "utf8");
    assert.ok(source.includes(JSON.stringify(text)), `${file} no longer shows: ${text}`);
  }
  for (const lang of LANGUAGES) {
    const catalog = (await import(`../src/lib/i18n/locales/${lang}.ts`)).default as Record<
      string,
      string
    >;
    for (const [, text] of TEXTS) {
      assert.ok(catalog[text]?.trim() && catalog[text] !== text, `${lang}: missing ${text}`);
    }
  }
});
