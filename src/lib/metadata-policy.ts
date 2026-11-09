/** Read the active profile's settings mirror without importing the React settings provider. */
export function addonOnlyMetadata(): boolean {
  try {
    return JSON.parse(localStorage.getItem("harbor.settings") ?? "{}").addonOnlyMetadata === true;
  } catch {
    return false;
  }
}

export function useTmdbTopMatch(): boolean {
  try {
    return JSON.parse(localStorage.getItem("harbor.settings") ?? "{}").searchTmdbTopMatch !== false;
  } catch {
    return true;
  }
}
