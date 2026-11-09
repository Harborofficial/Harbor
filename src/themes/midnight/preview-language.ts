import { useEffect, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import { tmdbMetadataOverview, tmdbLiteMeta } from "@/lib/providers/tmdb/tmdb-lite";
import { tmdbIdFromImdb } from "@/lib/providers/tmdb/tmdb-imdb-resolve";
import { useSettings } from "@/lib/settings";

/**
 * A row's catalogue answers in the title's own language, while the details page asks TMDB in
 * the language the owner picked in settings. The card reads its text from where the page does:
 * the synopsis through TMDB's overview and the title through the same TMDB title fallback the
 * page uses, so a hover reads in Arabic on a page that also reads in Arabic.
 *
 * This follows Harbor's own preview, which localizes the synopsis through `useLocalizedOverview`
 * and leaves the title as the catalogue gave it. The card resolves one TMDB id for both texts, so
 * the title reuses the id the synopsis needed rather than resolving it a second time.
 */

type Resolved = { id: string; name?: string; synopsis?: string };

export type PreviewLanguage = { name: string; synopsis: string | undefined };

const TT_ID = /^tt\d+$/;
const TMDB_ID = /^tmdb:(movie|tv):\d+$/;

export function usePreviewLanguage(meta: Meta | null): PreviewLanguage {
  const { settings } = useSettings();
  const key = settings.tmdbKey;
  const language = settings.tmdbLanguage;
  // The owner can keep titles or descriptions untranslated; the card honours both switches the
  // way the details page does, leaving the catalogue's own text in place.
  const wantsTitle = settings.translateTitles !== false;
  const wantsSynopsis = settings.translateDescriptions !== false;

  const id = meta?.id ?? "";
  const type = meta?.type === "movie" || meta?.type === "series" ? meta.type : undefined;
  // A card carrying a TMDB id was named by TMDB in this same language when its row was built, so
  // only a catalog id needs its title read again. The synopsis is worth a request either way.
  const wantsName = wantsTitle && TT_ID.test(id);
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    if (!key || !id || !type || (!wantsName && !wantsSynopsis)) return;
    if (!TT_ID.test(id) && !TMDB_ID.test(id)) return;
    let alive = true;
    void (async () => {
      // A `tt` card has to be found in TMDB first; that answer is cached across hovers.
      const tmdbId = TMDB_ID.test(id) ? id : await tmdbIdFromImdb(key, id, type).catch(() => null);
      if (!alive || !tmdbId) return;
      const [lite, overview] = await Promise.all([
        wantsName ? tmdbLiteMeta(key, tmdbId).catch(() => null) : null,
        wantsSynopsis ? tmdbMetadataOverview(key, tmdbId).catch(() => undefined) : null,
      ]);
      if (!alive) return;
      const name = lite?.name?.trim() || undefined;
      const synopsis = overview?.trim() || undefined;
      // Nothing translated: keep the catalogue's text rather than blanking a working card.
      if (!name && !synopsis) return;
      setResolved({ id, name, synopsis });
    })();
    return () => {
      alive = false;
    };
  }, [id, type, key, language, wantsName, wantsSynopsis]);

  // Only an answer for the card on screen is applied; a slow one for a card that has already
  // been left behind would otherwise paint its title over the new card.
  const fresh = resolved?.id === id ? resolved : null;
  return {
    name: fresh?.name ?? meta?.name ?? "",
    synopsis: fresh?.synopsis ?? meta?.description,
  };
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The preview assembly shapes a duration and a season count in English ("123 min", "2 seasons").
 * Both shapes have catalogue keys, so the pill can speak the interface language instead.
 */
export function localizeFact(value: string, t: Translate): string {
  const match = value.match(/^(\d+)\s+(min|seasons?)$/);
  if (!match) return value;
  const n = Number(match[1]);
  return match[2] === "min" ? t("{n} min", { n }) : t("{n} seasons", { n });
}
