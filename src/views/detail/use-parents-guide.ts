import { useState, useEffect } from "react";
import { fetchImdbParentsGuide, type ParentsGuideResult } from "@/lib/providers/imdb-parents-guide";

export function useParentsGuide(imdbId: string | null | undefined): {
  guide: ParentsGuideResult | null;
  loading: boolean;
  hasData: boolean;
} {
  const [guide, setGuide] = useState<ParentsGuideResult | null>(null);
  const [loading, setLoading] = useState<boolean>(() => {
    return Boolean(imdbId && /^tt\d+$/.test(imdbId.trim()));
  });

  useEffect(() => {
    if (!imdbId || !/^tt\d+$/.test(imdbId.trim())) {
      setGuide(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchImdbParentsGuide(imdbId)
      .then((res) => {
        if (!cancelled) {
          setGuide(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGuide(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [imdbId]);

  const hasData = Boolean(guide && guide.categories.length > 0);

  return { guide, loading, hasData };
}
