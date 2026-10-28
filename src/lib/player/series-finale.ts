import type { Meta } from "@/lib/cinemeta";
import type { PlayEpisode } from "@/lib/view";
import { animeSeriesFromStreamId, fetchEpisodeList } from "@/lib/series-episodes";
import { externalToKitsu, imdbToKitsu } from "@/lib/providers/anime-mapping";
import { kitsuAnime, kitsuRelated, parseKitsuId } from "@/lib/providers/kitsu";

/** Only released continuations block the end screen; future/TBA seasons do not. */
export async function isFinalSeriesEpisode(
  meta: Meta,
  current: PlayEpisode,
  opts: { tmdbKey: string; isAnime?: boolean },
): Promise<boolean> {
  const animeId = animeSeriesFromStreamId(current.kitsuStreamId);
  const id = animeId ?? meta.id;
  let kitsuId = parseKitsuId(id);
  if (kitsuId == null) {
    const services: Record<string, string> = {
      mal: "myanimelist",
      anilist: "anilist",
      anidb: "anidb",
    };
    const [prefix, value] = id.split(":");
    if (services[prefix] && Number.isFinite(Number(value))) {
      kitsuId = await externalToKitsu(services[prefix], Number(value));
    } else if (opts.isAnime && id.startsWith("tt")) {
      kitsuId = await imdbToKitsu(id);
    }
  }
  const episodeMeta = animeId ? { ...meta, id: animeId } : meta;
  const eps = await fetchEpisodeList(episodeMeta, opts);
  // Anime rows display franchise seasons while Kitsu catalogs use entry-relative
  // season 1. The stream identity joins those two coordinate systems.
  const matched =
    (current.kitsuStreamId
      ? eps.find((e) => e.kitsuStreamId === current.kitsuStreamId)
      : undefined) ?? eps.find((e) => e.season === current.season && e.episode === current.episode);
  if (!matched) return false;
  if (
    eps.some(
      (e) =>
        (e.season > matched.season ||
          (e.season === matched.season && e.episode > matched.episode)) &&
        Number.isFinite(Date.parse(e.airDate ?? "")) &&
        Date.parse(e.airDate!) <= Date.now(),
    )
  )
    return false;
  if (kitsuId != null) {
    const related = await kitsuRelated(kitsuId);
    const sequels = await Promise.all(
      related
        .filter((r) => r.role.toLowerCase() === "sequel")
        .map(async (r) => {
          const sequelId = parseKitsuId(r.meta.id);
          return sequelId != null ? kitsuAnime(sequelId) : null;
        }),
    );
    if (
      sequels.some(
        (anime) =>
          anime &&
          (anime.status === "finished" ||
            anime.status === "current" ||
            (Number.isFinite(Date.parse(anime.startDate ?? "")) &&
              Date.parse(anime.startDate!) <= Date.now())),
      )
    )
      return false;
  }
  return true;
}
