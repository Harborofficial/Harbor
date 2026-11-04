import { useCallback, useEffect, useMemo, useState } from "react";
import { dismissEpisodes, isDismissed, newEpisodesFor, type NewEpisode } from "@/lib/new-episodes";
import { useSettings } from "@/lib/settings";
import { useProfiles } from "@/lib/profiles";
import { resolveNuvioProfileIndex } from "@/lib/nuvio/nuvio-sync";
import type { LibraryItem } from "@/lib/stremio";

const MAX_SERIES = 40;
const MAX_CARDS = 60;

export function useNewEpisodes(items: LibraryItem[], enabled: boolean) {
  const { settings } = useSettings();
  const { activeProfile } = useProfiles();
  const isNuvio = settings.accountProvider === "nuvio";
  const scopeKey = isNuvio
    ? `nuvio.${resolveNuvioProfileIndex()}`
    : `stremio.${activeProfile?.id ?? "default"}`;

  const [found, setFound] = useState<NewEpisode[]>([]);
  const [dismissedVer, setDismissedVer] = useState(0);

  const series = useMemo(
    () => items.filter((i) => i.type === "series" && i._id.startsWith("tt")).slice(0, MAX_SERIES),
    [items],
  );

  const signature = useMemo(
    () => series.map((s) => `${s._id}|${s.state?.lastWatched ?? s._mtime ?? ""}`).join(","),
    [series],
  );

  useEffect(() => {
    if (!enabled || series.length === 0) {
      setFound([]);
      return;
    }
    let cancelled = false;

    void Promise.all(series.map((s) => newEpisodesFor(s).catch(() => [])))
      .then((lists) => {
        if (cancelled) return;
        const flat = lists.flat();
        const seen = new Set<string>();
        const unique: NewEpisode[] = [];
        for (const ep of flat) {
          if (seen.has(ep.key)) continue;
          seen.add(ep.key);
          unique.push(ep);
        }
        unique.sort((a, b) => b.released - a.released);
        setFound(unique.slice(0, MAX_CARDS));
      })
      .catch(() => {
        if (!cancelled) setFound([]);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, signature, series.length]);

  const episodes = useMemo(() => {
    void dismissedVer;
    return found.filter((ep) => !isDismissed(ep.key, scopeKey));
  }, [found, dismissedVer, scopeKey]);

  const dismissOne = useCallback(
    (key: string) => {
      dismissEpisodes([key], scopeKey);
      setDismissedVer((v) => v + 1);
    },
    [scopeKey],
  );

  const dismissAll = useCallback(() => {
    setFound((current) => {
      dismissEpisodes(
        current.map((ep) => ep.key),
        scopeKey,
      );
      return current;
    });
    setDismissedVer((v) => v + 1);
  }, [scopeKey]);

  return { episodes, dismissOne, dismissAll };
}
