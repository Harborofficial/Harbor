import { kitsuMappingRequest } from "./kitsu";

type Mapping = {
  type?: string;
  attributes?: { externalSite?: string; externalId?: string };
  relationships?: { item?: { data?: { type?: string; id?: string } } };
};

type MappingDocument = {
  data?: Mapping[];
  links?: { next?: string | null };
  meta?: { count?: number };
};

export type KitsuExternalSite = "anilist/anime" | "myanimelist/anime";

function positiveId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function complete(doc: MappingDocument | null): doc is MappingDocument & { data: Mapping[] } {
  return (
    !!doc &&
    Array.isArray(doc.data) &&
    doc.links?.next == null &&
    (doc.meta?.count == null || doc.meta.count === doc.data.length)
  );
}

export async function kitsuFromExternal(
  site: KitsuExternalSite,
  id: number,
  maxAge?: number,
): Promise<number | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const query = new URLSearchParams({
    "filter[externalSite]": site,
    "filter[externalId]": String(id),
    include: "item",
    "fields[anime]": "canonicalTitle",
    "page[limit]": "20",
  });
  const doc = await kitsuMappingRequest<MappingDocument>(`/mappings?${query}`, maxAge);
  if (!complete(doc)) throw new Error("Incomplete Kitsu mapping response");
  const candidates = new Set<number>();
  for (const row of doc.data) {
    if (!row || typeof row !== "object") throw new Error("Invalid Kitsu mapping");
    const item = row.relationships?.item?.data;
    const candidate = positiveId(item?.id);
    if (
      row.type !== "mappings" ||
      row.attributes?.externalSite !== site ||
      row.attributes.externalId !== String(id) ||
      item?.type !== "anime" ||
      candidate == null
    )
      throw new Error("Conflicting Kitsu mapping");
    candidates.add(candidate);
  }
  if (candidates.size > 1) throw new Error("Ambiguous Kitsu mapping");
  return candidates.size === 1 ? [...candidates][0] : null;
}

export async function kitsuExternalIds(
  kitsuId: number,
  maxAge?: number,
): Promise<{ anilist?: number; mal?: number } | null> {
  if (!Number.isSafeInteger(kitsuId) || kitsuId <= 0) return null;
  const doc = await kitsuMappingRequest<MappingDocument>(
    `/anime/${kitsuId}/mappings?page%5Blimit%5D=20`,
    maxAge,
  );
  if (!complete(doc)) return null;
  const ids: { anilist?: number; mal?: number } = {};
  for (const row of doc.data) {
    if (!row || row.type !== "mappings" || !row.attributes) return null;
    const item = row.relationships?.item?.data;
    if (item && (item.type !== "anime" || positiveId(item.id) !== kitsuId)) return null;
    const key =
      row.attributes.externalSite === "anilist/anime"
        ? "anilist"
        : row.attributes.externalSite === "myanimelist/anime"
          ? "mal"
          : null;
    if (!key) continue;
    const id = positiveId(row.attributes.externalId);
    if (id == null || (ids[key] != null && ids[key] !== id)) return null;
    ids[key] = id;
  }
  return ids;
}
