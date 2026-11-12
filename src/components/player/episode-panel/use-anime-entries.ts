import { useCallback, useEffect, useMemo, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import type { AnimeKitsuMeta } from "@/lib/providers/anime-kitsu-addon";
import { animeKitsuMeta } from "@/lib/providers/anime-kitsu-addon";
import { nextAnimeEntry, previousAnimeEntry } from "@/lib/providers/anime-entry";
import { animeSeriesFromStreamId, isAnimeId } from "@/lib/series-episodes";
import type { PlayEpisode } from "@/lib/view";

export type AnimeEntryRef = { id: string; meta: Meta };

function entryMeta(id: string, meta: AnimeKitsuMeta | null): Meta {
  return meta ? { ...meta, id } : { id, type: "series", name: id };
}

/**
 * Walk the current entry's franchise in both directions. Cours are separate
 * Kitsu entries, so this chain, not the entry's TVDB seasons, is the season
 * selector's list.
 */
async function animeEntryChain(currentId: string, currentMeta: Meta): Promise<AnimeEntryRef[]> {
  const seen = new Set<string>([currentId]);
  const backward: AnimeEntryRef[] = [];
  let cursor = currentId;
  for (let step = 0; step < 10; step += 1) {
    const previous = await previousAnimeEntry(cursor).catch(() => null);
    if (!previous || seen.has(previous.id)) break;
    seen.add(previous.id);
    backward.unshift({ id: previous.id, meta: entryMeta(previous.id, previous.meta) });
    cursor = previous.id;
  }

  let current: AnimeEntryRef;
  if (currentId === currentMeta.id) {
    current = { id: currentId, meta: currentMeta };
  } else {
    const fetched = await animeKitsuMeta(currentId).catch(() => null);
    current = {
      id: currentId,
      meta: fetched ? { ...fetched, id: currentId } : { ...currentMeta, id: currentId },
    };
  }

  const forward: AnimeEntryRef[] = [];
  cursor = currentId;
  for (let step = 0; step < 20; step += 1) {
    const next = await nextAnimeEntry(cursor).catch(() => null);
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    forward.push({ id: next.id, meta: entryMeta(next.id, next.meta) });
    cursor = next.id;
  }

  return [...backward, current, ...forward];
}

/**
 * The entry being browsed in the player panel and its franchise neighbours.
 *
 * `browse` switches the episode list to another entry without changing what is
 * currently playing. The chain is built for the playing entry, so browsing
 * does not re-fetch it.
 */
export function useAnimeEntryBrowser(
  meta: Meta,
  current: PlayEpisode | undefined,
  open: boolean,
): {
  activeId: string | null;
  activeMeta: Meta | null;
  entries: AnimeEntryRef[];
  prevEntry: AnimeEntryRef | null;
  nextEntry: AnimeEntryRef | null;
  browsing: boolean;
  browse: (id: string) => void;
} {
  const currentEntryId = useMemo(() => {
    const fromStream = animeSeriesFromStreamId(current?.kitsuStreamId);
    if (fromStream) return fromStream;
    return isAnimeId(meta.id) ? meta.id : null;
  }, [meta.id, current?.kitsuStreamId]);
  const [browseId, setBrowseId] = useState<string | null>(null);
  const [chain, setChain] = useState<{ id: string; entries: AnimeEntryRef[] } | null>(null);

  useEffect(() => {
    setBrowseId(null);
  }, [currentEntryId, meta.id, current?.season, current?.episode]);

  useEffect(() => {
    if (!open) setBrowseId(null);
  }, [open]);

  useEffect(() => {
    if (!open || currentEntryId == null) {
      setChain(null);
      return;
    }
    let cancelled = false;
    void animeEntryChain(currentEntryId, meta).then((entries) => {
      if (!cancelled) setChain({ id: currentEntryId, entries });
    });
    return () => {
      cancelled = true;
    };
  }, [open, currentEntryId, meta]);

  const browse = useCallback(
    (id: string) => setBrowseId(id === currentEntryId ? null : id),
    [currentEntryId],
  );

  const activeId = browseId ?? currentEntryId;
  const entries = chain?.id === currentEntryId ? chain.entries : [];
  const activeIndex = activeId == null ? -1 : entries.findIndex((entry) => entry.id === activeId);
  const activeMeta = useMemo<Meta | null>(() => {
    if (activeId == null) return null;
    const found = entries.find((entry) => entry.id === activeId);
    if (found) return found.meta;
    return activeId === meta.id ? meta : { ...meta, id: activeId };
  }, [activeId, entries, meta]);

  return {
    activeId,
    activeMeta,
    entries,
    prevEntry: activeIndex > 0 ? entries[activeIndex - 1] : null,
    nextEntry:
      activeIndex >= 0 && activeIndex < entries.length - 1 ? entries[activeIndex + 1] : null,
    browsing: browseId != null,
    browse,
  };
}
