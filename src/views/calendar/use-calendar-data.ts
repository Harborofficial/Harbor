import { useEffect, useRef, useState } from "react";
import { monthRangeISO, type CalendarItem } from "@/lib/calendar-core";
import type { Settings } from "@/lib/settings";
import { t } from "@/lib/i18n";

type Args = {
  source: Settings["calendarSource"];
  authKey: string | null;
  traktConnected: boolean;
  simklConnected: boolean;
  settings: Settings;
  year: number;
  month: number;
  animeDub: boolean;
};

export function useCalendarData({
  source,
  authKey,
  traktConnected,
  simklConnected,
  settings,
  year,
  month,
  animeDub,
}: Args) {
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevSourceRef = useRef(source);

  if (prevSourceRef.current !== source) {
    prevSourceRef.current = source;
    setItems([]);
    setLoading(true);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const run = (p: Promise<CalendarItem[]>) => {
      setLoading(true);
      p.then((rows) => {
        if (!cancelled) setItems(rows);
      })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : t("Failed to load"));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    const stop = () => {
      setItems([]);
      setLoading(false);
    };

    const dispatch = () => {
      if (source === "games") return stop();
      if (source === "library") {
        if (!authKey) return stop();
        return run(
          import("@/lib/calendar-library").then(({ fetchLibraryCalendar }) =>
            fetchLibraryCalendar(authKey, year, month, {
              tmdbKey: settings.tmdbKey,
              includeTrakt: traktConnected,
              onProgress: (rows) => {
                if (!cancelled) setItems(rows);
              },
            }),
          ),
        );
      }
      if (source === "trakt") {
        if (!traktConnected) return stop();
        return run(
          import("@/lib/calendar-sources").then(({ fetchTraktCalendar }) =>
            fetchTraktCalendar(year, month),
          ),
        );
      }
      if (source === "simkl") {
        if (!simklConnected) return stop();
        return run(
          import("@/lib/calendar-sources").then(({ fetchSimklCalendar }) =>
            fetchSimklCalendar(year, month, { tmdbKey: settings.tmdbKey }),
          ),
        );
      }
      if (source === "simkl-anticipated") {
        return run(
          import("@/lib/calendar-sources").then(({ fetchSimklPremieresCalendar }) =>
            fetchSimklPremieresCalendar(year, month),
          ),
        );
      }
      if (source === "anime") {
        return run(
          import("@/lib/calendar-sources").then((sources) =>
            animeDub
              ? sources.fetchAnimeDubCalendar(year, month)
              : sources.fetchAniListAiringCalendar(year, month),
          ),
        );
      }
      if (source === "anticipated") {
        return run(
          import("@/lib/calendar-sources").then(({ fetchAnticipatedCalendar }) =>
            fetchAnticipatedCalendar(year, month),
          ),
        );
      }
      if (source === "custom") {
        if (!settings.tmdbKey) return stop();
        const { start, end } = monthRangeISO(year, month);
        const extras: Promise<CalendarItem[]>[] = [];
        if (settings.customCalendar.includeTraktAnticipated) {
          extras.push(
            import("@/lib/calendar-sources")
              .then(({ fetchAnticipatedCalendar }) => fetchAnticipatedCalendar(year, month))
              .catch(() => []),
          );
        }
        if (settings.customCalendar.includeTraktWatchlist && traktConnected) {
          extras.push(
            import("@/lib/calendar-sources")
              .then(({ fetchTraktCalendar }) => fetchTraktCalendar(year, month))
              .catch(() => []),
          );
        }
        return run(
          Promise.all(extras)
            .then((batches) => batches.flat())
            .then((extra) =>
              import("@/lib/calendar").then(({ fetchCustomCalendar }) => fetchCustomCalendar({
                apiKey: settings.tmdbKey,
                region: settings.region,
                filters: {
                  trackedPeople: settings.customCalendar.trackedPeople,
                  genres: settings.customCalendar.genres,
                  watchProviders: settings.customCalendar.watchProviders,
                  originCountries: settings.customCalendar.originCountries,
                  mediaTypes: settings.customCalendar.mediaTypes,
                },
                start,
                end,
                extra,
              })),
            ),
        );
      }
      if (!settings.tmdbKey) return stop();
      const { start, end } = monthRangeISO(year, month);
      return run(
        import("@/lib/calendar").then(({ fetchCalendarRange }) =>
          fetchCalendarRange(settings.tmdbKey, start, end, settings.region),
        ),
      );
    };

    dispatch();
    return () => {
      cancelled = true;
    };
  }, [
    source,
    authKey,
    traktConnected,
    simklConnected,
    settings.tmdbKey,
    settings.region,
    settings.customCalendar.trackedPeople,
    settings.customCalendar.includeTraktAnticipated,
    settings.customCalendar.includeTraktWatchlist,
    year,
    month,
    animeDub,
  ]);

  useEffect(() => {
    if (!simklConnected || source === "games" || source === "simkl-anticipated" || loading) return;
    const timer = window.setTimeout(() => {
      void import("@/lib/calendar-sources")
        .then(({ fetchSimklPremieresCalendar }) => fetchSimklPremieresCalendar(year, month))
        .catch(() => {});
    }, 250);
    return () => window.clearTimeout(timer);
  }, [simklConnected, year, month, source, loading]);

  return { items, loading, error };
}
