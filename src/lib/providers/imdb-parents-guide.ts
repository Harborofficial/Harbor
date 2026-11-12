import { lruSet } from "@/lib/cache";
import { registerEvictable } from "@/lib/maintenance";
import { safeFetch } from "@/lib/safe-fetch";

export type ParentsGuideItem = {
  text: string;
  isSpoiler: boolean;
};

export type ParentsGuideCategory = {
  id: string;
  label: string;
  severity: "None" | "Mild" | "Moderate" | "Severe" | string;
  severityVotes: number;
  totalVotes: number;
  totalItems: number;
  items: ParentsGuideItem[];
};

export type ParentsGuideResult = {
  categories: ParentsGuideCategory[];
};

export type CacheEntry = {
  data: ParentsGuideResult | null;
  expiresAt: number;
};

export type ParentsGuideResponse = ParentsGuideResult | null | "error";

const guideCache = new Map<string, CacheEntry>();
const guideInflight = new Map<string, Promise<ParentsGuideResponse>>();

export const POSITIVE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes (genuinely unavailable/empty)

registerEvictable("imdb-parents-guide", (aggressive) => {
  if (aggressive) {
    guideCache.clear();
  } else {
    const now = Date.now();
    for (const [k, v] of guideCache) {
      if (v.expiresAt <= now) guideCache.delete(k);
    }
  }
});

export function clearParentsGuideCache(): void {
  guideCache.clear();
  guideInflight.clear();
}

export function getParentsGuideCacheEntry(imdbId: string): CacheEntry | undefined {
  return guideCache.get(imdbId.trim());
}

const GRAPHQL_ENDPOINT = "https://api.graphql.imdb.com/";

const PARENTS_GUIDE_QUERY = `
query ParentsGuide($id: ID!) {
  title(id: $id) {
    parentsGuide {
      categories {
        category { id text }
        severity { text voteType votedFor }
        totalSeverityVotes
        guideItems(first: 50) {
          total
          edges {
            node {
              isSpoiler
              text { plainText }
            }
          }
        }
      }
    }
  }
}
`;

export function severityLevel(severity: string): number {
  switch (severity.toLowerCase()) {
    case "none":
      return 1;
    case "mild":
      return 2;
    case "moderate":
      return 3;
    case "severe":
      return 4;
    default:
      return 0;
  }
}

export type SeverityColorStyle = {
  badgeClass: string;
  barClass: string;
  textClass: string;
  borderClass: string;
  glowClass: string;
};

export function severityColorStyle(
  severity: string,
  theme: "colored" | "monochrome" = "monochrome",
): SeverityColorStyle {
  const norm = severity.toLowerCase();

  if (theme === "colored") {
    switch (norm) {
      case "severe":
        return {
          badgeClass: "bg-danger/15 text-danger border-danger/30",
          barClass: "bg-danger",
          textClass: "text-danger",
          borderClass: "border-danger/30",
          glowClass: "shadow-[0_0_15px_-4px_rgba(244,63,94,0.20)]",
        };
      case "moderate":
        return {
          badgeClass: "bg-accent/15 text-accent border-accent/30",
          barClass: "bg-accent",
          textClass: "text-accent",
          borderClass: "border-accent/30",
          glowClass: "shadow-[0_0_15px_-4px_rgba(251,146,60,0.20)]",
        };
      case "mild":
        return {
          badgeClass: "bg-white/[0.08] text-white/70 border-white/15",
          barClass: "bg-white/45",
          textClass: "text-white/60",
          borderClass: "border-white/15",
          glowClass: "",
        };
      case "none":
      default:
        return {
          badgeClass: "bg-white/[0.04] text-white/40 border-white/10",
          barClass: "bg-white/30",
          textClass: "text-white/40",
          borderClass: "border-white/10",
          glowClass: "",
        };
    }
  }

  // Monochrome theme (matches player ContentAdvisoryToast default)
  switch (norm) {
    case "severe":
      return {
        badgeClass: "bg-white/[0.12] text-white/90 border-white/25",
        barClass: "bg-white/90",
        textClass: "text-white/90 font-bold",
        borderClass: "border-white/25",
        glowClass: "",
      };
    case "moderate":
      return {
        badgeClass: "bg-white/[0.08] text-white/70 border-white/15",
        barClass: "bg-white/65",
        textClass: "text-white/70 font-medium",
        borderClass: "border-white/15",
        glowClass: "",
      };
    case "mild":
      return {
        badgeClass: "bg-white/[0.05] text-white/50 border-white/10",
        barClass: "bg-white/45",
        textClass: "text-white/50 font-medium",
        borderClass: "border-white/10",
        glowClass: "",
      };
    case "none":
    default:
      return {
        badgeClass: "bg-white/[0.03] text-white/35 border-white/[0.08]",
        barClass: "bg-white/30",
        textClass: "text-white/35",
        borderClass: "border-white/[0.08]",
        glowClass: "",
      };
  }
}

export async function fetchImdbParentsGuide(
  imdbId: string,
  fetchImpl: typeof safeFetch = safeFetch,
): Promise<ParentsGuideResponse> {
  const cleanId = imdbId.trim();
  if (!/^tt\d+$/.test(cleanId)) return null;

  const cached = guideCache.get(cleanId);
  if (cached) {
    if (Date.now() < cached.expiresAt) {
      return cached.data;
    }
    guideCache.delete(cleanId);
  }

  const pending = guideInflight.get(cleanId);
  if (pending) return pending;

  const request = (async (): Promise<ParentsGuideResponse> => {
    try {
      const res = await fetchImpl(GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-imdb-client-name": "imdb-web-next-localized",
          Accept: "application/json",
        },
        body: JSON.stringify({
          query: PARENTS_GUIDE_QUERY,
          variables: { id: cleanId },
        }),
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        if (res.status === 404) {
          lruSet(
            guideCache,
            cleanId,
            { data: null, expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS },
            150,
          );
          return null;
        }
        return "error";
      }

      type RawEdge = {
        node?: {
          isSpoiler?: boolean;
          text?: { plainText?: string };
        };
      };

      type RawCategory = {
        category?: { id?: string; text?: string };
        severity?: { text?: string; voteType?: string; votedFor?: number };
        totalSeverityVotes?: number;
        guideItems?: {
          total?: number;
          edges?: RawEdge[];
        };
      };

      type ImdbResponse = {
        data?: {
          title?: {
            parentsGuide?: {
              categories?: RawCategory[];
            };
          } | null;
        } | null;
        errors?: Array<{ message?: string; [key: string]: unknown }>;
      };

      const json = (await res.json()) as ImdbResponse;
      const hasErrors = Array.isArray(json.errors) && json.errors.length > 0;
      if (hasErrors) {
        return "error";
      }

      const rawCategories = json.data?.title?.parentsGuide?.categories;
      if (!rawCategories || !Array.isArray(rawCategories) || rawCategories.length === 0) {
        lruSet(
          guideCache,
          cleanId,
          { data: null, expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS },
          150,
        );
        return null;
      }

      const categories: ParentsGuideCategory[] = [];
      for (const raw of rawCategories) {
        const cat = raw.category;
        const sev = raw.severity;
        const edges = raw.guideItems?.edges ?? [];

        const items: ParentsGuideItem[] = [];
        for (const edge of edges) {
          const text = edge.node?.text?.plainText?.trim();
          if (text) {
            items.push({
              text,
              isSpoiler: Boolean(edge.node?.isSpoiler),
            });
          }
        }

        const totalItems =
          typeof raw.guideItems?.total === "number" && raw.guideItems.total >= items.length
            ? raw.guideItems.total
            : items.length;

        categories.push({
          id: cat?.id ?? "",
          label: cat?.text ?? "",
          severity: (sev?.text ?? "None") as "None" | "Mild" | "Moderate" | "Severe",
          severityVotes: Number(sev?.votedFor) || 0,
          totalVotes: Number(raw.totalSeverityVotes) || 0,
          totalItems,
          items,
        });
      }

      if (categories.length === 0) {
        lruSet(
          guideCache,
          cleanId,
          { data: null, expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS },
          150,
        );
        return null;
      }

      const result: ParentsGuideResult = { categories };
      lruSet(
        guideCache,
        cleanId,
        { data: result, expiresAt: Date.now() + POSITIVE_CACHE_TTL_MS },
        150,
      );
      return result;
    } catch {
      return "error";
    } finally {
      guideInflight.delete(cleanId);
    }
  })();

  guideInflight.set(cleanId, request);
  return request;
}
