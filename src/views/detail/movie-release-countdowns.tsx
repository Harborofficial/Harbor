import { EpisodeReleaseCountdown } from "@/components/episode-release-countdown";
import { formatAirDate } from "@/lib/dates";
import { episodeReleaseCountdown } from "@/lib/episode-release-countdown";
import { useT } from "@/lib/i18n";
import type { TmdbDetail } from "@/lib/providers/tmdb";

export function MovieReleaseCountdowns({ detail }: { detail: TmdbDetail | null }) {
  const t = useT();
  if (detail?.kind !== "movie") return null;
  const releases = detail.movieReleases ?? [];
  if (!releases.some((release) => episodeReleaseCountdown(release.date))) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-ink-muted">
      {releases.map((release) => (
        <div key={release.kind} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{release.kind === "cinema" ? t("Cinema release") : t("Digital release")}</span>
          <span className="text-ink-subtle">
            {release.country} · {formatAirDate(release.date)}
          </span>
          <EpisodeReleaseCountdown date={release.date} />
        </div>
      ))}
    </div>
  );
}
