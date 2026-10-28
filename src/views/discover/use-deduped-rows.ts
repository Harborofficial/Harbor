import { useMemo, useRef } from "react";
import type { Meta } from "@/lib/cinemeta";

const MIN_ROW = 16;

export function useDedupedRows(
  rails: Record<string, Meta[]>,
  order: string[],
  featuredIds: Set<string>,
  criticsPickId?: string,
  priority: string[] = [],
): Record<string, Meta[] | null> {
  const previous = useRef<Record<string, Meta[] | null>>({});
  return useMemo(() => {
    const protectedIds = new Set<string>(featuredIds);
    if (criticsPickId) protectedIds.add(criticsPickId);
    const seen = new Set<string>(protectedIds);
    const prio = priority.filter((id) => order.includes(id));
    const claimOrder = [...prio, ...order.filter((id) => !prio.includes(id))];
    const out: Record<string, Meta[] | null> = {};
    for (const id of claimOrder) {
      const raw = rails[id];
      if (raw === undefined) {
        out[id] = null;
        continue;
      }
      const taken: Meta[] = [];
      const takenIds = new Set<string>();
      for (const m of raw) {
        if (!m.poster) continue;
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        taken.push(m);
        takenIds.add(m.id);
      }
      if (taken.length < MIN_ROW) {
        for (const m of raw) {
          if (taken.length >= MIN_ROW) break;
          if (!m.poster) continue;
          if (takenIds.has(m.id)) continue;
          if (protectedIds.has(m.id)) continue;
          taken.push(m);
          takenIds.add(m.id);
        }
      }
      if (taken.length < MIN_ROW) {
        for (const m of raw) {
          if (taken.length >= MIN_ROW) break;
          if (!m.poster) continue;
          if (takenIds.has(m.id)) continue;
          taken.push(m);
          takenIds.add(m.id);
        }
      }
      // A different rail finishing its request must not invalidate this rail's memoized
      // subtree. Compare object identities too, so refreshed metadata still reaches cards.
      const before = previous.current[id];
      out[id] =
        before && before.length === taken.length && before.every((meta, i) => meta === taken[i])
          ? before
          : taken;
    }
    previous.current = out;
    return out;
  }, [rails, order, featuredIds, criticsPickId, priority]);
}
