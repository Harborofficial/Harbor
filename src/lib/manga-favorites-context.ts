import { createContext } from "react";
import type { MangaFavoritesStore } from "./manga-favorites";

// Provider dependencies can hot-reload without replacing the context consumers read.
export const MangaFavoritesContext = createContext<MangaFavoritesStore | null>(null);
