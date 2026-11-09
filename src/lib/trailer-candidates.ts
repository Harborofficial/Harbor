/** Merge trailer ids from several sources, preserving order and dropping duplicates. */
export function mergeTrailerCandidates(
  ...lists: Array<readonly string[] | null | undefined>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const value of list ?? []) {
      const id = value?.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
