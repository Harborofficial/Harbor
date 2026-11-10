export type PlayerTitleLines = {
  title: string;
  subtitle?: string;
  seriesFirst: boolean;
};

/**
 * The logo artwork stands in for the show or movie name. Put the episode
 * details below a series logo, and leave a movie logo on its own instead of
 * repeating the title it already shows.
 */
export function playerTitleLines({
  title,
  subtitle,
  showName,
  isSeries,
  hasLogo,
  seriesFirst,
}: {
  title: string;
  subtitle?: string;
  showName?: string;
  isSeries: boolean;
  hasLogo: boolean;
  seriesFirst: boolean;
}): PlayerTitleLines {
  const name = showName?.trim() || undefined;
  // A movie logo replaces the name; the year (or source line) still belongs
  // under it, but never the name it already shows.
  const movieSubtitle = subtitle?.trim() === name ? undefined : subtitle;
  if (!hasLogo) {
    return {
      title,
      subtitle: isSeries ? subtitle : movieSubtitle,
      seriesFirst: seriesFirst && isSeries,
    };
  }
  if (!isSeries) {
    return { title, subtitle: movieSubtitle, seriesFirst: false };
  }
  const info = subtitle?.trim();
  const episodeInfo =
    info && name
      ? info === name
        ? undefined
        : info.startsWith(`${name} · `)
          ? info.slice(name.length + 3).trim() || undefined
          : info
      : info;
  const episodeTitle = title && title !== name ? title : undefined;
  return {
    title: name ?? title,
    subtitle: [episodeTitle, episodeInfo].filter(Boolean).join(" · ") || undefined,
    seriesFirst: false,
  };
}
