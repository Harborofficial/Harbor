import type { Tab } from "./shared";

/** Every tab except the Library tab itself, which stays as the landing tab. */
export const HIDEABLE_LIBRARY_TABS: readonly Tab[] = [
  "watchlist",
  "history",
  "local",
  "media-servers",
  "torbox",
  "lists",
  "groups",
  "favorites",
  "trakt",
  "anilist",
  "mal",
  "simkl",
  "publicmetadb",
  "letterboxd",
];

const HIDEABLE = new Set<string>(HIDEABLE_LIBRARY_TABS);

/** Stored settings may hold stale or malformed ids; keep only tabs that can be hidden. */
export function hiddenLibraryTabs(stored: unknown): Set<Tab> {
  const hidden = new Set<Tab>();
  if (!Array.isArray(stored)) return hidden;
  for (const id of stored) {
    if (typeof id === "string" && HIDEABLE.has(id)) hidden.add(id as Tab);
  }
  return hidden;
}

/**
 * The open tab keeps its button even when hidden, so a tab reached through
 * navigation (a saved tab, or a group opened from elsewhere) is never orphaned.
 */
export function isLibraryTabShown(tab: Tab, hidden: ReadonlySet<Tab>, activeTab: Tab): boolean {
  return tab === activeTab || !hidden.has(tab);
}

export function toggleHiddenLibraryTab(hidden: ReadonlySet<Tab>, tab: Tab): Tab[] {
  if (!HIDEABLE.has(tab)) return HIDEABLE_LIBRARY_TABS.filter((id) => hidden.has(id));
  const next = new Set(hidden);
  if (next.has(tab)) next.delete(tab);
  else next.add(tab);
  return HIDEABLE_LIBRARY_TABS.filter((id) => next.has(id));
}
