import { useEffect, useMemo, useState } from "react";
import { isFranchiseExtra, type FranchiseEntry } from "@/lib/providers/anime-detail";
import { useSettings } from "@/lib/settings";
import { fetchEntryEpisodes } from "@/lib/providers/anime-franchise-episodes";
import { parseKitsuId, type KitsuEpisode } from "@/lib/providers/kitsu";

export function useFranchiseEpisodes(
  franchise: FranchiseEntry[],
  currentId: string,
  currentEpisodes: KitsuEpisode[],
  enabled: boolean,
): KitsuEpisode[] {
  const { settings } = useSettings();
  const otherIds = useMemo(() => {
    if (!enabled || franchise.length <= 1) return [] as number[];
    const current = franchise.find((f) => f.meta.id === currentId);
    if (current && isFranchiseExtra(current)) return [] as number[];
    const ids: number[] = [];
    for (const f of franchise) {
      if (f.meta.id === currentId || isFranchiseExtra(f)) continue;
      const id = parseKitsuId(f.meta.id);
      if (id != null && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }, [enabled, franchise, currentId]);

  const sig = otherIds.join(",");
  const scope = JSON.stringify([
    currentId,
    sig,
    settings.tmdbLanguage,
    settings.uiLanguage,
    settings.tmdbKey,
    settings.tvdbKey,
  ]);
  const [loaded, setLoaded] = useState<{ scope: string; episodes: KitsuEpisode[] } | null>(null);
  const extra = loaded?.scope === scope ? loaded.episodes : [];
  useEffect(() => {
    if (otherIds.length === 0) {
      return;
    }
    let cancelled = false;
    const lists: KitsuEpisode[][] = Array.from({ length: otherIds.length }, () => []);
    let next = 0;
    const worker = async () => {
      while (!cancelled && next < otherIds.length) {
        const index = next++;
        lists[index] = await fetchEntryEpisodes(otherIds[index], settings).catch(
          () => [] as KitsuEpisode[],
        );
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, otherIds.length) }, worker)).then(() => {
      if (!cancelled) setLoaded({ scope, episodes: lists.flat() });
    });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  return useMemo(() => {
    if (!enabled || otherIds.length === 0 || extra.length === 0) return currentEpisodes;
    const keyOf = (ep: KitsuEpisode) =>
      ep.imdbSeason != null && ep.imdbEpisode != null
        ? `${ep.sourceMetaId ?? "cur"}|s${ep.imdbSeason}e${ep.imdbEpisode}`
        : `${ep.sourceMetaId ?? "cur"}:${ep.id}`;
    const seen = new Set<string>();
    const combined: KitsuEpisode[] = [];
    for (const ep of currentEpisodes) {
      const k = keyOf(ep);
      if (seen.has(k)) continue;
      seen.add(k);
      combined.push(ep);
    }
    for (const ep of extra) {
      const k = keyOf(ep);
      if (seen.has(k)) continue;
      seen.add(k);
      combined.push(ep);
    }
    combined.sort(
      (a, b) =>
        (a.imdbSeason ?? 99) - (b.imdbSeason ?? 99) ||
        (a.imdbEpisode ?? a.number) - (b.imdbEpisode ?? b.number) ||
        (a.absoluteNumber ?? a.number) - (b.absoluteNumber ?? b.number),
    );
    return combined;
  }, [enabled, otherIds.length, currentEpisodes, extra]);
}
