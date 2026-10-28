import { lruGet, lruSet } from "@/lib/cache";
import { simklRequest } from "./client";
import { yieldToBrowser } from "@/lib/yield-to-browser";

export type SimklTitleDetail = {
  title?: string;
  poster?: string;
  year?: number;
  relations?: Array<{
    is_direct?: boolean;
    ids?: { simkl_id?: number };
  }>;
};

const cache = new Map<string, { data: SimklTitleDetail; expiresAt: number }>();
const inflight = new Map<string, Promise<SimklTitleDetail>>();
const TTL_MS = 30 * 60_000;

/** Public metadata is shared by franchise grouping, rail hydration and poster fallbacks. */
export function simklTitleDetail(
  id: string | number,
  kind: "anime" | "movie" = "anime",
): Promise<SimklTitleDetail> {
  const path = `/${kind === "movie" ? "movies" : "anime"}/${id}`;
  const hit = lruGet(cache, path);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data);
  const pending = inflight.get(path);
  if (pending) return pending;
  const request = simklRequest<SimklTitleDetail>(path, { method: "GET", authed: false })
    .then(async (data) => {
      lruSet(cache, path, { data, expiresAt: Date.now() + TTL_MS }, 500);
      // Let pending input/paint run before relation grouping and rail hydration
      // continue from this response's microtask chain.
      await yieldToBrowser();
      return data;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, request);
  return request;
}
