import type { SubSearchQuery } from "./types";

/** An absolute anime episode is still a series episode, even without a season. */
export function normalizeSubtitleSearchQuery(query: SubSearchQuery): SubSearchQuery {
  return query.episode != null ? { ...query, type: "series" } : query;
}

/** IMDb providers need their mapped episode coordinates, not entry-relative anime numbering. */
export function subtitleProviderQuery(query: SubSearchQuery): SubSearchQuery {
  const q = normalizeSubtitleSearchQuery(query);
  const ids = [...(q.candidateIds ?? []), q.stremioId ?? ""];
  const mapped = ids
    .map((id) => /^(tt\d+):(\d+):(\d+)$/.exec(id))
    .filter((match) => match !== null);
  const imdb = q.imdbId?.replace(/^(\d+)$/, "tt$1");
  const matching = mapped.filter((match) => !imdb || match[1] === imdb);
  const unique = new Map(matching.map((match) => [match[0], match]));
  // Conflicting mappings must not silently select another show or episode.
  if (q.episode != null && unique.size === 1) {
    const match = [...unique.values()][0];
    return { ...q, imdbId: match[1], season: Number(match[2]), episode: Number(match[3]) };
  }
  return q;
}
