import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const mediaProviderActions = read("../src/lib/media-provider-actions.ts");
const markWatched = read("../src/lib/mark-watched.ts");
const episodeWatchedMenu = read("../src/components/episode-watched-menu.tsx");
const manualWatched = read("../src/lib/manual-watched.ts");
const nuvioSync = read("../src/lib/nuvio/nuvio-sync.ts");
const nuvioAuth = read("../src/lib/nuvio/nuvio-auth.ts");
const nuvioPlayback = read("../src/lib/nuvio/nuvio-playback.ts");
const nuvioProfiles = read("../src/lib/nuvio/nuvio-profiles.ts");
const resume = read("../src/lib/resume.ts");
const seriesEpisodes = read("../src/views/detail/series-episodes.tsx");
const cinemetaEpisodes = read("../src/views/detail/cinemeta-episodes.tsx");
const detail = read("../src/views/detail.tsx");
const stremio = read("../src/lib/stremio.ts");
const continueWatching = read("../src/lib/continue-watching.ts");
const pickerModal = read("../src/components/profile-picker/picker-modal.tsx");
const externalCw = read("../src/lib/feed/external-cw.ts");

test("watchedProviderWrites connects Nuvio cloud sync for both movies and series", () => {
  assert.match(mediaProviderActions, /if \(isNuvioSignedIn\(\)\)/);
  assert.match(mediaProviderActions, /pushWatchedItemToNuvio\(slot, items\)/);
  assert.match(mediaProviderActions, /deleteWatchProgressFromNuvio\(slot, cid\)/);
  assert.match(mediaProviderActions, /deleteEpisodeWatchProgressFromNuvio\(slot, primaryId, ep\.season, ep\.episode\)/);
  assert.match(mediaProviderActions, /harbor:continue-watching-updated/);
  assert.match(mediaProviderActions, /harbor:watched-changed/);
});

test("mark-watched functions sync to Nuvio for movies and shows", () => {
  assert.match(markWatched, /if \(isNuvioSignedIn\(\)\)/);
  assert.match(
    markWatched,
    /pushWatchedItemToNuvio\(slot, \[\s*\{\s*contentId: primaryId,\s*contentType: "movie"/,
  );
  assert.match(markWatched, /deleteWatchedItemFromNuvio\(slot, \[\s*\{\s*contentId: primaryId/);
});

test("EpisodeWatchedMenu filters out specials (Season 0) from upTo count when on regular episode", () => {
  assert.match(episodeWatchedMenu, /targetSeason > 0 && episode\.season <= 0/);
  assert.match(episodeWatchedMenu, /targetSeason === 0 && episode\.season !== 0/);
});

test("manualWatched reconcile does not delete local watched episodes when server has 0 items", () => {
  assert.match(manualWatched, /if \(serverEpisodeKeys\.size > 0\)/);
  assert.match(
    manualWatched,
    /serverShowsWithEpisodes\.has\(showId\)[\s\S]*?!serverEpisodeKeys\.has\(lKey\)/,
  );
});

test("manualEpisodeKeys supports altIds to prevent vanishing marked episodes across IMDB and TMDB", () => {
  assert.match(manualWatched, /export function manualEpisodeKeys\(\s*metaId: string,\s*altIds\?:/);
  assert.match(seriesEpisodes, /manualEpisodeKeys\(meta\.id, \[imdbId\]\)/);
});

test("detail page loads Nuvio watched items and progress into stremioWatched state", () => {
  assert.match(detail, /pullWatchedItemsFromNuvio\(\)/);
  assert.match(
    detail,
    /setStremioWatched\((?:\(prev\) => )?new Set\((?:\[\.\.\.prev,\s*)?watchedKeys/,
  );
});

test("isCwMember keeps series items when offset is 0 for Next Up or unwatched progression", () => {
  assert.match(stremio, /if \(i\.upNext\) return true;/);
  assert.match(
    stremio,
    /i\.type === "series" &&\s*i\.state\.season != null &&\s*i\.state\.episode != null &&\s*\(i\.state\.flaggedWatched \?\? 0\) === 0/,
  );
  assert.match(continueWatching, /upNext: e\.type === "series" && e\.positionMs === 0/);
});

test("marking episode unwatched in series updates CW and Nuvio progress instead of vanishing", () => {
  assert.match(mediaProviderActions, /const firstEp = sorted\[0\];/);
  assert.match(
    mediaProviderActions,
    /await deleteEpisodeWatchProgressFromNuvio\(\s*slot,\s*primaryId,\s*ep\.season,\s*ep\.episode/,
  );
  assert.match(mediaProviderActions, /clearLocalCw\(primaryId/);
});

test("detail and episode lists infer prior episodes as watched up to current progression", () => {
  assert.match(
    detail,
    /for \(let ep = 1; ep < m\.episode; ep\+\+\) \{\s*watchedKeys\.add\(`\$\{m\.season\}:\$\{ep\}`\);/,
  );
  assert.doesNotMatch(
    seriesEpisodes,
    /if \(season\.seasonNumber >= 1 && season\.seasonNumber < resumeSeason\)/,
  );
  assert.match(seriesEpisodes, /stremioWatched: combinedWatched/);
  assert.match(
    cinemetaEpisodes,
    /s < resumeSeason \|\| \(s === resumeSeason && e < resumeEpisode\)/,
  );
  assert.match(cinemetaEpisodes, /combinedWatched\.has\(`\$\{season\}:\$\{number\}`\)/);
});

test("Nuvio authentication automatically activates account provider and populates CW", () => {
  assert.match(nuvioAuth, /export function activateNuvioAccountProvider\(\)/);
  assert.match(nuvioAuth, /localStorage\.setItem\("harbor\.account-provider", "nuvio"\)/);
  assert.match(nuvioAuth, /activateNuvioAccountProvider\(\);/);
});

test("Continue Watching recency preserves remote watched timestamps rather than Date.now()", () => {
  assert.match(resume, /atTimestamp\?: number/);
  assert.match(resume, /t: atTimestamp && atTimestamp > 0 \? atTimestamp : Date\.now\(\)/);
  assert.match(
    nuvioPlayback,
    /saveResumeMs\(\s*item\._id,\s*offsetMs,\s*undefined,\s*undefined,\s*undefined,\s*pct01,\s*"nuvio",\s*ownerId,\s*remoteT,?\s*\)/,
  );
  assert.match(
    nuvioPlayback,
    /saveResumeMs\(\s*item\._id,\s*targetOffsetMs,\s*targetSeason,\s*targetEpisode,\s*undefined,\s*pct01,\s*"nuvio",\s*ownerId,\s*remoteT,?\s*\)/,
  );
  assert.match(externalCw, /void refreshExternalCw\(true\)/);
});

test("Nuvio core avatars are preloaded and picker handles missing/failed images gracefully", () => {
  assert.match(
    nuvioProfiles,
    /import DEFAULT_AVATAR_CATALOG from "\.\/nuvio-avatar-catalog-data\.json"/,
  );
  assert.match(nuvioProfiles, /localStorage\.getItem\(AVATAR_CATALOG_STORAGE_KEY\)/);
  assert.match(pickerModal, /NuvioAvatarDisplay/);
  assert.match(pickerModal, /onError=\{\(\) => setError\(true\)\}/);
});

const activeProfileId = read("../src/lib/active-profile-id.ts");
const defaults = read("../src/lib/settings/defaults.ts");
const signedOutHero = read("../src/views/account/signed-out-hero.tsx");
const profilesModule = read("../src/lib/profiles.tsx");
const accountMenuParts = read("../src/chrome/account-menu/account-menu-parts.tsx");

test("isStremioActivePrimary and activeProfileIsPrimary evaluate primary status accurately", () => {
  assert.match(
    activeProfileId,
    /activeProfile\.id === primary\.id \|\| activeProfile\.isPrimary === true/,
  );
  assert.match(
    activeProfileId,
    /if \(isNuvioProviderActive\(\)\) \{\s*return getNuvioActiveSlot\(\) === 1;\s*\}/,
  );
});

test("secondary privileges prioritize direct settings over shared settings", () => {
  assert.match(
    defaults,
    /if \(directSource\) return \{\s*\.\.\.DEFAULT_SECONDARY_PRIVILEGES,\s*\.\.\.directSource\s*\};/,
  );
});

test("SignedOutHero adapts to active provider with Nuvio branding and link", () => {
  assert.match(signedOutHero, /isNuvio \? nuvioLogo : stremioLogo/);
  assert.match(
    signedOutHero,
    /isNuvio \? t\("Bringing your Nuvio library\?"\) : t\("Bringing your Stremio library\?"\)/,
  );
  assert.match(signedOutHero, /settingsAnchor\(isNuvio \? "Nuvio" : "Stremio"\)/);
});

test("ProfilesProvider synthesizes Nuvio activeProfile with avatar, color ring and slot", () => {
  assert.match(profilesModule, /nuvioProfileToHarborProfile/);
  assert.match(profilesModule, /resolveNuvioAvatar\(p\)/);
  assert.match(profilesModule, /effectiveActiveProfile/);
  assert.match(accountMenuParts, /profile\.name\.slice\(0, 2\)/);
});
