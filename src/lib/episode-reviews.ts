import { safeFetch } from "@/lib/safe-fetch";
import { fetchCommentsStrict } from "@/lib/trakt/comments";

// Reviews for a single episode, merged from two public sources:
//  - IMDb user reviews of the episode itself (each with the reviewer's /10 rating), read from
//    IMDb's public GraphQL endpoint;
//  - Trakt comments on the episode (with the commenter's own rating), through Harbor's
//    existing Trakt client.
// Both are read a page at a time, so the dialog only asks for more when the reader does.

export type EpisodeReviewSource = "imdb" | "trakt";

export type EpisodeReview = {
  id: string;
  source: EpisodeReviewSource;
  author: string;
  avatar: string | null;
  /** 1-10, when the reviewer rated the episode. */
  rating: number | null;
  date: string | null;
  likes: number;
  title: string;
  text: string;
  spoiler: boolean;
  url: string | null;
};

export type EpisodeReviewSort = "liked" | "recent" | "highest" | "lowest" | "longest";

/** Where the next page of each source starts; null once that source is exhausted. */
export type EpisodeReviewsCursor = {
  /** The IMDb review list's cursor, or "" for its first page. */
  imdb: string | null;
  /** The next Trakt comments page, counted from 1. */
  trakt: number | null;
};

export type EpisodeReviewsPage = {
  reviews: EpisodeReview[];
  /** Null when both sources are exhausted. Failed sources keep their cursor so retry is possible. */
  next: EpisodeReviewsCursor | null;
  /** Sources whose current page could not be read. */
  failed: EpisodeReviewSource[];
};

const IMDB_GRAPHQL = "https://api.graphql.imdb.com/";
const IMDB_PAGE = 25;
const TRAKT_PAGE = 25;
const IMDB_EPISODE_PAGE = 250;
const IMDB_EPISODE_PAGES = 8;

type ImdbQueryResult<T> = { data: T | null; failed: boolean };

async function imdbQueryResult<T>(query: string): Promise<ImdbQueryResult<T>> {
  try {
    const res = await safeFetch(IMDB_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-imdb-client-name": "imdb-web-next-localized",
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return { data: null, failed: true };
    const body = (await res.json()) as { data?: T; errors?: unknown[] };
    return { data: body.data ?? null, failed: body.data == null };
  } catch {
    return { data: null, failed: true };
  }
}

const IMDB_ID = /^tt\d+$/;
// GraphQL values are written into the query, so only well-formed ones get that far.
const validNumber = (n: number | null | undefined, min: number): n is number =>
  Number.isInteger(n) && n! >= min && n! <= 100_000;
const validCursor = (cursor: string) => /^[\w+/=-]*$/.test(cursor);

/** Where an episode's reviews are found: the series' IMDb id and IMDb's own numbering. */
export function episodeReviewsTarget(
  imdbId: string | null | undefined,
  season: number | null | undefined,
  episode: number | null | undefined,
): { imdbId: string; season: number; episode: number } | undefined {
  return imdbId && IMDB_ID.test(imdbId) && validNumber(season, 0) && validNumber(episode, 1)
    ? { imdbId, season, episode }
    : undefined;
}

// Only complete season lists are kept: a failed page leaves nothing cached, so the next
// lookup tries again instead of believing the episode doesn't exist.
const seasonEpisodes = new Map<string, Map<string, string>>();

/** IMDb id of an episode, from the series' IMDb id. Follows the season list's pages. */
type ImdbEpisodeLookup = { id: string | null; failed: boolean };

async function imdbEpisodeLookup(
  seriesImdbId: string,
  season: number,
  episode: number,
): Promise<ImdbEpisodeLookup> {
  if (!episodeReviewsTarget(seriesImdbId, season, episode)) return { id: null, failed: false };
  const key = `${seriesImdbId}:${season}`;
  const cached = seasonEpisodes.get(key);
  if (cached) return { id: cached.get(String(episode)) ?? null, failed: false };
  type Data = {
    title?: {
      episodes?: {
        episodes?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string };
          edges: {
            node: {
              id: string;
              series?: { displayableEpisodeNumber?: { episodeNumber?: { text?: string } } };
            };
          }[];
        };
      };
    };
  };
  const byNumber = new Map<string, string>();
  let after = "";
  for (let page = 0; page < IMDB_EPISODE_PAGES; page++) {
    const result = await imdbQueryResult<Data>(
      `{ title(id:"${seriesImdbId}"){ episodes{ episodes(first:${IMDB_EPISODE_PAGE}${after ? `, after:"${after}"` : ""}, filter:{includeSeasons:["${season}"]}){ pageInfo{hasNextPage endCursor} edges{ node{ id series{ displayableEpisodeNumber{ episodeNumber{text} } } } } } } } }`,
    );
    if (result.failed) return { id: null, failed: true };
    const list = result.data?.title?.episodes?.episodes;
    if (!list) return { id: null, failed: false };
    for (const { node } of list.edges) {
      const n = node.series?.displayableEpisodeNumber?.episodeNumber?.text;
      if (n && IMDB_ID.test(node.id)) byNumber.set(n, node.id);
    }
    const found = byNumber.get(String(episode));
    const cursor = list.pageInfo?.endCursor ?? "";
    if (!list.pageInfo?.hasNextPage || !cursor || !validCursor(cursor)) {
      if (byNumber.size) seasonEpisodes.set(key, byNumber);
      return { id: found ?? null, failed: false };
    }
    // Found before the end: answer now, but don't cache a season we haven't read to the end.
    if (found) return { id: found, failed: false };
    after = cursor;
  }
  return { id: byNumber.get(String(episode)) ?? null, failed: false };
}

/** IMDb id of an episode, from the series' IMDb id. Follows the season list's pages. */
export async function imdbEpisodeId(
  seriesImdbId: string,
  season: number,
  episode: number,
): Promise<string | null> {
  return (await imdbEpisodeLookup(seriesImdbId, season, episode)).id;
}

type ImdbReviewNode = {
  id: string;
  author?: { nickName?: string };
  authorRating?: number | null;
  summary?: { originalText?: string };
  text?: { originalText?: { plainText?: string } };
  submissionDate?: string;
  helpfulness?: { upVotes?: number };
  spoiler?: boolean;
};

const IMDB_REVIEW_SORT: Record<
  EpisodeReviewSort,
  { by: "HELPFULNESS_SCORE" | "SUBMISSION_DATE" | "USER_RATING"; order: "ASC" | "DESC" }
> = {
  liked: { by: "HELPFULNESS_SCORE", order: "DESC" },
  recent: { by: "SUBMISSION_DATE", order: "DESC" },
  highest: { by: "USER_RATING", order: "DESC" },
  lowest: { by: "USER_RATING", order: "ASC" },
  // Neither source exposes a length sort. The dialog exhausts both sources for this mode.
  longest: { by: "HELPFULNESS_SCORE", order: "DESC" },
};

const TRAKT_REVIEW_SORT: Record<EpisodeReviewSort, string> = {
  liked: "likes",
  recent: "newest",
  highest: "highest",
  lowest: "lowest",
  longest: "likes",
};

async function imdbReviewsPage(
  episodeImdbId: string,
  after: string,
  sort: EpisodeReviewSort,
): Promise<{ reviews: EpisodeReview[]; next: string | null; failed: boolean }> {
  if (!IMDB_ID.test(episodeImdbId) || !validCursor(after))
    return { reviews: [], next: null, failed: false };
  type Data = {
    title?: {
      reviews?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string };
        edges: { node: ImdbReviewNode }[];
      };
    };
  };
  const order = IMDB_REVIEW_SORT[sort];
  const result = await imdbQueryResult<Data>(
    `{ title(id:"${episodeImdbId}"){ reviews(first:${IMDB_PAGE}${after ? `, after:"${after}"` : ""}, sort:{by:${order.by}, order:${order.order}}){ pageInfo{hasNextPage endCursor} edges{ node{ id author{nickName} authorRating summary{originalText} text{originalText{plainText}} submissionDate helpfulness{upVotes} spoiler } } } } }`,
  );
  if (result.failed) return { reviews: [], next: after, failed: true };
  const list = result.data?.title?.reviews;
  if (!list) return { reviews: [], next: null, failed: false };
  const reviews = list.edges.map(({ node }): EpisodeReview => ({
    id: `imdb:${node.id}`,
    source: "imdb",
    author: node.author?.nickName || "IMDb",
    avatar: null,
    rating: node.authorRating ?? null,
    date: node.submissionDate ?? null,
    likes: node.helpfulness?.upVotes ?? 0,
    title: node.summary?.originalText ?? "",
    text: node.text?.originalText?.plainText ?? "",
    spoiler: !!node.spoiler,
    url: `https://www.imdb.com/review/${node.id}/`,
  }));
  const cursor = list.pageInfo?.endCursor ?? "";
  return { reviews, next: list.pageInfo?.hasNextPage && cursor ? cursor : null, failed: false };
}

async function traktCommentsPage(
  seriesImdbId: string,
  season: number,
  episode: number,
  page: number,
  sort: EpisodeReviewSort,
): Promise<{ reviews: EpisodeReview[]; next: number | null; failed: boolean }> {
  const target = {
    kind: "episode" as const,
    show: { ids: { imdb: seriesImdbId } },
    season,
    number: episode,
  };
  try {
    const comments = await fetchCommentsStrict(target, TRAKT_REVIEW_SORT[sort], page, TRAKT_PAGE);
    const reviews = comments.map((c): EpisodeReview => ({
      id: `trakt:${c.id}`,
      source: "trakt",
      author: c.user.name || c.user.username,
      avatar: c.user.avatar,
      rating: c.userRating,
      date: c.createdAt,
      likes: c.likes,
      title: "",
      text: c.comment,
      spoiler: c.spoiler,
      url: `https://trakt.tv/comments/${c.id}`,
    }));
    return { reviews, next: comments.length < TRAKT_PAGE ? null : page + 1, failed: false };
  } catch {
    return { reviews: [], next: page, failed: true };
  }
}

const FIRST_PAGE: EpisodeReviewsCursor = { imdb: "", trakt: 1 };

/**
 * One page of an episode's reviews from each source still going; start without a cursor.
 * `episodeImdbId`, when the caller already knows the episode's own IMDb id, skips the lookup.
 */
export async function fetchEpisodeReviews(
  seriesImdbId: string,
  season: number,
  episode: number,
  cursor: EpisodeReviewsCursor = FIRST_PAGE,
  episodeImdbId?: string | null,
  sort: EpisodeReviewSort = "liked",
): Promise<EpisodeReviewsPage> {
  if (!episodeReviewsTarget(seriesImdbId, season, episode))
    return { reviews: [], next: null, failed: [] };

  const imdbPromise = async (): Promise<{ reviews: EpisodeReview[]; next: string | null; failed: boolean }> => {
    if (cursor.imdb == null) return { reviews: [], next: null, failed: false };
    if (episodeImdbId && IMDB_ID.test(episodeImdbId))
      return imdbReviewsPage(episodeImdbId, cursor.imdb, sort);
    const lookup = await imdbEpisodeLookup(seriesImdbId, season, episode);
    if (lookup.failed) return { reviews: [], next: cursor.imdb, failed: true };
    if (!lookup.id) return { reviews: [], next: null, failed: false };
    return imdbReviewsPage(lookup.id, cursor.imdb, sort);
  };

  const [imdb, trakt] = await Promise.all([
    imdbPromise(),
    cursor.trakt == null
      ? Promise.resolve({ reviews: [], next: null, failed: false })
      : traktCommentsPage(seriesImdbId, season, episode, cursor.trakt, sort),
  ]);
  const next = { imdb: imdb.next, trakt: trakt.next };
  const failed: EpisodeReviewSource[] = [
    ...(imdb.failed ? (["imdb"] as const) : []),
    ...(trakt.failed ? (["trakt"] as const) : []),
  ];
  return {
    reviews: [...imdb.reviews, ...trakt.reviews].filter((r) => r.text.trim()),
    next: next.imdb == null && next.trakt == null ? null : next,
    failed,
  };
}

/** Mean of the reviewers' own ratings, 1-10. */
export function reviewersAverage(reviews: EpisodeReview[]): number | null {
  const ratings = reviews.map((r) => r.rating).filter((v): v is number => v != null);
  return ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
}

export function sortEpisodeReviews(
  reviews: EpisodeReview[],
  sort: EpisodeReviewSort,
): EpisodeReview[] {
  const time = (r: EpisodeReview) => (r.date ? Date.parse(r.date) || 0 : 0);
  const key: Record<EpisodeReviewSort, (a: EpisodeReview, b: EpisodeReview) => number> = {
    liked: (a, b) => b.likes - a.likes,
    recent: (a, b) => time(b) - time(a),
    // Unrated reviews go last in both rating orders.
    highest: (a, b) => (b.rating ?? -1) - (a.rating ?? -1),
    lowest: (a, b) => (a.rating ?? 11) - (b.rating ?? 11),
    longest: (a, b) => b.text.length - a.text.length,
  };
  return [...reviews].sort(key[sort]);
}
