import type { Meta } from "@/lib/cinemeta";

export type BadgeTone = "default" | "accent";

export function deriveBadge(meta: Meta): { label: string; tone?: BadgeTone } | null {
  return meta.releaseInfo === String(new Date().getFullYear()) ? { label: "New" } : null;
}

export function isInCinema(meta: Meta): boolean {
  return meta.type === "movie" && meta.inTheaters === true;
}

export function isRerun(meta: Meta): boolean {
  if (meta.type !== "movie" || !meta.releaseDate) return false;
  const released = Date.parse(meta.releaseDate);
  return !Number.isNaN(released) && (Date.now() - released) / (1000 * 60 * 60 * 24 * 30.44) > 9;
}
