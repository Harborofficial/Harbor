import { animeKitsuMeta, type AnimeKitsuMeta } from "@/lib/providers/anime-kitsu-addon";
import { externalToKitsu } from "@/lib/providers/anime-mapping";
import { parseKitsuId } from "@/lib/providers/kitsu";

export type AnimeEntry = {
  kitsuId: number;
  meta: AnimeKitsuMeta | null;
};

export type NextAnimeEntry = {
  id: string;
  meta: AnimeKitsuMeta | null;
};

export type AnimeMetaLookup = (metaId: string) => Promise<AnimeKitsuMeta | null>;

const EXTERNAL: Array<[prefix: string, source: string]> = [
  ["mal:", "myanimelist"],
  ["anilist:", "anilist"],
  ["anidb:", "anidb"],
];

/**
 * Resolve an external anime id to Kitsu through ARM, the Kitsu native mapping
 * API, and (for MAL) the exact AniList bridge. The addon itself is asked
 * separately by `resolveAnimeEntry` so its fresher sequel records keep
 * precedence.
 */
export async function resolveExternalKitsuId(id: string, maxAge?: number): Promise<number | null> {
  for (const [prefix, source] of EXTERNAL) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    let kitsuId = await externalToKitsu(source, n, maxAge).catch(() => null);
    if (kitsuId == null && (source === "myanimelist" || source === "anilist")) {
      try {
        const { kitsuFromExternal } = await import("./kitsu-mapping");
        kitsuId = await kitsuFromExternal(
          source === "myanimelist" ? "myanimelist/anime" : "anilist/anime",
          n,
          maxAge,
        ).catch(() => null);
        if (kitsuId == null && source === "myanimelist") {
          const { anilistAnimeEntry } = await import("@/lib/anilist/entry");
          const entry = await anilistAnimeEntry(n, "mal", maxAge).catch(() => null);
          if (entry)
            kitsuId = await kitsuFromExternal("anilist/anime", entry.id, maxAge).catch(() => null);
        }
      } catch {
        return null;
      }
    }
    return kitsuId;
  }
  return null;
}

/**
 * Resolve an anime meta id to the Kitsu entry Harbor should use.
 *
 * The addon is asked with the original id first. It is the same source the
 * Continue Watching card and the anime detail page use for display, and it
 * publishes a newly announced sequel before the external id graph links it.
 * ARM is only the fallback, so a missing or stale mapping cannot send an
 * episode list or a detail page to the parent cour.
 */
export async function resolveAnimeEntry(id: string, maxAge?: number): Promise<AnimeEntry | null> {
  const meta = await animeKitsuMeta(id, maxAge).catch(() => null);
  const direct = parseKitsuId(meta?.id ?? "");
  if (direct != null) return { kitsuId: direct, meta };
  const kitsuId = await resolveExternalKitsuId(id, maxAge);
  return kitsuId != null ? { kitsuId, meta: null } : null;
}

/**
 * The next series entry linked by the Kitsu addon's Sequel relation. Addon
 * metadata already carries these links, so crossing a cour costs one cached
 * lookup rather than a fresh franchise walk.
 */
export async function nextAnimeEntry(
  id: string,
  lookup: AnimeMetaLookup = animeKitsuMeta,
): Promise<NextAnimeEntry | null> {
  const meta = await lookup(id).catch(() => null);
  const sequel = meta?.links?.find(
    (link) => link.category?.toLowerCase() === "franchise" && /^sequel\b/i.test(link.name ?? ""),
  );
  const match = sequel ? /\/detail\/series\/([^/?#]+)/.exec(sequel.url ?? "") : null;
  if (!match) return null;
  let nextId: string;
  try {
    nextId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!nextId) return null;
  const nextMeta = await lookup(nextId).catch(() => null);
  return { id: nextId, meta: nextMeta };
}
