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
  items: ParentsGuideItem[];
};

export type ParentsGuideResult = {
  categories: ParentsGuideCategory[];
};

const guideCache = new Map<string, ParentsGuideResult | null>();
const guideInflight = new Map<string, Promise<ParentsGuideResult | null>>();

registerEvictable("imdb-parents-guide", (aggressive) => {
  if (aggressive) guideCache.clear();
});

const GRAPHQL_ENDPOINT = "https://graphql.imdb.com/";

const PARENTS_GUIDE_QUERY = `
query ParentsGuide($id: ID!) {
  title(id: $id) {
    parentsGuide {
      categories {
        category { id text }
        severity { text voteType votedFor }
        totalSeverityVotes
        guideItems(first: 30) {
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

export function severityColorStyle(severity: string): SeverityColorStyle {
  switch (severity.toLowerCase()) {
    case "none":
      return {
        badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
        barClass: "bg-emerald-400",
        textClass: "text-emerald-400",
        borderClass: "border-emerald-500/30",
        glowClass: "shadow-[0_0_15px_-4px_rgba(74,222,128,0.20)]",
      };
    case "mild":
      return {
        badgeClass: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
        barClass: "bg-yellow-400",
        textClass: "text-yellow-400",
        borderClass: "border-yellow-500/30",
        glowClass: "shadow-[0_0_15px_-4px_rgba(250,204,21,0.20)]",
      };
    case "moderate":
      return {
        badgeClass: "bg-orange-500/15 text-orange-400 border-orange-500/30",
        barClass: "bg-orange-400",
        textClass: "text-orange-400",
        borderClass: "border-orange-500/30",
        glowClass: "shadow-[0_0_15px_-4px_rgba(251,146,60,0.20)]",
      };
    case "severe":
      return {
        badgeClass: "bg-rose-500/15 text-rose-400 border-rose-500/30",
        barClass: "bg-rose-400",
        textClass: "text-rose-400",
        borderClass: "border-rose-500/30",
        glowClass: "shadow-[0_0_15px_-4px_rgba(244,63,94,0.20)]",
      };
    default:
      return {
        badgeClass: "bg-white/[0.08] text-ink-muted border-white/[0.12]",
        barClass: "bg-white/40",
        textClass: "text-ink-muted",
        borderClass: "border-white/10",
        glowClass: "",
      };
  }
}

export async function fetchImdbParentsGuide(imdbId: string): Promise<ParentsGuideResult | null> {
  const cleanId = imdbId.trim();
  if (!/^tt\d+$/.test(cleanId)) return null;

  if (guideCache.has(cleanId)) {
    return guideCache.get(cleanId) ?? null;
  }

  const pending = guideInflight.get(cleanId);
  if (pending) return pending;

  const request = (async (): Promise<ParentsGuideResult | null> => {
    try {
      const res = await safeFetch(GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          Referer: "https://www.imdb.com/",
        },
        body: JSON.stringify({
          query: PARENTS_GUIDE_QUERY,
          variables: { id: cleanId },
        }),
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        guideCache.set(cleanId, null);
        return null;
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
        guideItems?: { edges?: RawEdge[] };
      };

      type ImdbResponse = {
        data?: {
          title?: {
            parentsGuide?: {
              categories?: RawCategory[];
            };
          };
        };
      };

      const json = (await res.json()) as ImdbResponse;
      const rawCategories = json.data?.title?.parentsGuide?.categories;

      if (!rawCategories || !Array.isArray(rawCategories) || rawCategories.length === 0) {
        guideCache.set(cleanId, null);
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

        categories.push({
          id: cat?.id ?? "",
          label: cat?.text ?? "",
          severity: (sev?.text ?? "None") as "None" | "Mild" | "Moderate" | "Severe",
          severityVotes: Number(sev?.votedFor) || 0,
          totalVotes: Number(raw.totalSeverityVotes) || 0,
          items,
        });
      }

      if (categories.length === 0) {
        guideCache.set(cleanId, null);
        return null;
      }

      const result: ParentsGuideResult = { categories };
      lruSet(guideCache, cleanId, result, 150);
      return result;
    } catch {
      return null;
    } finally {
      guideInflight.delete(cleanId);
    }
  })();

  guideInflight.set(cleanId, request);
  return request;
}
