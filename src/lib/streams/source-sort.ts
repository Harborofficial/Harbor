export type SourceSort = "default" | "size-desc" | "size-asc" | "seeders-desc";

export const SOURCE_SORTS: readonly SourceSort[] = [
  "default",
  "size-desc",
  "size-asc",
  "seeders-desc",
];

type Sortable = { size: number | null; seeders: number | null };

function sizeOf(stream: Sortable): number | null {
  return stream.size != null && stream.size > 0 ? stream.size : null;
}

function seedersOf(stream: Sortable): number | null {
  return stream.seeders != null && stream.seeders >= 0 ? stream.seeders : null;
}

/** Stable sort; streams without the sorted value always stay at the end. */
export function sortStreams<T extends Sortable>(streams: T[], order: SourceSort): T[] {
  const pick =
    order === "size-desc" || order === "size-asc"
      ? sizeOf
      : order === "seeders-desc"
        ? seedersOf
        : null;
  if (!pick) return streams;
  const direction = order === "size-asc" ? 1 : -1;
  return streams.slice().sort((a, b) => {
    const av = pick(a);
    const bv = pick(b);
    if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
    return (av - bv) * direction;
  });
}
