import { persistableAddonOrigin } from "../addon-configuration-key";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { PlayerSrc } from "../view";
import type { PlaybackSubtitleChoice } from "./subtitle-choice";

// Keep a credentialed transport out of every retained field, including artwork
// and provider labels. The installed connection/addon owns its credentials.
function safeString(value: string): string | undefined {
  for (const match of value.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    try {
      const url = new URL(match[0]);
      if (url.username || url.password) return undefined;
      for (const key of url.searchParams.keys()) {
        const normalized = key.toLowerCase().replace(/[-_]/g, "");
        if (
          /token|password|secret|signature|authorization/.test(normalized) ||
          ["apikey", "key", "auth", "sig", "jwt", "credential", "policy", "keypairid"].includes(
            normalized,
          ) ||
          normalized.startsWith("xamz") ||
          normalized.startsWith("xgoog")
        )
          return undefined;
      }
    } catch {
      return undefined;
    }
  }
  return value;
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

export function persistablePlaybackUrl(value: string | undefined): string | undefined {
  return typeof value === "string" && !/^(blob|data|memory):/i.test(value)
    ? safeString(value)
    : undefined;
}

/** Compare a redacted source with a live session without retaining its URL. */
export function playbackUrlFingerprint(
  src: Pick<PlayerSrc, "url" | "historyUrl" | "streamRef" | "homeServer">,
): string | undefined {
  const url = src.historyUrl ?? src.url;
  return !src.homeServer && !src.streamRef?.infoHash && url && !persistablePlaybackUrl(url)
    ? bytesToHex(sha256(new TextEncoder().encode(url)))
    : undefined;
}

/** Persist source identity, never a complete runtime PlayerSrc. */
export function persistablePlaybackSource(src: PlayerSrc): Omit<PlayerSrc, "continuation"> {
  const origin = persistableAddonOrigin(src.meta.addonOrigin);
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
      ...(origin
        ? { addonOrigin: fields(origin, ["id", "name", "logo", "base", "configurationKey"]) }
        : {}),
      ...(src.meta.providerBadge
        ? { providerBadge: fields(src.meta.providerBadge, ["name", "logo", "tint"]) }
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
    ...(src.episode
      ? {
          episode: fields(src.episode, [
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
        }
      : {}),
    ...(src.episodeSpan
      ? { episodeSpan: fields(src.episodeSpan, ["season", "episode", "episodeEnd"]) }
      : {}),
    ...(src.streamRef
      ? {
          streamRef: fields(src.streamRef, [
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
  const serverSubtitle =
    src.homeServer && choice.source
      ? src.subtitles?.find((track) => track.url === choice.source)
      : undefined;
  const homeServerSubtitleId = saved.homeServerSubtitleId ?? serverSubtitle?.id;
  if (src.homeServer) {
    delete saved.trackId;
    // A server track ID is stable only when supplied by its source catalogue.
    if (homeServerSubtitleId) return { ...saved, homeServerSubtitleId };
    if (serverSubtitle) return saved;
  }
  const source = persistablePlaybackUrl(choice.source);
  return source ? { ...saved, source } : saved;
}
