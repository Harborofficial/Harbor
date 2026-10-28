import { safeFetch as fetch } from "@/lib/safe-fetch";
import { STREMBOXD_BASE } from "./config";
import {
  getCachedCatalog,
  getCachedManifest,
  getCachedMeta,
  setCachedCatalog,
  setCachedManifest,
  setCachedMeta,
} from "./cache";
import type {
  LetterboxdFilm,
  LetterboxdFilmRating,
  LetterboxdListRef,
  LetterboxdLoginResponse,
  LetterboxdUsernameValidation,
  StremboxdCatalogResponse,
  StremboxdManifest,
  StremboxdMeta,
  StremboxdMetaResponse,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Stremboxd API client.
//
// Step 0 findings — behaviour that differs from the integration brief:
//
//  1. Base host. The Stremio addon protocol is served by the Fastify backend at
//     `https://api.stremboxd.com`, NOT `https://stremboxd.com` (that host only
//     serves the Next.js configure page and returns HTML for addon paths).
//
//  2. Config shape. The encoded config segment is base64url(JSON) of
//     { u?, c:{watchlist?,popular,top250,likedFilms?}, l:[], r, ... } — there is
//     NO `mode` and NO `username` field (username is `u`). `popular`/`top250`
//     are required booleans, `l` and `r` are required. The brief's example
//     config `{"username":"esp4ce","mode":"public"}` fails schema validation.
//
//  3. Full mode. Full mode is NOT encoded in the config. It is established by
//     POST /auth/login {username,password,totp?}, which returns a `userToken`
//     (JWT) and `user.id` (32-hex). Diary / friends / recommended catalogs live
//     on /stremio/:userId/catalog/* (server-side preferences). Film relationship
//     reads (rating/liked/watched/inWatchlist) live on /v1/film-rating and take
//     `Authorization: Bearer <userToken>`.
//
//  4. Quick-action writes (rate/like/watched). The only write endpoints are
//     /action/:userId/:action/:filmId?tok=... — they require a server-signed
//     HMAC `tok` (action-sign.ts, keyed by the server JWT secret) and return
//     HTML success pages, not JSON. A first-party client cannot mint `tok`, so
//     inline JSON toggles are not possible. The detail panel therefore shows
//     read-only status (full mode) and links out to Letterboxd for editing.
//
//  5. Meta items. Catalog `metas[]` are standard Stremio meta: `id` is an imdb
//     `tt...`, `imdbRating` is a STRING, `year` is a number. There is no
//     dedicated `letterboxdRating`/`letterboxdUri` field on catalog items; the
//     Letterboxd film URL is attached to `meta.links` (category "Letterboxd") by
//     the /:config/meta/movie/:imdbId.json route.
// ─────────────────────────────────────────────────────────────────────────────

export class StremboxdApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Stremboxd HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

export type CatalogPage = { metas: StremboxdMeta[]; hasMore: boolean };

const PAGE_SIZE = 100;

function manifestUrl(configSegment: string): string {
  return `${STREMBOXD_BASE}/${configSegment}/manifest.json`;
}

function catalogUrl(configSegment: string, catalogId: string, skip: number): string {
  const base = `${STREMBOXD_BASE}/${configSegment}/catalog/movie/${catalogId}`;
  return skip > 0 ? `${base}/skip=${skip}.json` : `${base}.json`;
}

function fullCatalogUrl(userId: string, catalogId: string, skip: number): string {
  const base = `${STREMBOXD_BASE}/stremio/${userId}/catalog/movie/${catalogId}`;
  return skip > 0 ? `${base}/skip=${skip}.json` : `${base}.json`;
}

function metaUrl(configSegment: string, imdbId: string): string {
  return `${STREMBOXD_BASE}/${configSegment}/meta/movie/${imdbId}.json`;
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new StremboxdApiError(res.status, body);
  }
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown, auth?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers["Authorization"] = `Bearer ${auth}`;
  const url = `${STREMBOXD_BASE}${path}`;
  const bodyStr = JSON.stringify(body);
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: bodyStr });
  } catch {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    res = await tauriFetch(url, { method: "POST", headers, body: bodyStr });
  }
  return asJson<T>(res);
}

async function getJson<T>(path: string, auth?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth) headers["Authorization"] = `Bearer ${auth}`;
  const res = await fetch(`${STREMBOXD_BASE}${path}`, { headers });
  return asJson<T>(res);
}

export class StremboxdClient {
  constructor(private configSegment: string) {}

  async getManifest(): Promise<StremboxdManifest> {
    const key = this.configSegment;
    const cached = getCachedManifest<StremboxdManifest>(key);
    if (cached) return cached;
    const manifest = await asJson<StremboxdManifest>(await fetch(manifestUrl(key)));
    setCachedManifest(key, manifest);
    return manifest;
  }

  async getCatalog(catalogId: string, skip = 0): Promise<CatalogPage> {
    const key = `${this.configSegment}:${catalogId}:${skip}`;
    const cached = getCachedCatalog<CatalogPage>(key);
    if (cached) return cached;
    const { metas } = await asJson<StremboxdCatalogResponse>(
      await fetch(catalogUrl(this.configSegment, catalogId, skip)),
    );
    const page: CatalogPage = { metas, hasMore: metas.length >= PAGE_SIZE };
    setCachedCatalog(key, page);
    return page;
  }

  async getMeta(imdbId: string): Promise<StremboxdMeta | null> {
    const key = `${this.configSegment}:${imdbId}`;
    const cached = getCachedMeta<StremboxdMeta>(key);
    if (cached !== undefined) return cached;
    const { meta } = await asJson<StremboxdMetaResponse>(await fetch(metaUrl(this.configSegment, imdbId)));
    if (meta) setCachedMeta(key, meta);
    return meta ?? null;
  }
}

export async function fetchStremboxdManifest(configSegment: string): Promise<StremboxdManifest> {
  return new StremboxdClient(configSegment).getManifest();
}

export async function fetchStremboxdCatalog(
  configSegment: string,
  catalogId: string,
  skip = 0,
): Promise<CatalogPage> {
  return new StremboxdClient(configSegment).getCatalog(catalogId, skip);
}

export async function fetchStremboxdMeta(
  configSegment: string,
  imdbId: string,
): Promise<StremboxdMeta | null> {
  return new StremboxdClient(configSegment).getMeta(imdbId);
}

export async function fetchFullModeCatalog(
  userId: string,
  catalogId: string,
  skip = 0,
): Promise<CatalogPage> {
  const key = `full:${userId}:${catalogId}:${skip}`;
  const cached = getCachedCatalog<CatalogPage>(key);
  if (cached) return cached;
  const { metas } = await asJson<StremboxdCatalogResponse>(await fetch(fullCatalogUrl(userId, catalogId, skip)));
  const page: CatalogPage = { metas, hasMore: metas.length >= PAGE_SIZE };
  setCachedCatalog(key, page);
  return page;
}

export async function fetchFullModeManifest(userId: string): Promise<StremboxdManifest> {
  const key = `full-manifest:${userId}`;
  const cached = getCachedManifest<StremboxdManifest>(key);
  if (cached) return cached;
  const manifest = await asJson<StremboxdManifest>(
    await fetch(`${STREMBOXD_BASE}/stremio/${userId}/manifest.json`),
  );
  setCachedManifest(key, manifest);
  return manifest;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reviews — fetched from the full-mode meta endpoint.
//
// GET /stremio/:userId/meta/movie/:imdbId.json returns a Stremio meta object
// whose `links[]` array includes entries with category "Letterboxd Popular
// Reviews". Each link's `name` is a formatted string like:
//   "An absolute masterpiece..." — Emily ★★★★☆
// and `url` points to the film's reviews page on letterboxd.com.
//
// We parse these into structured review objects for display.
// ─────────────────────────────────────────────────────────────────────────────

export type LetterboxdReview = {
  text: string;
  author: string;
  authorUrl: string;
  avatar: string | null;
  rating: string | null;
  lang: string | null;
  date: string | null;
  url: string;
};

// Scrape reviews directly from letterboxd.com — bypasses Stremboxd's 2-review
// English-only limit (see fetchLetterboxdReviewsDirect below).
// Cloudflare-protected fetch helper — sends browser-like headers that
// harbor_fetch (Rust reqwest) uses to bypass Letterboxd's Cloudflare challenge.
// safeFetch already sends a good User-Agent via harbor_fetch, but we add
// Accept-Language and a Referer hint to improve pass-through.
async function fetchWithCloudflareBypass(url: string): Promise<Response> {
  const headers: Record<string, string> = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
  try {
    const res = await fetch(url, { headers });
    return res;
  } catch (e) {
    console.warn("[Letterboxd] safeFetch failed, trying tauri plugin:", e);
    try {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      const res = await tauriFetch(url, { headers });
      return res;
    } catch (e2) {
      console.error("[Letterboxd] tauriFetch also failed:", e2);
      throw e2;
    }
  }
}

export type LetterboxdReviewSort = "popular" | "newest" | "highest" | "lowest" | "longest";

// Letterboxd's own review orders (/film/{slug}/reviews/by/...). "longest" has no server order:
// it sorts the popular reviews by length.
const SORT_PATH: Record<LetterboxdReviewSort, string> = {
  popular: "by/activity/",
  newest: "by/added/",
  highest: "by/entry-rating/",
  lowest: "by/entry-rating-lowest/",
  longest: "by/activity/",
};
const REVIEW_PAGES = 3; // 12 reviews per page
const FULL_TEXT_CONCURRENCY = 3;
const slugCache = new Map<string, string>();

function isChallenge(html: string): boolean {
  return html.includes("Just a moment...") || html.includes("__cf_chl_opt");
}

type HtmlResult = { html: string } | { failed: "http" | "challenge" | "network" };

async function fetchLetterboxdPage(url: string): Promise<HtmlResult> {
  try {
    const res = await fetchWithCloudflareBypass(url);
    if (!res.ok) return { failed: "http" };
    const html = await res.text();
    return isChallenge(html) ? { failed: "challenge" } : { html };
  } catch {
    return { failed: "network" };
  }
}

async function fetchLetterboxdHtml(url: string): Promise<string | null> {
  const result = await fetchLetterboxdPage(url);
  return "html" in result ? result.html : null;
}

type ParsedReview = LetterboxdReview & { fullTextUrl: string | null };

function parseReviewArticles(html: string, pageUrl: string): ParsedReview[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const abs = (path: string) => (path.startsWith("http") ? path : `https://letterboxd.com${path}`);
  const reviews: ParsedReview[] = [];
  for (const art of doc.querySelectorAll("article.production-viewing")) {
    // Only articles with a review body (some are plain activity entries).
    const bodyEl = art.querySelector(".js-review-body") as HTMLElement | null;
    const text = bodyEl?.textContent?.trim() ?? "";
    if (!bodyEl || !text) continue;
    const authorPath = art.querySelector("a.avatar")?.getAttribute("href") ?? "";
    const avatarSrc = art.querySelector("a.avatar img")?.getAttribute("src") ?? "";
    reviews.push({
      text,
      author: art.querySelector(".displayname")?.textContent?.trim() ?? "",
      authorUrl: authorPath ? abs(authorPath) : "",
      avatar: avatarSrc ? abs(avatarSrc) : null,
      rating: art.querySelector(".inline-rating svg")?.getAttribute("aria-label") ?? null,
      lang: bodyEl.getAttribute("lang") ?? null,
      date: art.querySelector("time.timestamp")?.getAttribute("datetime") ?? null,
      url: pageUrl,
      fullTextUrl: bodyEl.getAttribute("data-full-text-url"),
    });
  }
  return reviews;
}

/** The full-text URL of a review, only when it is a Letterboxd full-text path. */
export function letterboxdFullTextUrl(path: string | null): string | null {
  if (!path) return null;
  try {
    const url = new URL(path, "https://letterboxd.com");
    if (url.origin !== "https://letterboxd.com" || !/^\/s\/full-text\/[\w:-]+\/?$/.test(url.pathname))
      return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * The review text in a full-text response: a bare fragment of the review's paragraphs, or a whole
 * page that holds it in its review body. Null when neither shape is there, so the caller keeps
 * the text it had.
 */
export function letterboxdFullText(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const paragraphs = (root: Element) =>
    [...root.querySelectorAll("p")].map((p) => p.textContent?.trim() ?? "").filter(Boolean);
  const body = doc.querySelector(".js-review-body, .review .body-text, .body-text");
  if (body) {
    const found = paragraphs(body);
    return found.length ? found.join("\n\n") : body.textContent?.trim() || null;
  }
  // A fragment: nothing but paragraphs (and line breaks) at the top level.
  const top = [...doc.body.children];
  if (top.length && top.every((el) => el.tagName === "P" || el.tagName === "BR")) {
    const found = paragraphs(doc.body);
    return found.length ? found.join("\n\n") : null;
  }
  return null;
}

// Lists cut long reviews short with "…"; each review links its full text.
async function expandTruncated(reviews: ParsedReview[]): Promise<void> {
  const cut = reviews.filter((r) => /(…|\.\.\.)$/.test(r.text) && letterboxdFullTextUrl(r.fullTextUrl));
  let next = 0;
  const worker = async () => {
    while (next < cut.length) {
      const review = cut[next++]!;
      const html = await fetchLetterboxdHtml(letterboxdFullTextUrl(review.fullTextUrl)!);
      const text = html ? letterboxdFullText(html) : null;
      if (text) review.text = text;
    }
  };
  await Promise.all(Array.from({ length: Math.min(FULL_TEXT_CONCURRENCY, cut.length) }, worker));
}

/** Stars as a number ("★★★½" → 3.5), or null when the review has no rating. */
export function letterboxdStars(rating: string | null): number | null {
  if (!rating) return null;
  const stars = (rating.match(/★/g) ?? []).length + (rating.includes("½") ? 0.5 : 0);
  return stars || null;
}

export function sortLetterboxdReviews<T extends LetterboxdReview>(
  reviews: T[],
  sortBy: LetterboxdReviewSort,
): T[] {
  const time = (r: T) => (r.date ? Date.parse(r.date) || 0 : 0);
  const compare: Record<LetterboxdReviewSort, ((a: T, b: T) => number) | null> = {
    popular: null,
    newest: (a, b) => time(b) - time(a),
    // Unrated reviews go last in both rating orders.
    highest: (a, b) => (letterboxdStars(b.rating) ?? -1) - (letterboxdStars(a.rating) ?? -1),
    lowest: (a, b) => (letterboxdStars(a.rating) ?? 6) - (letterboxdStars(b.rating) ?? 6),
    longest: (a, b) => b.text.length - a.text.length,
  };
  const fn = compare[sortBy];
  return fn ? [...reviews].sort(fn) : reviews;
}

const strip = ({ fullTextUrl: _drop, ...review }: ParsedReview): LetterboxdReview => review;
const reviewKey = (r: LetterboxdReview) => `${r.author}\u0000${r.text.slice(0, 80)}`;

export type LetterboxdReviewsResult = {
  reviews: LetterboxdReview[];
  hasNext: boolean;
  /** "server": Letterboxd's sorted review pages; "film-page": the film page's popular reviews. */
  source: "server" | "film-page" | "none";
  /** Some sorted pages loaded and a later one was blocked; the film page filled in. */
  partial: boolean;
  /** The order asked for could not be applied (the film page has no review dates). */
  sortUnavailable: boolean;
};

// Reviews for a film in one of Letterboxd's review orders. Reads the first few sorted review
// pages one after another (parallel requests get challenged). /reviews/ is often behind
// Cloudflare (403); then it falls back to the popular reviews on the film's main page, which
// is not, and sorts those here.
export async function fetchLetterboxdReviewsDirect(
  imdbId: string,
  _page = 1,
  sortBy: LetterboxdReviewSort = "popular",
): Promise<LetterboxdReviewsResult> {
  const empty: LetterboxdReviewsResult = {
    reviews: [],
    hasNext: false,
    source: "none",
    partial: false,
    sortUnavailable: false,
  };
  // The IMDb redirect page IS the film's main page: it carries the slug and popular reviews.
  const filmPage = `https://letterboxd.com/imdb/${imdbId}/`;
  let slug = slugCache.get(imdbId) ?? null;
  let filmHtml: string | null = null;
  if (!slug) {
    filmHtml = await fetchLetterboxdHtml(filmPage);
    if (!filmHtml) return empty;
    slug = filmHtml.match(/letterboxd\.com\/film\/([^/"'?\s#]+)/)?.[1] ?? null;
    if (slug) slugCache.set(imdbId, slug);
  }

  const reviewsUrl = slug ? `https://letterboxd.com/film/${slug}/reviews/` : filmPage;
  let reviews: ParsedReview[] = [];
  // A failed page (HTTP error, challenge, network) is not the end of the list: an empty page is.
  let pageFailed = !slug;
  if (slug) {
    for (let page = 1; page <= REVIEW_PAGES; page++) {
      const result = await fetchLetterboxdPage(
        `${reviewsUrl}${SORT_PATH[sortBy]}${page > 1 ? `page/${page}/` : ""}`,
      );
      if (!("html" in result)) {
        pageFailed = true;
        break;
      }
      const found = parseReviewArticles(result.html, reviewsUrl);
      if (!found.length) break;
      reviews.push(...found);
    }
  }
  const fromServer = reviews.length > 0;
  if (pageFailed) {
    filmHtml ??= await fetchLetterboxdHtml(filmPage);
    const seen = new Set(reviews.map(reviewKey));
    const extra = filmHtml
      ? parseReviewArticles(filmHtml, reviewsUrl).filter((r) => !seen.has(reviewKey(r)))
      : [];
    reviews.push(...extra);
  }
  if (!reviews.length) return empty;

  await expandTruncated(reviews);
  const source = fromServer ? "server" : "film-page";
  // Server pages are already in order; reviews added from the film page are sorted with them
  // where the order can be computed here (stars, length), and follow them otherwise.
  const sortHere = sortBy === "longest" || (pageFailed && (sortBy === "highest" || sortBy === "lowest"));
  if (sortHere) reviews = sortLetterboxdReviews(reviews, sortBy);
  return {
    reviews: reviews.map(strip),
    hasNext: false,
    source,
    partial: fromServer && pageFailed,
    // A blocked later page means film-page reviews may be appended without dates, so the
    // combined newest order is no longer reliable even when page one came from the server.
    sortUnavailable: sortBy === "newest" && pageFailed,
  };
}

// Fetch friends' reviews — uses letterboxd.com/{username}/friends/film/{slug}/reviews/
// which returns 200 (unlike /by/activity/ which is 403'd by Cloudflare).
// Requires the user's Letterboxd username + the film slug.
export async function fetchLetterboxdFriendsReviews(
  username: string,
  imdbId: string,
): Promise<LetterboxdReview[]> {
  // First resolve the film slug from the IMDb redirect page
  const url = `https://letterboxd.com/imdb/${imdbId}/`;
  let html: string;
  try {
    const res = await fetchWithCloudflareBypass(url);
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }
  if (html.includes("Just a moment...") || html.includes("__cf_chl_opt")) return [];

  const slugMatch = html.match(/letterboxd\.com\/film\/([^/"'?\s#]+)/);
  const slug = slugMatch ? slugMatch[1]! : null;
  if (!slug) return [];

  // Now fetch friends reviews
  const friendsUrl = `https://letterboxd.com/${username}/friends/film/${slug}/reviews/`;
  let friendsHtml: string;
  try {
    const res = await fetchWithCloudflareBypass(friendsUrl);
    if (!res.ok) {
      console.warn(`[Letterboxd] friends reviews HTTP ${res.status}`);
      return [];
    }
    friendsHtml = await res.text();
  } catch (e) {
    console.error("[Letterboxd] friends reviews fetch error:", e);
    return [];
  }

  if (friendsHtml.includes("Just a moment...") || friendsHtml.includes("__cf_chl_opt")) {
    console.warn("[Letterboxd] Cloudflare on friends reviews");
    return [];
  }

  const doc = new DOMParser().parseFromString(friendsHtml, "text/html");
  const articles = doc.querySelectorAll("article.production-viewing");
  console.log(`[Letterboxd] found ${articles.length} friends reviews`);

  const reviews: LetterboxdReview[] = [];
  for (const art of articles) {
    const bodyEl = art.querySelector(".js-review-body") as HTMLElement | null;
    if (!bodyEl) continue;
    const text = bodyEl.textContent?.trim() ?? "";
    if (!text) continue;

    const authorEl = art.querySelector(".displayname");
    const author = authorEl?.textContent?.trim() ?? "";
    const authorLink = art.querySelector("a.avatar") as HTMLAnchorElement | null;
    const authorPath = authorLink?.getAttribute("href") ?? "";
    const authorUrl = authorPath
      ? authorPath.startsWith("http") ? authorPath : `https://letterboxd.com${authorPath}`
      : "";
    const avatarImg = art.querySelector("a.avatar img") as HTMLImageElement | null;
    const avatarSrc = avatarImg?.getAttribute("src") ?? "";
    const avatar = avatarSrc
      ? avatarSrc.startsWith("http") ? avatarSrc : `https://letterboxd.com${avatarSrc}`
      : null;
    const ratingSvg = art.querySelector(".inline-rating svg") as SVGSVGElement | null;
    const rating = ratingSvg?.getAttribute("aria-label") ?? null;
    const lang = bodyEl.getAttribute("lang") ?? null;
    const dateEl = art.querySelector("time.timestamp") as HTMLElement | null;
    const date = dateEl?.getAttribute("datetime") ?? null;

    reviews.push({ text, author, authorUrl, avatar, rating, lang, date, url: friendsUrl });
  }

  console.log(`[Letterboxd] parsed ${reviews.length} friends reviews`);
  return reviews;
}

// Update server-side preferences (which catalogs are enabled, etc.)
// This controls what appears in the dynamic manifest.
export type LetterboxdPreferences = {
  catalogs: {
    watchlist: boolean;
    diary: boolean;
    friends: boolean;
    popular: boolean;
    top250: boolean;
    likedFilms: boolean;
    recommended: boolean;
  };
  ownLists: string[];
  externalLists: Array<{ id: string; name: string; owner: string; filmCount: number }>;
  externalWatchlists?: Array<{ username: string; displayName: string }>;
  contributors?: Array<{ t: "d" | "a" | "s"; id: string; name: string }>;
  showActions?: boolean;
  showRatings?: boolean;
  showReviews?: boolean;
  hideUnreleased?: boolean;
  search?: boolean;
  catalogNames?: Record<string, string>;
  catalogOrder?: string[];
  sortVariants?: Record<string, string[]>;
};

export async function updateLetterboxdPreferences(
  userToken: string,
  preferences: LetterboxdPreferences,
): Promise<void> {
  await postJson<{ success: boolean }>("/auth/preferences", { userToken, preferences });
}

export type ManifestValidation =
  | { ok: true; catalogs: number; hasWatchlist: boolean }
  | { ok: false; reason: "network" | "invalid" | "no-catalogs"; message: string };

export async function validateStremboxdConfig(
  configSegment: string,
  expectWatchlist: boolean,
): Promise<ManifestValidation> {
  try {
    const manifest = await asJson<StremboxdManifest>(await fetch(manifestUrl(configSegment)));
    if (manifest.id !== "community.stremboxd") {
      return { ok: false, reason: "invalid", message: "Unexpected manifest from Stremboxd." };
    }
    if (!Array.isArray(manifest.catalogs) || manifest.catalogs.length === 0) {
      return { ok: false, reason: "no-catalogs", message: "No catalogs returned for this configuration." };
    }
    const hasWatchlist = manifest.catalogs.some((c) => c.id === "letterboxd-watchlist");
    if (expectWatchlist && !hasWatchlist) {
      return {
        ok: false,
        reason: "invalid",
        message: "Letterboxd did not return a watchlist for this username. Check the username is correct and public.",
      };
    }
    return { ok: true, catalogs: manifest.catalogs.length, hasWatchlist };
  } catch (e) {
    if (e instanceof StremboxdApiError) {
      return { ok: false, reason: "invalid", message: e.status === 400 ? "Invalid configuration." : `Stremboxd error (${e.status}).` };
    }
    return { ok: false, reason: "network", message: "Could not reach Stremboxd. Check your connection." };
  }
}

export async function validateLetterboxdUsername(username: string): Promise<LetterboxdUsernameValidation> {
  return postJson<LetterboxdUsernameValidation>("/auth/validate-username", { username });
}

export async function resolveLetterboxdListPublic(url: string): Promise<LetterboxdListRef> {
  return postJson<LetterboxdListRef>("/auth/resolve-list-public", { url });
}

export async function loginLetterboxd(
  username: string,
  password: string,
  totp?: string,
): Promise<LetterboxdLoginResponse> {
  const body = JSON.stringify({ username, password, ...(totp ? { totp } : {}) });
  const url = `${STREMBOXD_BASE}/auth/login`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch {
    // safeFetch in Tauri has no fallback for POST — retry with the plugin
    // directly if the Rust harbor_fetch command failed.
    try {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      res = await tauriFetch(url, { method: "POST", headers, body });
    } catch {
      throw new StremboxdLoginError(0, "Could not reach Stremboxd. Check your connection.", undefined);
    }
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let code: string | undefined;
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: string; code?: string };
      code = parsed.code;
      message = parsed.error || text;
    } catch {
      /* keep raw text */
    }
    throw new StremboxdLoginError(res.status, message, code);
  }
  try {
    return JSON.parse(text) as LetterboxdLoginResponse;
  } catch {
    throw new StremboxdLoginError(res.status, "Unexpected response from Stremboxd.", undefined);
  }
}

export class StremboxdLoginError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function resolveLetterboxdFilm(imdbId: string, userToken: string): Promise<LetterboxdFilm | null> {
  try {
    return await getJson<LetterboxdFilm>(`/v1/resolve-film?imdbId=${encodeURIComponent(imdbId)}`, userToken);
  } catch (e) {
    if (e instanceof StremboxdApiError && e.status === 404) return null;
    throw e;
  }
}

export async function fetchLetterboxdFilmRating(filmId: string, userToken: string): Promise<LetterboxdFilmRating> {
  return getJson<LetterboxdFilmRating>(`/v1/film-rating?filmId=${encodeURIComponent(filmId)}`, userToken);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream endpoint — the canonical way to get film status + action URLs.
//
// GET /stremio/:userId/stream/movie/:imdbId.json returns { streams: [...] }.
// The first stream carries rating/status info in its `description` (newline-
// separated). The remaining streams carry pre-signed action URLs in
// `externalUrl` (the `tok` query param is an HMAC signed by the server).
//
// Opening an action URL performs the write and returns an HTML success page.
// We parse the stream descriptions/URLs to render interactive controls.
// ─────────────────────────────────────────────────────────────────────────────

export type LetterboxdStream = {
  name: string;
  description: string;
  externalUrl: string;
  behaviorHints?: { notWebReady?: boolean; bingeGroup?: string };
};

export type LetterboxdStreamInfo = {
  communityRating: number | null;
  communityRatings: number;
  watched: boolean;
  liked: boolean;
  inWatchlist: boolean;
  userRating: number | null;
  letterboxdUrl: string | null;
  rateUrl: string | null;
  watchedUrl: string | null;
  likedUrl: string | null;
  watchlistUrl: string | null;
};

export async function fetchLetterboxdStreams(userId: string, imdbId: string): Promise<LetterboxdStreamInfo | null> {
  const res = await fetch(`${STREMBOXD_BASE}/stremio/${userId}/stream/movie/${encodeURIComponent(imdbId)}.json`);
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body) return null;
  const streams: LetterboxdStream[] = body.streams ?? [];
  if (streams.length === 0) return null;

  let info: LetterboxdStreamInfo = {
    communityRating: null,
    communityRatings: 0,
    watched: false,
    liked: false,
    inWatchlist: false,
    userRating: null,
    letterboxdUrl: null,
    rateUrl: null,
    watchedUrl: null,
    likedUrl: null,
    watchlistUrl: null,
  };

  for (const s of streams) {
    const name = s.name ?? "";
    const url = s.externalUrl ?? "";

    // Stream 1: info — name is "Letterboxd", description carries status lines
    if (name === "Letterboxd" || (!url.includes("/action/") && !info.letterboxdUrl)) {
      info.letterboxdUrl = url || null;
      const lines = (s.description ?? "").split("\n");
      for (const line of lines) {
        const ratingMatch = line.match(/(\d+\.\d+)\s*\/\s*5/);
        if (ratingMatch) info.communityRating = parseFloat(ratingMatch[1]!);
        if (line.includes("✓ Watched")) info.watched = true;
        if (line.includes("♥ Liked")) info.liked = true;
        if (line.includes("In Watchlist")) info.inWatchlist = true;
        const yourMatch = line.match(/Your rating:.*?(\d+\.\d+)/);
        if (yourMatch) info.userRating = parseFloat(yourMatch[1]!);
        const countMatch = line.match(/\(([\d.]+K?)\s*ratings\)/);
        if (countMatch) info.communityRatings = parseCount(countMatch[1]!);
      }
    }

    // Action streams — identify by URL path
    if (url.includes("/rate/")) info.rateUrl = url;
    if (url.includes("/watched/")) info.watchedUrl = url;
    if (url.includes("/liked/")) info.likedUrl = url;
    if (url.includes("/watchlist/")) info.watchlistUrl = url;
  }

  return info;
}

function parseCount(s: string): number {
  if (s.endsWith("K")) return Math.round(parseFloat(s) * 1000);
  if (s.endsWith("M")) return Math.round(parseFloat(s) * 1000000);
  return parseInt(s, 10) || 0;
}
