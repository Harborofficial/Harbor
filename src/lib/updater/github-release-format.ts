import type { ReleaseNote } from "./release-notes";

export type GithubRelease = {
  tag_name?: string | null;
  name?: string | null;
  body?: string | null;
  published_at?: string | null;
  prerelease?: boolean;
  draft?: boolean;
  assets?:
    | {
        name?: string | null;
        browser_download_url?: string | null;
        size?: number | null;
      }[]
    | null;
};

export type ParsedRelease = {
  version: string;
  channel: "beta" | "stable";
  note: ReleaseNote;
  publishedAt: string | null;
  date: string | null;
  summary: string | null;
  win: string | null;
  winSig: string | null;
  winSize: number | null;
  mac: string | null;
};

const TAG = /^v?(\d+)\.(\d+)\.(\d+)(?:-(beta|stable))?$/i;

export function normalizeReleaseTag(
  tag: string,
): { version: string; channel: "beta" | "stable" } | null {
  const match = TAG.exec(tag.trim());
  if (!match) return null;
  return {
    version: `${match[1]}.${match[2]}.${match[3]}`,
    channel: match[4]?.toLowerCase() === "beta" ? "beta" : "stable",
  };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const hex = code[1]?.toLowerCase() === "x";
      const value = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function cleanInline(text: string): string {
  return decodeEntities(
    text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1"),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeReleaseTitle(text: string): boolean {
  return /^harbor\s+v?\d+(?:\.\d+){1,2}\b/i.test(text);
}

function isPatchNotesHeading(text: string): boolean {
  return /patch notes/i.test(text);
}

export function parseReleaseBody(
  body: string | null | undefined,
  fallbackTitle?: string | null,
): ReleaseNote {
  const note: ReleaseNote = {};
  const title = fallbackTitle?.trim();
  if (title) note.title = title;
  const intro: string[] = [];
  const sections: { heading: string; items: string[] }[] = [];
  let current: { heading: string; items: string[] } | null = null;

  for (const rawLine of (body ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line || /^-{3,}$/.test(line)) continue;

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const text = cleanInline(heading[2]);
      if (!text) continue;
      if (heading[1].length === 1) {
        if (looksLikeReleaseTitle(text)) {
          if (!note.title) note.title = text;
        } else {
          intro.push(text);
        }
        continue;
      }
      current = { heading: text, items: [] };
      sections.push(current);
      continue;
    }

    const bullet = /^[*+-]\s+(.+)$/.exec(line);
    const text = cleanInline(bullet ? bullet[1].replace(/^\[[ xX]\]\s+/, "") : line);
    if (!text) continue;
    (current?.items ?? intro).push(text);
  }

  for (const section of sections) {
    if (section.items.length || isPatchNotesHeading(section.heading)) continue;
    intro.push(section.heading);
  }
  if (intro.length) note.intro = intro.join(" ");
  const filled = sections.filter((section) => section.items.length);
  if (filled.length) note.sections = filled;

  return note;
}

type Asset = { name: string; browser_download_url: string; size?: number | null };

function usableAssets(assets: GithubRelease["assets"]): Asset[] {
  return (assets ?? []).filter(
    (asset): asset is Asset =>
      typeof asset.name === "string" && typeof asset.browser_download_url === "string",
  );
}

function pickInstaller(
  assets: Asset[],
  pick: (name: string) => boolean,
  preferred?: (name: string) => boolean,
): Asset | null {
  const usable = assets.filter((asset) => pick(asset.name));
  return usable.find((asset) => preferred?.(asset.name)) ?? usable[0] ?? null;
}

export function parseGithubRelease(raw: GithubRelease): ParsedRelease | null {
  if (raw.draft || !raw.tag_name) return null;
  const normalized = normalizeReleaseTag(raw.tag_name);
  if (!normalized) return null;
  const channel = raw.prerelease ? "beta" : normalized.channel;
  const note = parseReleaseBody(raw.body, raw.name);
  const publishedAt = raw.published_at ?? null;
  const assets = usableAssets(raw.assets);
  const win = pickInstaller(
    assets,
    (name) => /\.exe$/i.test(name) && !/uninstall/i.test(name),
    (name) => /shipyard/i.test(name),
  );
  const winSig = win ? (assets.find((asset) => asset.name === `${win.name}.sig`) ?? null) : null;
  const mac = pickInstaller(
    assets,
    (name) => /\.dmg$/i.test(name),
    (name) => /aarch64|arm64/i.test(name),
  );
  return {
    version: normalized.version,
    channel,
    note,
    publishedAt,
    date: publishedAt && /^\d{4}-\d{2}-\d{2}/.test(publishedAt) ? publishedAt.slice(0, 10) : null,
    summary: note.intro ?? null,
    win: win?.browser_download_url ?? null,
    winSig: winSig?.browser_download_url ?? null,
    winSize: typeof win?.size === "number" && win.size > 0 ? win.size : null,
    mac: mac?.browser_download_url ?? null,
  };
}

export function installerForVersion(
  releases: ParsedRelease[],
  version: string,
  channel?: "beta" | "stable",
): ParsedRelease | null {
  const matching = releases.filter((release) => release.version === version);
  if (!matching.length) return null;
  return (
    (channel ? matching.find((release) => release.channel === channel) : undefined) ??
    matching.find((release) => release.channel === "stable") ??
    matching[0]
  );
}

export function newestReleases(releases: ParsedRelease[]): ParsedRelease[] {
  const newest = new Map<string, ParsedRelease>();
  for (const release of releases) {
    const previous = newest.get(release.version);
    if (!previous || (release.publishedAt ?? "") > (previous.publishedAt ?? "")) {
      newest.set(release.version, release);
    }
  }
  return [...newest.values()];
}
