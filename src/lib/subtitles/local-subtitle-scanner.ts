
import { readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

const SUBTITLE_EXT = /\.(ass|srt|ssa|vtt|sub)$/i;

export async function scanLocalSubtitles(
  folder: string,
): Promise<string[]> {
  const subtitles: string[] = [];

  async function scan(
    currentFolder: string,
    depth: number,
  ): Promise<void> {
    if (depth > 8) return;

    const entries = await readDir(currentFolder);

    for (const entry of entries) {
      const fullPath = await join(currentFolder, entry.name);

      if (entry.isDirectory) {
        await scan(fullPath, depth + 1);
      } else if (entry.isFile && SUBTITLE_EXT.test(entry.name)) {
        subtitles.push(fullPath);
      }
    }
  }

  if (!folder.trim()) return subtitles;

  await scan(folder, 0);
  return subtitles;
}


type EpisodeInfo = {
  title: string;
  alternateTitles?: string[];
  season?: number;
  episode?: number;
};

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function findMatchingSubtitle(
  files: string[],
  episode: EpisodeInfo,
): string | null {
  if (!episode.title || episode.episode == null) {
    return null;
  }

  const showTitles = [
  episode.title,
  ...(episode.alternateTitles ?? []),
]
  .map(normalizeTitle)
  .filter((title) => title.length > 0);
  const episodeNumber = episode.episode;
  const seasonNumber = episode.season ?? 1;

  for (const file of files) {
    const parts = file.split(/[\\/]/);
    const fileName = parts.pop() ?? "";
const folders = parts.map(normalizeTitle);
const normalizedFileName = normalizeTitle(
  fileName.replace(/\.(ass|srt|ssa|vtt|sub)$/i, ""),
);

// Don't match special episodes to regular episodes.
if (/\b(OVA|OAD|SPECIAL|SP)\b/i.test(fileName)) {
  continue;
}

const titleMatches = showTitles.some(
  (title) =>
    folders.some((folder) => folder.includes(title)) ||
    normalizedFileName.includes(title),
);

if (!titleMatches) {
  continue;
}

    const patterns = [
  new RegExp(`S0*${seasonNumber}E0*${episodeNumber}(?!\\d)`, "i"),
  new RegExp(`(?:Episode|Ep)[ ._-]*0*${episodeNumber}(?!\\d)`, "i"),
  new RegExp(`(?:^|[ ._-])0*${episodeNumber}(?=\\.|[ ._-]|$)`, "i"),
  new RegExp(`^0*${episodeNumber}\\.(ass|srt|ssa|vtt|sub)$`, "i"),
];

    if (patterns.some((pattern) => pattern.test(fileName))) {
      return file;
    }
  }

  return null;
}