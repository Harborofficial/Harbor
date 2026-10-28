import { parseGroupListUrl } from "@/lib/library-groups";
import { traktRequest, TraktApiError } from "@/lib/trakt/client";
import { getSession } from "@/lib/trakt/session";
import { traktItemToMeta } from "@/lib/trakt/to-meta";
import type { TraktItem } from "@/lib/trakt/types";
import { fetchMdblistPage, type MdblistPage } from "./mdblist-lists";

type TraktRow = {
  type: "movie" | "show";
  movie?: { title: string; year: number; ids: TraktItem["ids"] };
  show?: { title: string; year: number; ids: TraktItem["ids"] };
};
const cache = new Map<string, { expires: number; page: MdblistPage }>();

export async function fetchGroupListPage(
  key: string,
  url: string,
  cursor?: string,
  refresh = false,
): Promise<MdblistPage> {
  const parsed = parseGroupListUrl(url);
  if (!parsed) throw new Error("Enter an MDBList or Trakt list URL.");
  if (parsed.source === "mdblist") return fetchMdblistPage(key, parsed.url, cursor, refresh);
  const session = getSession();
  const ck = JSON.stringify([parsed.path, cursor, session?.accessToken]);
  const hit = cache.get(ck);
  if (!refresh && hit && hit.expires > Date.now()) return hit.page;
  const pageNumber = cursor ? Number(cursor) : 1;
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new Error("Invalid list page.");
  try {
    const rows = await traktRequest<TraktRow[]>(
      `/${parsed.path}/items?page=${pageNumber}&limit=100`,
      { authed: !!session },
    );
    if (!Array.isArray(rows)) throw new Error("Invalid Trakt list response.");
    const items = rows.flatMap((row) => {
      const item = row.type === "movie" ? row.movie : row.type === "show" ? row.show : undefined;
      if (!item) return [];
      const meta = traktItemToMeta({
        type: row.type,
        title: item.title,
        year: item.year,
        ids: item.ids,
      });
      if (!meta) return [];
      if (item.ids.imdb)
        meta.poster = `https://images.metahub.space/poster/medium/${item.ids.imdb}/img`;
      return [meta];
    });
    const page = { items, cursor: rows.length === 100 ? String(pageNumber + 1) : undefined };
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(ck, { page, expires: Date.now() + 15 * 60000 });
    return page;
  } catch (error) {
    if (error instanceof TraktApiError) {
      if ([401, 403, 404].includes(error.status))
        throw new Error(
          "Trakt list not found or private. Connect the owning Trakt account in Settings.",
        );
      if (error.status === 429)
        throw new Error("Trakt rate limit reached. Please try again later.");
    }
    throw new Error("Could not load this Trakt list. Please try again.");
  }
}
