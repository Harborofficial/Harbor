import { githubReleaseNote } from "./github-releases";
import bundled from "./bundled-release-notes.json";

export type NoteMedia = {
  src: string;
  kind?: "image" | "sprite";
  alt?: string;
  height?: number;
};

export type NoteSection = { heading?: string; items: string[] };

export type ReleaseNote = {
  title?: string;
  intro?: string;
  media?: NoteMedia;
  sections?: NoteSection[];
};

const bundledNotes: Record<string, ReleaseNote> = bundled.notes;

export async function releaseNote(
  version: string | null | undefined,
  channel?: "beta" | "stable",
): Promise<ReleaseNote | null> {
  if (!version) return null;
  // Exact-version notes remain available offline and before publication.
  if (Object.hasOwn(bundledNotes, version)) return bundledNotes[version];
  return githubReleaseNote(version, channel);
}

export function hasRichNote(n: ReleaseNote | null | undefined): n is ReleaseNote {
  return !!n && !!(n.media || n.title || (n.sections && n.sections.length > 0));
}
