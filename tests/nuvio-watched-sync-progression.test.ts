import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const mediaProviderActions = read("../src/lib/media-provider-actions.ts");
const markWatched = read("../src/lib/mark-watched.ts");
const episodeWatchedMenu = read("../src/components/episode-watched-menu.tsx");
const manualWatched = read("../src/lib/manual-watched.ts");
const nuvioSync = read("../src/lib/nuvio/nuvio-sync.ts");
const seriesEpisodes = read("../src/views/detail/series-episodes.tsx");
const cinemetaEpisodes = read("../src/views/detail/cinemeta-episodes.tsx");
const detail = read("../src/views/detail.tsx");
const stremio = read("../src/lib/stremio.ts");
const continueWatching = read("../src/lib/continue-watching.ts");

test("watchedProviderWrites connects Nuvio cloud sync for both movies and series", () => {
  assert.match(mediaProviderActions, /if \(isNuvioSignedIn\(\)\)/);
  assert.match(mediaProviderActions, /pushWatchedItemToNuvio\(slot, items\)/);
  assert.match(mediaProviderActions, /deleteWatchProgressFromNuvio\(slot, primaryId\)/);
  assert.match(mediaProviderActions, /pushWatchProgressToNuvio\(\s*slot,\s*primaryId,\s*0,/);
  assert.match(mediaProviderActions, /harbor:continue-watching-updated/);
  assert.match(mediaProviderActions, /harbor:nuvio-progress-pushed/);
});

test("mark-watched functions sync to Nuvio for movies and shows", () => {
  assert.match(markWatched, /if \(isNuvioSignedIn\(\)\)/);
  assert.match(markWatched, /pushWatchedItemToNuvio\(slot, \[\s*\{\s*contentId: primaryId,\s*contentType: "movie"/);
  assert.match(markWatched, /deleteWatchedItemFromNuvio\(slot, \[\s*\{\s*contentId: primaryId/);
});

test("EpisodeWatchedMenu filters out specials (Season 0) from upTo count when on regular episode", () => {
  assert.match(episodeWatchedMenu, /targetSeason > 0 && episode\.season <= 0/);
  assert.match(episodeWatchedMenu, /targetSeason === 0 && episode\.season !== 0/);
});

test("manualWatched reconcile does not delete local watched episodes when server has 0 items", () => {
  assert.match(manualWatched, /if \(serverEpisodeKeys\.size > 0\)/);
  assert.match(manualWatched, /serverShowsWithEpisodes\.has\(showId\) && !serverEpisodeKeys\.has\(lKey\)/);
});

test("manualEpisodeKeys supports altIds to prevent vanishing marked episodes across IMDB and TMDB", () => {
  assert.match(manualWatched, /export function manualEpisodeKeys\(\s*metaId: string,\s*altIds\?:/);
  assert.match(seriesEpisodes, /manualEpisodeKeys\(meta\.id, \[imdbId\]\)/);
});

test("detail page loads Nuvio watched items and progress into stremioWatched state", () => {
  assert.match(detail, /pullWatchedItemsFromNuvio\(\)/);
  assert.match(detail, /setStremioWatched\(\(prev\) => new Set\(\[\.\.\.prev, \.\.\.watchedKeys\]\)\)/);
});

test("isCwMember keeps series items when offset is 0 for Next Up or unwatched progression", () => {
  assert.match(stremio, /if \(i\.upNext\) return true;/);
  assert.match(stremio, /i\.type === "series" &&\s*i\.state\.season != null &&\s*i\.state\.episode != null &&\s*\(i\.state\.flaggedWatched \?\? 0\) === 0/);
  assert.match(continueWatching, /upNext: e\.type === "series" && e\.positionMs === 0/);
});

test("marking episode unwatched in series updates CW and Nuvio progress instead of vanishing", () => {
  assert.match(mediaProviderActions, /const firstEp = sorted\[0\];/);
  assert.match(mediaProviderActions, /await pushWatchProgressToNuvio\(\s*slot,\s*primaryId,\s*0,\s*2640,\s*firstEp\.season,\s*firstEp\.episode/);
  assert.match(mediaProviderActions, /saveLocalCw\(unwatchedCw/);
});

test("detail and episode lists infer prior episodes as watched up to current progression", () => {
  // detail.tsx adds prior episodes from progress matches
  assert.match(detail, /for \(let ep = 1; ep < m\.episode; ep\+\+\) \{\s*watchedKeys\.add\(`\$\{m\.season\}:\$\{ep\}`\);/);
  // series-episodes infers prior episodes up to resumeSeason:resumeEpisode
  assert.match(seriesEpisodes, /if \(season\.seasonNumber >= 1 && season\.seasonNumber < resumeSeason\)/);
  assert.match(seriesEpisodes, /stremioWatched: combinedWatched/);
  // cinemeta-episodes infers prior episodes up to resumeSeason:resumeEpisode
  assert.match(cinemetaEpisodes, /s < resumeSeason \|\| \(s === resumeSeason && e < resumeEpisode\)/);
  assert.match(cinemetaEpisodes, /combinedWatched\.has\(`\$\{season\}:\$\{number\}`\)/);
});
