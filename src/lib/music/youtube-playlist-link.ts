const YOUTUBE_HOSTS = new Set([
  "music.youtube.com",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);
const PUBLIC_PLAYLIST_GUIDANCE =
  "Choose a public or unlisted playlist; signing in is not supported.";
const INVALID_LINK_MESSAGE = `Enter a valid YouTube playlist link or ID. ${PUBLIC_PLAYLIST_GUIDANCE}`;

function normalizePlaylistId(value: string, seed?: string): string {
  const id = value.startsWith("VL") ? value.slice(2) : value;
  if (id === "LM" || id === "WL") {
    throw new Error(
      `Liked playlists and watch-later playlists cannot be linked. ${PUBLIC_PLAYLIST_GUIDANCE}`,
    );
  }
  if (id.startsWith("RD") && !id.startsWith("RDCLAK5uy_")) {
    if (id.length > 80 || !/^RD[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(INVALID_LINK_MESSAGE);
    }
    if (!seed || !/^[A-Za-z0-9_-]{11}$/.test(seed)) {
      throw new Error(
        "For a generated Mix, paste a YouTube watch link containing its selected song.",
      );
    }
    return `${id}:${seed}`;
  }
  if (id.length > 80 || !/^(?:PL|OLAK5uy_|RDCLAK5uy_)[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(INVALID_LINK_MESSAGE);
  }
  return id;
}

// Validates syntax only; playlist visibility is determined when the provider loads it.
export function parseYouTubePlaylistLink(raw: string): string {
  const input = raw.trim();
  if (!input || input.length > 2048 || /[\s\\]/.test(input)) {
    throw new Error(INVALID_LINK_MESSAGE);
  }
  for (const character of input) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) throw new Error(INVALID_LINK_MESSAGE);
  }
  if (/^[A-Za-z0-9_-]+$/.test(input)) return normalizePlaylistId(input);

  const parts = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(input);
  if (!parts) throw new Error(INVALID_LINK_MESSAGE);

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    // URL parser errors may contain the submitted URL or credentials.
    throw new Error(INVALID_LINK_MESSAGE);
  }
  const rawHost = parts[1].replace(/:\d+$/, "").toLowerCase();
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    !YOUTUBE_HOSTS.has(rawHost) ||
    !YOUTUBE_HOSTS.has(url.hostname)
  ) {
    throw new Error(INVALID_LINK_MESSAGE);
  }

  // Check the supplied path too: URL normalizes away dot segments and other aliases.
  const path = parts[2];
  const isShortLink = url.hostname === "youtu.be" || url.hostname === "www.youtu.be";
  const validPath = isShortLink
    ? /^\/[A-Za-z0-9_-]+$/.test(path)
    : path === "/playlist" ||
      (path === "/watch" && /^[A-Za-z0-9_-]+$/.test(url.searchParams.get("v") ?? ""));
  if (!validPath || path !== url.pathname) throw new Error(INVALID_LINK_MESSAGE);

  const lists = url.searchParams.getAll("list");
  if (lists.length !== 1) throw new Error(INVALID_LINK_MESSAGE);
  const videos = url.searchParams.getAll("v");
  const seed = isShortLink
    ? path.slice(1)
    : path === "/watch" && videos.length === 1
      ? videos[0]
      : undefined;
  return normalizePlaylistId(lists[0], seed);
}
