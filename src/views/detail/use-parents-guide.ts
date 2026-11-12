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
  error: boolean;
  retry: () => void;
} {
  const enabled = options?.enabled ?? true;
  const normalizedId = imdbId && /^tt\d+$/.test(imdbId.trim()) ? imdbId.trim() : null;
  const [retryNonce, setRetryNonce] = useState(0);

  const [state, setState] = useState<{
    id: string | null;
    guide: ParentsGuideResult | null;
    error: boolean;
  }>(() => {
    if (!enabled || !normalizedId) {
      return { id: null, guide: null, error: false };
    }
    const cached = getParentsGuideCacheEntry(normalizedId);
    if (cached && cached.expiresAt > Date.now()) {
      return { id: normalizedId, guide: cached.data, error: false };
    }
    return { id: null, guide: null, error: false };
  });

  const [loading, setLoading] = useState<boolean>(() => {
    if (!enabled || !normalizedId) return false;
    const cached = getParentsGuideCacheEntry(normalizedId);
    return !(cached && cached.expiresAt > Date.now());
  });

  useEffect(() => {
    if (!enabled || !normalizedId) {
      setState({ id: null, guide: null, error: false });
      setLoading(false);
      return;
    }

    const cached = getParentsGuideCacheEntry(normalizedId);
    if (cached && cached.expiresAt > Date.now()) {
      setState({ id: normalizedId, guide: cached.data, error: false });
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchImdbParentsGuide(normalizedId)
      .then((res) => {
        if (!cancelled) {
          if (res === "error") {
            setState({ id: normalizedId, guide: null, error: true });
          } else {
            setState({ id: normalizedId, guide: res, error: false });
          }
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ id: normalizedId, guide: null, error: true });
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedId, enabled, retryNonce]);

  // Associate fetched results with their IMDb ID: only expose data matching currently resolved title
  const isMatch = state.id === normalizedId;
  const guide = isMatch ? state.guide : null;
  const error = isMatch ? state.error : false;
  const hasData = Boolean(guide && guide.categories.length > 0);

  const retry = () => setRetryNonce((n) => n + 1);

  return { guide, loading, hasData, error, retry };
}
