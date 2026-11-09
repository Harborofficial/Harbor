import type { Meta } from "./cinemeta";
import type { LibraryItem } from "./stremio";
import { confirmAction } from "./confirm-action";
import { t } from "./i18n";
import {
  setContextWatched,
  type MediaActionResult,
  type UnsafeProviderPolicy,
} from "./media-context-actions";

/** Keep the Stremio library flag in step with the local watched toggle. */
export function optimisticMovieWatchedState(
  state: LibraryItem["state"] | undefined,
  watched: boolean,
): LibraryItem["state"] | undefined {
  if (!state) return state;
  return {
    ...state,
    flaggedWatched: watched ? 1 : 0,
    timesWatched: watched ? Math.max(1, state.timesWatched ?? 0) : 0,
  };
}

/**
 * Simkl's API can only unwatch a movie by removing it from the user's Simkl
 * library, so ask before applying that destructive provider change. Every
 * other unwatch path proceeds without a prompt.
 */
export async function setMovieWatchedWithConfirmation(
  meta: Meta,
  watched: boolean,
  options: {
    imdbId?: string | null;
    title?: string;
    onUnsafeProvider?: UnsafeProviderPolicy;
  } = {},
): Promise<MediaActionResult | null> {
  const run = (allowSimklLibraryRemoval: boolean) =>
    setContextWatched(meta, watched, {
      imdbId: options.imdbId,
      onUnsafeProvider: options.onUnsafeProvider ?? "block",
      allowSimklLibraryRemoval,
    });

  const result = await run(false);
  if (result.confirmation !== "simkl-library-removal") return result;

  const title = options.title?.trim() || meta.name;
  const confirmed = await confirmAction({
    title: t("Unwatch this movie?"),
    message: t(
      'Simkl has no separate unwatched state. Unwatching "{title}" removes it from your Simkl library and watch history.',
      { title },
    ),
    confirmLabel: t("Unwatch everywhere"),
    destructive: true,
  });
  if (!confirmed) return null;
  return run(true);
}
