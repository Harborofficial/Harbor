/** Selection is scoped to the current visible list; hidden filter items are never acted on. */
export function selectedVisibleIds(
  visibleIds: readonly string[],
  selected: ReadonlySet<string>,
): string[] {
  return visibleIds.filter((id) => selected.has(id));
}

export function toggleDownloadSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Checking a group selects all its visible items; checking it again clears the group. */
export function toggleDownloadGroupSelection(
  selected: ReadonlySet<string>,
  groupIds: readonly string[],
): Set<string> {
  const next = new Set(selected);
  const allSelected = groupIds.length > 0 && groupIds.every((id) => next.has(id));
  for (const id of groupIds) {
    if (allSelected) next.delete(id);
    else next.add(id);
  }
  return next;
}
