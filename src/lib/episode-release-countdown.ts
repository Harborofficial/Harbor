export type EpisodeReleaseCountdown =
  | { kind: "days"; days: number }
  | { kind: "time"; days: number; hours: number; minutes: number };

export function episodeReleaseCountdown(
  value: string | null | undefined,
  now = Date.now(),
): EpisodeReleaseCountdown | null {
  if (!value || !Number.isFinite(now)) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month ||
    calendarDate.getUTCDate() !== day
  )
    return null;

  // Providers often encode a date-only release as midnight UTC. Do not turn
  // that placeholder (or a time without a timezone) into an exact countdown.
  const exact =
    /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
    !/T00:00(?::00(?:\.0+)?)?Z$/i.test(value);
  if (exact) {
    const remaining = Date.parse(value) - now;
    if (!Number.isFinite(remaining) || remaining <= 0) return null;
    const totalMinutes = Math.ceil(remaining / 60000);
    return {
      kind: "time",
      days: Math.floor(totalMinutes / 1440),
      hours: Math.floor((totalMinutes % 1440) / 60),
      minutes: totalMinutes % 60,
    };
  }
  if (value.length !== 10 && !Number.isFinite(Date.parse(value))) return null;
  const today = new Date(now);
  const days = Math.round(
    (calendarDate.getTime() - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      86400000,
  );
  return days > 0 ? { kind: "days", days } : null;
}
