export type CalendarItem = {
  id: string;
  imdbId?: string | null;
  type: "movie" | "tv";
  name: string;
  poster: string | null;
  background: string | null;
  releaseDate: string;
  releaseTime?: string;
  releaseAtMs?: number;
  isAnime: boolean;
  overview: string;
  voteAverage: number;
};

export type CalendarFilter = "all" | "movie" | "tv" | "anime";
export type CalendarPosterSize = "default" | "large";

export function applyCalendarFilter(items: CalendarItem[], filter: CalendarFilter): CalendarItem[] {
  if (filter === "all") return items;
  if (filter === "anime") return items.filter((i) => i.isAnime);
  if (filter === "movie") return items.filter((i) => i.type === "movie" && !i.isAnime);
  return items.filter((i) => i.type === "tv" && !i.isAnime);
}

export function groupByDate(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const out = new Map<string, CalendarItem[]>();
  for (const item of items) {
    if (!item.releaseDate) continue;
    const list = out.get(item.releaseDate) ?? [];
    list.push(item);
    out.set(item.releaseDate, list);
  }
  return out;
}

export function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthRangeISO(year: number, month: number): { start: string; end: string } {
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0);
  const start = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
  return { start, end };
}
