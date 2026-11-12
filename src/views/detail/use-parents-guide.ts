import { useState, useEffect } from "react";
import {
  fetchImdbParentsGuide,
  getParentsGuideCacheEntry,
  type ParentsGuideResult,
} from "@/lib/providers/imdb-parents-guide";

export function useParentsGuide(
  imdbId: string | null | undefined,
  options?: { enabled?: boolean },
): {
  guide: ParentsGuideResult | null;
  loading: boolean;
  hasData: boolean;
} {
  const enabled = options?.enabled ?? true;
  const normalizedId = imdbId && /^tt\d+$/.test(imdbId.trim()) ? imdbId.trim() : null;

  const [state, setState] = useState<{
    id: string | null;
    guide: ParentsGuideResult | null;
  }>(() => {
    if (!enabled || !normalizedId) {
      return { id: null, guide: null };
    }
    const cached = getParentsGuideCacheEntry(normalizedId);
    if (cached && cached.expiresAt > Date.now()) {
      return { id: normalizedId, guide: cached.data };
    }
    return { id: null, guide: null };
  });

  const [loading, setLoading] = useState<boolean>(() => {
    if (!enabled || !normalizedId) return false;
    const cached = getParentsGuideCacheEntry(normalizedId);
    return !(cached && cached.expiresAt > Date.now());
  });

  useEffect(() => {
    if (!enabled || !normalizedId) {
      setState({ id: null, guide: null });
      setLoading(false);
      return;
    }

    const cached = getParentsGuideCacheEntry(normalizedId);
    if (cached && cached.expiresAt > Date.now()) {
      setState({ id: normalizedId, guide: cached.data });
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchImdbParentsGuide(normalizedId)
      .then((res) => {
        if (!cancelled) {
          setState({ id: normalizedId, guide: res });
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ id: normalizedId, guide: null });
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedId, enabled]);

  // Associate fetched results with their IMDb ID: only expose data matching currently resolved title
  const guide = state.id === normalizedId ? state.guide : null;
  const hasData = Boolean(guide && guide.categories.length > 0);

  return { guide, loading, hasData };
}
