import type { Meta } from "@/lib/cinemeta";
import {
  loadMedia,
  readMedia,
  saveMedia,
  episodeCacheTtl,
  MEDIA_TTL,
  onMediaCacheClear,
  mediaCacheGeneration,
} from "./media-cache";

const LEGACY_KEY = "harbor.cinemeta.meta.v1";
export type MetaLoad = { value: Meta | null; cacheable: boolean };

onMediaCacheClear(() => {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* Storage may be unavailable. */
  }
});

export async function withMetaCache(
  type: "movie" | "series",
  id: string,
  loader: () => Promise<MetaLoad>,
): Promise<Meta | null> {
  const scope = [type, id];
  const generation = mediaCacheGeneration();
  const policy = {
    ttl: (entry: MetaLoad) =>
      !entry.value
        ? 60_000
        : type === "movie"
          ? MEDIA_TTL.settled
          : episodeCacheTtl(entry.value.videos ?? []),
    valid: (entry: MetaLoad) =>
      entry?.cacheable === true &&
      (entry.value === null ||
        (typeof entry.value === "object" &&
          entry.value.id === id &&
          (entry.value.videos === undefined || Array.isArray(entry.value.videos)))),
  };
  if (!(await readMedia("cinemeta-meta", scope))) {
    try {
      const entries = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "{}") as Record<
        string,
        { t: number; m: Meta | null }
      >;
      const key = `${type}:${id}`;
      const old = entries[key];
      if (
        old &&
        Number.isFinite(old.t) &&
        old.t <= Date.now() &&
        Date.now() - old.t < MEDIA_TTL.stale &&
        old.m?.id === id
      ) {
        if (
          await saveMedia(
            "cinemeta-meta",
            scope,
            { value: old.m, cacheable: true },
            policy,
            old.t,
            generation,
          )
        ) {
          // Re-read after the committed write so concurrent migrations retain each other.
          const latest = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "{}");
          delete latest[key];
          if (Object.keys(latest).length) localStorage.setItem(LEGACY_KEY, JSON.stringify(latest));
          else localStorage.removeItem(LEGACY_KEY);
        }
      }
    } catch {
      /* A legacy cache cannot prevent a provider request. */
    }
  }
  if (generation !== mediaCacheGeneration()) return null;
  let uncached: Meta | null = null;
  const result = await loadMedia(
    "cinemeta-meta",
    scope,
    async () => {
      const entry = await loader();
      uncached = entry.value;
      return entry;
    },
    policy,
  );
  return result.value?.value ?? uncached;
}
