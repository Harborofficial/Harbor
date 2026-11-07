import { pmdbRequest } from "./client";
import { isAuthenticated } from "./session";
import type { PmdbTarget } from "./types";

type PmdbDropResponse = { success?: boolean } | undefined;

/** Mark a TV show as dropped in PublicMetaDB's native progress state. */
export async function dropPmdbShow(
  target: PmdbTarget,
  options: { assertCurrent?: () => void } = {},
): Promise<boolean> {
  options.assertCurrent?.();
  if (!isAuthenticated()) return false;
  if (
    target.media_type !== "tv" ||
    !Number.isInteger(target.tmdb_id) ||
    (target.tmdb_id ?? 0) <= 0
  )
    return false;

  try {
    const response = await pmdbRequest<PmdbDropResponse>("/api/external/dropped", {
      method: "POST",
      body: { tmdb_id: target.tmdb_id, media_type: "tv" },
    });
    options.assertCurrent?.();
    return response?.success !== false;
  } catch (error) {
    options.assertCurrent?.();
    console.error("Failed to drop PublicMetaDB show:", error);
    return false;
  }
}
