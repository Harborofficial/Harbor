import { persistableAddonOrigin } from "../addon-configuration-key";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { PlayerSrc } from "../view";
import type { PlaybackSubtitleChoice } from "./subtitle-choice";
import type { PlaybackEntry } from "../playback-history";
import { isLocalUrl } from "./local-url";

const MAX_URL_ENCODING_DEPTH = 8;

// Names and labels are not an alternative place to retain a transport URL.
function safeString(value: string): string | undefined {
  if (/^file:\/\//i.test(value) && persistablePlaybackUrl(value)) return value;
  if (/^local[:-]/i.test(value) && persistablePlaybackUrl(value.slice(6))) return value;
  if (/^harbor-plugin:\/\/[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._:-]+)*$/.test(value)) return value;
  let decoded = value;
  for (let depth = 0; depth < MAX_URL_ENCODING_DEPTH; depth++) {
    if (/(?:https?|rtmps?|rtsp|mms|ftp|sftp|wss?):\s*[/\\]|\/\//i.test(decoded)) return undefined;
    const next = decoded.replace(/%([a-f0-9]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
    if (next === decoded) return value;
    decoded = next;
  }
  // Do not let deeper or deliberately layered encoding bypass the bounded scan.
  return undefined;
}

/** Select only scalar fields; nested transport objects never enter history. */
function fields<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  const entries: Array<[K, unknown]> = [];
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string") {
      const safe = safeString(item);
      if (safe !== undefined) entries.push([key, safe]);
    } else if (
      typeof item === "boolean" ||
      item === null ||
      (typeof item === "number" && Number.isFinite(item))
    ) {
      entries.push([key, item]);
    } else if (Array.isArray(item) && item.every((part) => typeof part === "string")) {
      entries.push([key, item.filter((part) => safeString(part) !== undefined)]);
    }
  }
  return Object.fromEntries(entries) as Pick<T, K>;
}

export { fields as persistablePlaybackFields };

export function playbackTransportFingerprint(value: string | undefined): string | undefined {
  return value ? bytesToHex(sha256(new TextEncoder().encode(value))) : undefined;
}

/** URL-derived item IDs cannot double as a second copy of the transport. */
export function persistablePlaybackIdentity(value: string): string {
  if (typeof value !== "string") return "";
  return safeString(value) === undefined
    ? `playback-private:${playbackTransportFingerprint(value)}`
    : value;
}

export function persistablePlaybackKey(value: string): string {
  const match = /^(.*)(\|(?:s\d+(?:e\d+)?|all))$/.exec(value);
  return match
    ? `${persistablePlaybackIdentity(match[1])}${match[2]}`
    : persistablePlaybackIdentity(value);
}

export function persistablePlaybackUrl(value: string | undefined): string | undefined {
  if (typeof value !== "string" || !isLocalUrl(value) || value.startsWith("//")) return undefined;
  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      if (url.username || url.password || url.search || url.hash) return undefined;
    } catch {
      return undefined;
    }
  }
  return value;
}

function artworkUrl(value: string | undefined): string | undefined {
  if (
    value &&
    /^https:\/\/image\.tmdb\.org\/t\/p\/(?:original|[wh]\d+)\/[A-Za-z0-9_-]+\.(?:jpg|png|webp|svg)$/.test(
      value,
    )
  )
    return value;
  return persistablePlaybackUrl(value);
}

/** The source preference has the same URL policy as the observed session. */
export function persistablePlaybackPreference(entry: PlaybackEntry): PlaybackEntry {
  const textKeys = [
    "infoHash",
    "addonId",
    "title",
    "parsedTitle",
    "resolution",
    "releaseGroup",
    "source",
    "bingeGroup",
  ] as const;
  const text = fields(entry, textKeys);
  for (const key of textKeys)
    if (text[key] != null && typeof text[key] !== "string") delete text[key];
  const numbers = fields(entry, ["fileIdx", "size", "savedAt"]);
  for (const key of ["fileIdx", "size", "savedAt"] as const)
    if (numbers[key] != null && typeof numbers[key] !== "number") delete numbers[key];
  return {
    ...text,
    ...numbers,
    ...(Array.isArray(entry.audioLanguages)
      ? {
          audioLanguages: entry.audioLanguages.filter(
            (value) => typeof value === "string" && safeString(value) !== undefined,
          ),
        }
      : {}),
    ...(Array.isArray(entry.cachedSlugs)
      ? {
          cachedSlugs: entry.cachedSlugs.filter(
            (value) => typeof value === "string" && safeString(value) !== undefined,
          ),
        }
      : {}),
    ...(typeof entry.addonId === "string"
      ? { addonId: persistablePlaybackIdentity(entry.addonId) }
      : {}),
    url: persistablePlaybackUrl(entry.url ?? undefined),
    urlFingerprint:
      typeof entry.url === "string" && entry.url && !persistablePlaybackUrl(entry.url)
        ? playbackTransportFingerprint(entry.url)
        : typeof entry.urlFingerprint === "string" && /^[a-f0-9]{64}$/.test(entry.urlFingerprint)
          ? entry.urlFingerprint
          : undefined,
  };
}

/** Compare a redacted source with a live session without retaining its URL. */
export function playbackUrlFingerprint(
  src: Pick<PlayerSrc, "url" | "historyUrl" | "streamRef" | "homeServer">,
): string | undefined {
  const url = src.historyUrl ?? src.url;
  return !src.homeServer && !src.streamRef?.infoHash && url && !persistablePlaybackUrl(url)
    ? playbackTransportFingerprint(url)
    : undefined;
}

/** Persist source identity, never a complete runtime PlayerSrc. */
export function persistablePlaybackSource(src: PlayerSrc): Omit<PlayerSrc, "continuation"> {
  const origin = persistableAddonOrigin(src.meta.addonOrigin);
  const privateIdentity = persistablePlaybackIdentity(src.meta.id);
  const badge = src.meta.providerBadge
    ? fields(src.meta.providerBadge, ["name", "tint"])
    : undefined;
  const badgeLogo = artworkUrl(src.meta.providerBadge?.logo);
  const opaque = privateIdentity !== src.meta.id || privateIdentity.startsWith("playback-private:");
  return {
    ...fields(src, [
      "title",
      "subtitle",
      "imdbId",
      "imdbIdVerified",
      "notWebReady",
      "isAnime",
      "suppressCloudSync",
      "episodeEnd",
    ]),
    meta: {
      ...fields(src.meta, [
        "id",
        "type",
        "name",
        "poster",
        "background",
        "logo",
        "originalLanguage",
        "country",
        "malId",
        "animeFormat",
        "releaseInfo",
        "releaseDate",
        "inTheaters",
        "imdbRating",
        "adult",
        "sourceRank",
        "tmdbScore",
        "pluginQuality",
        "listingYear",
        "runtime",
        "genres",
        "isCollection",
      ]),
      id: privateIdentity,
      name: opaque ? "Direct stream" : (safeString(src.meta.name) ?? ""),
      ...(src.meta.poster ? { poster: artworkUrl(src.meta.poster) } : {}),
      ...(src.meta.background ? { background: artworkUrl(src.meta.background) } : {}),
      ...(src.meta.logo ? { logo: artworkUrl(src.meta.logo) } : {}),
      ...(origin
        ? { addonOrigin: fields(origin, ["id", "name", "logo", "base", "configurationKey"]) }
        : {}),
      ...(badge && typeof badge.name === "string" && typeof badge.tint === "string" && badgeLogo
        ? {
            providerBadge: {
              ...badge,
              logo: badgeLogo,
            },
          }
        : {}),
      ...(src.meta.listingExtras
        ? {
            listingExtras: fields(src.meta.listingExtras, [
              "rest",
              "languages",
              "quality",
              "resolutions",
              "hdr",
            ]),
          }
        : {}),
      ...(src.meta.behaviorHints
        ? { behaviorHints: fields(src.meta.behaviorHints, ["defaultVideoId"]) }
        : {}),
    },
    url: src.homeServer ? "" : (persistablePlaybackUrl(src.historyUrl ?? src.url) ?? ""),
    ...(opaque ? { title: "Direct stream", subtitle: undefined } : {}),
    ...(src.episode
      ? {
          episode: {
            ...fields(src.episode, [
              "season",
              "episode",
              "name",
              "imdbId",
              "imdbSeason",
              "imdbEpisode",
              "absoluteNumber",
              "tvdbEpisodeId",
              "kitsuStreamId",
              "sourceMetaId",
              "videoId",
              "still",
              "overview",
              "rating",
              "airDate",
              "runtime",
            ]),
            ...(src.episode.still ? { still: artworkUrl(src.episode.still) } : {}),
          },
        }
      : {}),
    ...(src.episodeSpan
      ? { episodeSpan: fields(src.episodeSpan, ["season", "episode", "episodeEnd"]) }
      : {}),
    ...(src.streamRef
      ? {
          streamRef: {
            ...fields(src.streamRef, [
              "resolvedFilename",
              "infoHash",
              "fileIdx",
              "addonId",
              "name",
              "addonName",
              "title",
              "parsedTitle",
              "resolution",
              "quality",
              "releaseGroup",
              "source",
              "audioLanguages",
              "size",
              "bingeGroup",
              "cachedSlugs",
            ]),
            ...(src.streamRef.addonId
              ? { addonId: persistablePlaybackIdentity(src.streamRef.addonId) }
              : {}),
          },
        }
      : {}),
    ...(src.homeServer
      ? { homeServer: fields(src.homeServer, ["connectionId", "itemId", "versionId", "quality"]) }
      : {}),
  };
}

export function persistablePlaybackSubtitle(
  choice: PlaybackSubtitleChoice | undefined,
  src: PlayerSrc,
): PlaybackSubtitleChoice | undefined {
  if (!choice) return undefined;
  if (choice.off) return { off: true };
  const saved = fields(choice, [
    "lang",
    "title",
    "trackId",
    "subId",
    "provider",
    "release",
    "format",
    "encoding",
    "downloadAuthKind",
    "providerDerived",
    "localTrusted",
    "matchScore",
    "matchConfidence",
    "streamKey",
    "imported",
    "external",
    "codec",
    "forced",
    "hearingImpaired",
    "fpsOverride",
    "homeServerSubtitleId",
  ]);
  if (typeof choice.streamKey === "string")
    saved.streamKey = persistablePlaybackIdentity(choice.streamKey);
  const sourceFingerprint =
    choice.source && !persistablePlaybackUrl(choice.source)
      ? playbackTransportFingerprint(choice.source)
      : typeof choice.sourceFingerprint === "string" &&
          /^[a-f0-9]{64}$/.test(choice.sourceFingerprint)
        ? choice.sourceFingerprint
        : undefined;
  const retained = { ...saved, ...(sourceFingerprint ? { sourceFingerprint } : {}) };
  const serverSubtitle =
    src.homeServer && choice.source
      ? src.subtitles?.find((track) => track.url === choice.source)
      : undefined;
  const homeServerSubtitleId = saved.homeServerSubtitleId ?? serverSubtitle?.id;
  if (src.homeServer) {
    delete retained.trackId;
    // A server track ID is stable only when supplied by its source catalogue.
    if (homeServerSubtitleId) return { ...retained, homeServerSubtitleId };
    if (serverSubtitle) return retained;
  }
  const source = persistablePlaybackUrl(choice.source);
  return source ? { ...retained, source } : retained;
}
