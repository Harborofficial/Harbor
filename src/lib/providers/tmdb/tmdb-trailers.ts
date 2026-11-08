import { get } from "./tmdb-client";

export type Video = {
  key: string;
  site: string;
  type: string;
  official: boolean;
  name?: string;
  published_at?: string;
};

export const pickTrailerVideos = (videos: Video[]): Video[] => {
  const yt = videos.filter((v) => v.site === "YouTube");
  const ranked: Video[] = [
    ...yt.filter((v) => v.type === "Trailer" && v.official),
    ...yt.filter((v) => v.type === "Trailer" && !v.official),
    ...yt.filter((v) => v.type === "Teaser" && v.official),
    ...yt.filter((v) => v.type === "Teaser"),
    ...yt.filter((v) => v.type === "Clip" || v.type === "Featurette"),
  ];
  const seen = new Set<string>();
  const out: Video[] = [];
  for (const v of ranked) {
    if (!v.key || seen.has(v.key)) continue;
    seen.add(v.key);
    out.push(v);
  }
  return out;
};

export const pickTrailers = (videos: Video[]): string[] =>
  pickTrailerVideos(videos).map((video) => video.key);

const trailerRank = (video: Video): number => {
  const official = video.official ? 0 : 1;
  if (video.type === "Trailer") return official;
  if (video.type === "Teaser") return 2 + official;
  return 4;
};

/** Keep trailers before teasers and clips, newest first within each group. */
export const sortTrailerVideos = (videos: Video[]): Video[] =>
  [...videos].sort((a, b) => {
    const rank = trailerRank(a) - trailerRank(b);
    if (rank !== 0) return rank;
    const at = a.published_at ? Date.parse(a.published_at) : 0;
    const bt = b.published_at ? Date.parse(b.published_at) : 0;
    return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
  });

/** Merge already-ranked groups without letting a later group reorder an earlier one. */
export const mergeTrailerVideoGroups = (...groups: Video[][]): Video[] => {
  const seen = new Set<string>();
  const out: Video[] = [];
  for (const group of groups) {
    for (const video of group) {
      if (!video.key || seen.has(video.key)) continue;
      seen.add(video.key);
      out.push(video);
    }
  }
  return out;
};

export async function tmdbTrailerList(key: string, metaId: string): Promise<string[]> {
  if (!key) return [];
  const match = metaId.match(/^tmdb:(movie|tv):(\d+)$/);
  if (!match) return [];
  const [, kind, id] = match;
  if (kind === "tv") {
    const show = await get<{
      seasons?: Array<{ season_number?: number; episode_count?: number }>;
    }>(key, `tv/${id}`).catch(() => null);
    const seasonNumbers = Array.from(
      new Set(
        (show?.seasons ?? [])
          .map((season) => ({
            number: Number(season?.season_number),
            episodes: Number(season?.episode_count),
          }))
          .filter(
            (season) => Number.isInteger(season.number) && season.number > 0 && season.episodes > 0,
          )
          .map((season) => season.number),
      ),
    );
    const [showVideos, seasonVideos] = await Promise.all([
      get<{ results?: Video[] }>(key, `tv/${id}/videos`).catch(() => null),
      Promise.all(
        seasonNumbers.map((seasonNumber) =>
          get<{ results?: Video[] }>(key, `tv/${id}/season/${seasonNumber}/videos`).catch(
            () => null,
          ),
        ),
      ),
    ]);
    const seasonPool = sortTrailerVideos(
      pickTrailerVideos(seasonVideos.flatMap((season) => season?.results ?? [])),
    );
    const showPool = sortTrailerVideos(pickTrailerVideos(showVideos?.results ?? []));
    return mergeTrailerVideoGroups(seasonPool, showPool).map((video) => video.key);
  }
  const data = await get<{ results?: Video[] }>(key, `${kind}/${id}/videos`);
  return sortTrailerVideos(pickTrailerVideos(data?.results ?? [])).map((video) => video.key);
}

export async function tmdbTrailer(key: string, metaId: string): Promise<string | null> {
  const list = await tmdbTrailerList(key, metaId);
  return list[0] ?? null;
}
