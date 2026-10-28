export type MovieRelease = { kind: "cinema" | "digital"; date: string; country: string };
export type MovieReleaseGroup = {
  iso_3166_1: string;
  release_dates: Array<{ type: number; release_date: string }>;
};

export function movieReleaseDates(groups: MovieReleaseGroup[], region: string): MovieRelease[] {
  const result: MovieRelease[] = [];
  for (const kind of ["cinema", "digital"] as const) {
    const candidates = groups.flatMap((group) =>
      group.release_dates
        .filter(
          (release) =>
            (kind === "digital" ? release.type === 4 : release.type === 2 || release.type === 3) &&
            Number.isFinite(Date.parse(release.release_date)),
        )
        .map((release) => ({
          kind,
          date: release.release_date.slice(0, 10),
          country: group.iso_3166_1,
        })),
    );
    const local = candidates.filter((release) => release.country === region.toUpperCase());
    const pool = local.length ? local : candidates;
    pool.sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country));
    if (pool[0]) result.push(pool[0]);
  }
  return result;
}
