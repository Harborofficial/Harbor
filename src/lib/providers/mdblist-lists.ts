import type { Meta } from "@/lib/cinemeta";
import { parseMdblistUrl } from "@/lib/library-groups";
import { safeFetch } from "@/lib/safe-fetch";

type RawItem = {
  id?: number;
  imdb_id?: string;
  ids?: { imdb?: string; tmdb?: number };
  title?: string;
  mediatype?: string;
  poster?: string;
  description?: string;
  release_year?: number;
  rank?: number;
};
export type MdblistPage = { items: Meta[]; cursor?: string };

export function parseMdblistPage(value: unknown): MdblistPage {
  if (!value || typeof value !== "object") throw new Error("Invalid MDBList response");
  const raw = value as {
    movies?: RawItem[];
    shows?: RawItem[];
    items?: RawItem[];
    pagination?: { next_cursor?: string };
    next_cursor?: string;
  };
  if (![raw.movies, raw.shows, raw.items].some(Array.isArray))
    throw new Error("Invalid MDBList response");
  const rows = [
    ...(Array.isArray(raw.movies)
      ? raw.movies.map((item) => ({ ...item, mediatype: "movie" }))
      : []),
    ...(Array.isArray(raw.shows) ? raw.shows.map((item) => ({ ...item, mediatype: "show" })) : []),
    ...(Array.isArray(raw.items) ? raw.items : []),
  ].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const seen = new Set<string>();
  const items: Meta[] = [];
  for (const item of rows) {
    if (!item || !["movie", "show"].includes(item.mediatype ?? "")) continue;
    const type = item.mediatype === "movie" ? "movie" : "series";
    const imdb = item.ids?.imdb ?? item.imdb_id;
    const tmdb = item.ids?.tmdb ?? item.id;
    const id =
      imdb && /^tt\d+$/.test(imdb)
        ? imdb
        : typeof tmdb === "number" && tmdb > 0
          ? `tmdb:${type === "movie" ? "movie" : "tv"}:${tmdb}`
          : undefined;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      type,
      name: item.title ?? id,
      poster: typeof item.poster === "string" ? item.poster : undefined,
      description: item.description,
      releaseInfo: item.release_year ? String(item.release_year) : undefined,
    });
  }
  const cursor = raw.pagination?.next_cursor ?? raw.next_cursor;
  return { items, cursor: typeof cursor === "string" && cursor ? cursor : undefined };
}

const cache = new Map<string, { page: MdblistPage; expires: number }>();
const inflight = new Map<string, Promise<MdblistPage>>();
export function fetchMdblistPage(
  key: string,
  listUrl: string,
  cursor?: string,
  refresh = false,
): Promise<MdblistPage> {
  if (!key.trim())
    return Promise.reject(
      new Error("Add an MDBList API key in Settings → Library → Metadata providers."),
    );
  const parsed = parseMdblistUrl(listUrl);
  if (!parsed) return Promise.reject(new Error("Enter a valid MDBList list URL."));
  const ck = JSON.stringify([key, parsed.path, cursor]);
  const hit = cache.get(ck);
  if (!refresh && hit && hit.expires > Date.now()) return Promise.resolve(hit.page);
  const pending = inflight.get(ck);
  if (pending) return pending;
  const task = (async () => {
    const url = new URL(`https://api.mdblist.com/${parsed.path}/items`);
    url.searchParams.set("apikey", key.trim());
    url.searchParams.set("limit", "100");
    url.searchParams.set("append_to_response", "poster,description");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await safeFetch(url.toString());
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new Error("MDBList rejected the API key or this list is private.");
      if (response.status === 404) throw new Error("MDBList list not found.");
      if (response.status === 429)
        throw new Error("MDBList rate limit reached. Please try again later.");
      throw new Error("Could not load this MDBList list. Please try again.");
    }
    const page = parseMdblistPage(await response.json());
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(ck, { page, expires: Date.now() + 15 * 60000 });
    return page;
  })().finally(() => inflight.delete(ck));
  inflight.set(ck, task);
  return task;
}
