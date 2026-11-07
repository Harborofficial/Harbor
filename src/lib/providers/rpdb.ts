import { addonOnlyMetadata } from "@/lib/metadata-policy";
import { posterTransformEnabledFromStorage } from "@/lib/metadata-sources";
import { normalizeLang } from "@/lib/subtitles/language";

let posterBase = "";
let posterLang = "";

export function setPosterBaseUrl(url: string): void {
  posterBase = url.trim().replace(/\/+$/, "");
}

/**
 * Custom poster services render their own labels from a `lang` query
 * parameter. Resolve it from the image-language priority first, so a Pictorium
 * template that was copied without `lang` does not fall back to its own
 * national default (for example Italian).
 */
export function setPosterLanguage(
  imageLangs: readonly string[] | undefined,
  metadataLanguage?: string,
  uiLanguage?: string,
): void {
  for (const name of imageLangs ?? []) {
    if (/^original$/i.test(name.trim())) continue;
    const code = normalizeLang(name);
    if (code) {
      posterLang = code;
      return;
    }
  }
  posterLang =
    (metadataLanguage ?? "").split("-")[0]?.toLowerCase() || (uiLanguage ?? "").toLowerCase();
}

type ParsedId = {
  imdb?: string;
  tmdbId?: string;
  tvdbId?: string;
  mediaType: "movie" | "series";
};

type ArtKind = "poster" | "backdrop";

function parseMetaId(metaId: string): ParsedId | undefined {
  if (!metaId) return undefined;
  if (metaId.startsWith("tt")) return { imdb: metaId, mediaType: "movie" };
  const tmdb = metaId.match(/^tmdb:(movie|tv):(\d+)$/);
  if (tmdb) {
    return { tmdbId: tmdb[2], mediaType: tmdb[1] === "tv" ? "series" : "movie" };
  }
  const tvdb = metaId.match(/^tvdb:(\d+)$/);
  if (tvdb) {
    return { tvdbId: tvdb[1], mediaType: "series" };
  }
  return undefined;
}

function fillTemplate(template: string, id: ParsedId, kind: ArtKind): string | undefined {
  const idToken = id.imdb ?? (id.tmdbId ? `${id.mediaType}-${id.tmdbId}` : undefined);
  if (!idToken) return undefined;
  let out = template;
  const shape = kind === "backdrop" ? "landscape" : "poster";
  const usesShape = out.includes("{shape}");
  const usesLang = out.includes("{lang}");
  const sub = (token: string, value: string | undefined): boolean => {
    if (!out.includes(token)) return true;
    if (!value) return false;
    out = out.split(token).join(value);
    return true;
  };
  if (!sub("{shape}", shape)) return undefined;
  if (!sub("{lang}", posterLang || undefined)) return undefined;
  if (!sub("{imdbId}", id.imdb)) return undefined;
  if (!sub("{imdb_id}", id.imdb)) return undefined;
  if (!sub("{tmdbId}", id.tmdbId)) return undefined;
  if (!sub("{tmdb_id}", id.tmdbId)) return undefined;
  if (!sub("{tmdb_id|imdb_id}", id.tmdbId ?? id.imdb)) return undefined;
  sub("{type}", id.mediaType);
  sub("{mediaType}", id.mediaType);
  if (!sub("{id}", idToken)) return undefined;
  // PostersPlus and Pictorium both pick their 16:9 renderer from this query
  // parameter. A template that does not spell out {shape} gets it appended so
  // a copied poster template also works for TV cards.
  if (kind === "backdrop" && !usesShape && shapeAwareTemplate(out)) {
    out = withQueryParam(out, "shape", shape);
  }
  if (!usesLang && posterLang && langAwareTemplate(out)) {
    out = withQueryParam(out, "lang", posterLang);
  }
  return out;
}

function shapeAwareTemplate(template: string): boolean {
  const lower = template.toLowerCase();
  return (
    lower.includes("pictorium") ||
    lower.includes("postersplus") ||
    lower.includes("/api/poster/") ||
    (/\/poster\?/.test(lower) && /[?&]tmdb_id=/.test(lower))
  );
}

function langAwareTemplate(template: string): boolean {
  return shapeAwareTemplate(template) || template.toLowerCase().includes("btttr.cc");
}

function withQueryParam(url: string, name: string, value: string): string {
  const pattern = new RegExp(`([?&])${name}=[^&#]*`, "i");
  if (pattern.test(url)) {
    return url.replace(pattern, `$1${name}=${value}`);
  }
  return `${url}${url.includes("?") ? "&" : "?"}${name}=${value}`;
}

function withLang(url: string): string {
  return posterLang ? withQueryParam(url, "lang", posterLang) : url;
}

function artPath(base: string, key: string, id: ParsedId, kind: ArtKind): string | undefined {
  if (!key) return undefined;
  const keySeg = key;
  const type = kind === "backdrop" ? "backdrop-default" : "poster-default";
  if (id.imdb) {
    return withLang(`${base}/${keySeg}/imdb/${type}/${id.imdb}.jpg?fallback=true`);
  }
  if (id.tmdbId) {
    return withLang(
      `${base}/${keySeg}/tmdb/${type}/${id.mediaType}-${id.tmdbId}.jpg?fallback=true`,
    );
  }
  if (id.tvdbId) {
    return withLang(`${base}/${keySeg}/tvdb/${type}/series-${id.tvdbId}.jpg?fallback=true`);
  }
  return undefined;
}

function betterPostersPath(base: string, id: ParsedId): string | undefined {
  if (!id.imdb) return undefined;
  return withLang(`${base}/poster/imdb/poster-default/${id.imdb}.jpg`);
}

function postersPlusPath(base: string, id: ParsedId, kind: ArtKind): string | undefined {
  if (!id.imdb || !id.tmdbId) return undefined;
  const root = base.replace(/\/+$/, "").replace(/\/poster$/i, "");
  const type = id.mediaType === "series" ? "series" : "movie";
  const shape = kind === "backdrop" ? "&shape=landscape" : "";
  return withLang(`${root}/poster?tmdb_id=${id.tmdbId}&imdb_id=${id.imdb}&type=${type}${shape}`);
}

function mergeAlt(id: ParsedId, altId?: string): ParsedId {
  if (!altId) return id;
  const other = parseMetaId(altId);
  if (!other) return id;
  const typed = id.tmdbId ? id : other.tmdbId ? other : id;
  return {
    imdb: id.imdb ?? other.imdb,
    tmdbId: id.tmdbId ?? other.tmdbId,
    tvdbId: id.tvdbId ?? other.tvdbId,
    mediaType: typed.mediaType,
  };
}

export function rpdbPoster(
  key: string,
  metaId: string,
  fallback?: string,
  altId?: string,
  base = posterBase,
  mediaType?: "movie" | "series",
): string | undefined {
  return posterServiceArt("poster", key, metaId, fallback, altId, base, mediaType);
}

/**
 * The 16:9 counterpart of rpdbPoster. RPDB-compatible hosts serve
 * backdrop-default, PostersPlus and Pictorium switch renderer with
 * shape=landscape, and a template can opt in with {shape}. Better Posters has
 * no landscape endpoint, so its TV cards keep using the metadata backdrop.
 */
export function rpdbBackdrop(
  key: string,
  metaId: string,
  fallback?: string,
  altId?: string,
  base = posterBase,
  mediaType?: "movie" | "series",
): string | undefined {
  return posterServiceArt("backdrop", key, metaId, fallback, altId, base, mediaType);
}

function posterServiceArt(
  kind: ArtKind,
  key: string,
  metaId: string,
  fallback: string | undefined,
  altId: string | undefined,
  base: string,
  mediaType: "movie" | "series" | undefined,
): string | undefined {
  if (addonOnlyMetadata() && (!posterTransformEnabledFromStorage() || (!key && !base))) {
    return fallback;
  }
  const parsed = parseMetaId(metaId);
  if (!parsed) return fallback;
  const id = mergeAlt(parsed, altId);
  if (mediaType) id.mediaType = mediaType;

  const host = base.toLowerCase();
  if (kind === "backdrop" && host.includes("btttr.cc")) return fallback;

  if (base.includes("{")) {
    return fillTemplate(base, id, kind) ?? fallback;
  }

  if (!base) {
    if (!key) return fallback;
    return artPath("https://api.ratingposterdb.com", key, id, kind) ?? fallback;
  }

  if (host.includes("ratingposterdb.com")) {
    return artPath(base, key, id, kind) ?? fallback;
  }
  if (host.includes("btttr.cc")) {
    return betterPostersPath(base, id) ?? fallback;
  }
  if (host.includes("pictorium")) {
    // A bare Pictorium host needs the per-space template and user id; there is
    // no generic URL to build from the host alone.
    return fallback;
  }
  if (host.includes("postersplus") || host.includes("elfhosted")) {
    return postersPlusPath(base, id, kind) ?? fallback;
  }

  if (key) return artPath(base, key, id, kind) ?? fallback;
  return fallback;
}

export function needsImdbForPoster(key: string, metaId: string, base = posterBase): boolean {
  if (rpdbPoster(key, metaId, undefined, undefined, base)) return false;
  if (!base && !key) return false;
  return /^tmdb:(movie|tv):\d+$/.test(metaId);
}

export function needsTmdbForPoster(key: string, metaId: string, base = posterBase): boolean {
  if (rpdbPoster(key, metaId, undefined, undefined, base)) return false;
  if (!base) return false;
  return typeof metaId === "string" && metaId.startsWith("tt");
}
