import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const watchedFlag = read("../src/lib/watched-flag.ts");
const movieWatched = read("../src/lib/movie-watched.ts");
const nuvioSync = read("../src/lib/nuvio/nuvio-sync.ts");
const detail = read("../src/views/detail.tsx");
const accountSettings = read("../src/views/settings/account.tsx");
const accountProviderPanel = read("../src/views/settings/account/account-provider-panel.tsx");
const home = read("../src/views/home.tsx");
const cwSection = read("../src/views/home/cw-section.tsx");
const useCwAdvance = read("../src/views/home/hooks/use-cw-advance.ts");
const useMarkSeason = read("../src/views/detail/series-episodes/use-mark-season.ts");

test("watched-flag scopes storage key by active Nuvio slot", () => {
  assert.match(watchedFlag, /harbor\.watchedFlag\.nuvio\.v1\.\$\{slot\}/);
  assert.match(watchedFlag, /harbor:nuvio-profile-changed/);
  assert.match(watchedFlag, /harbor:account-provider-changed/);
});

test("movie-watched scopes storage key by active Nuvio slot and supports profile parameter", () => {
  assert.match(movieWatched, /harbor\.moviewatched\.nuvio\.v1\.\$\{slot\}/);
  assert.match(movieWatched, /export function movieWatchedStoreKey/);
  assert.match(movieWatched, /setMovieWatchedLocal\(metaId: string, watched: boolean, profileOrSlot\?: string \| number\)/);
});

test("reconcileNuvioWatched passes profileIndex to setWatchedFlag and setMovieWatchedLocal", () => {
  assert.match(nuvioSync, /setWatchedFlag\(id, true, profileIndex\)/);
  assert.match(nuvioSync, /setMovieWatchedLocal\(id, true, profileIndex\)/);
  assert.match(nuvioSync, /setWatchedFlag\(localId, false, profileIndex\)/);
  assert.match(nuvioSync, /setMovieWatchedLocal\(localId, false, profileIndex\)/);
});

test("detail page clears watched state on profile switch and isolates Nuvio profile slot", () => {
  assert.match(detail, /setStremioWatched\(new Set\(\)\)/);
  assert.match(detail, /harbor:nuvio-profile-changed/);
  assert.match(detail, /profileTick/);
});

test("useMarkSeason pushes and deletes watched items to Nuvio cloud for the active slot", () => {
  assert.match(useMarkSeason, /pushWatchedItemToNuvio\(slot, items\)/);
  assert.match(useMarkSeason, /deleteWatchedItemFromNuvio\(slot, keys\)/);
});

test("disconnecting Nuvio redirects to account provider settings tab", () => {
  assert.match(accountSettings, /harbor:account-provider-changed/);
  assert.match(accountSettings, /setTab\("provider"\)/);
});

test("account provider panel detects Stremio connection status even in Nuvio mode", () => {
  assert.match(accountProviderPanel, /readPrimaryStremioSession/);
  assert.match(accountProviderPanel, /stremioUser \? t\("Connected as \{email\}"/);
});

test("home continue watching uses Nuvio sign-in state in Nuvio mode", () => {
  assert.match(home, /signedIn=\{isNuvioProvider \? \(isNuvioProviderActive\(\) && isNuvioSignedIn\(\)\) : !!authKey\}/);
  assert.match(home, /isNuvio=\{isNuvioProvider\}/);
  assert.match(cwSection, /Nothing in progress yet\. Press Play on something\./);
  assert.match(cwSection, /Sign in to your Nuvio account/);
});

test("detail view advances sequentially on episode completion and never jumps to past seasons", () => {
  assert.doesNotMatch(detail, /m\.season > latest\.season/);
  assert.match(detail, /nextEpisode = latest\.episode \+ 1/);
});

test("useCwAdvance preserves sequential rewatch and prevents jumping to later seasons", () => {
  assert.match(useCwAdvance, /if \(immediateNext && nextEp && nextEp\.season > immediateNext\.season\)/);
});

const cwProfile = read("../src/lib/cw-profile.ts");

test("cwProfileScope isolates Continue Watching profile scope by active Nuvio slot", () => {
  assert.match(cwProfile, /if \(isNuvioProviderActive\(\)\)/);
  assert.match(cwProfile, /const slot = getNuvioActiveSlot\(\)/);
  assert.match(cwProfile, /const pid = ownerId \?\? `nuvio-\$\{slot\}`/);
});

test("CWSection maintains stable Row key and supports loading skeletons for smooth transitions", () => {
  assert.match(cwSection, /loading\?: boolean/);
  assert.match(cwSection, /key="home:cw"/);
  assert.match(cwSection, /aspect-\[16\/9\] w-full rounded-xl bg-elevated/);
});

test("signing out or switching accounts cleanly purges watched badges and catalog caches", () => {
  const auth = read("../src/lib/auth.tsx");
  const nuvioAuth = read("../src/lib/nuvio/nuvio-auth.ts");

  // Stremio auth purge
  assert.match(auth, /export function purgeStremioAccountData/);
  assert.match(auth, /purgeStremioAccountData\(pid\)/);
  assert.match(auth, /harbor:watched-changed/);

  // Watched flag and movie watched clear exports
  assert.match(watchedFlag, /export function clearWatchedFlags/);
  assert.match(watchedFlag, /export function clearAllNuvioWatchedFlags/);
  assert.match(movieWatched, /export function clearMovieWatched/);
  assert.match(movieWatched, /export function clearAllNuvioMovieWatched/);

  // Nuvio auth purge
  assert.match(nuvioAuth, /clearAllNuvioWatchedFlags\(\)/);
  assert.match(nuvioAuth, /clearAllNuvioMovieWatched\(\)/);
  assert.match(nuvioAuth, /clearAllNuvioManualWatched\(\)/);
  assert.match(nuvioAuth, /harbor:watched-changed/);
});

test("CW tray retains next up episode and protects against unwanted removal upon marking episodes", () => {
  const nuvioSync = read("../src/lib/nuvio/nuvio-sync.ts");
  const extCw = read("../src/lib/feed/external-cw.ts");
  const mediaActions = read("../src/lib/media-provider-actions.ts");

  // useCwAdvance does not drop unwatched upNext cards
  assert.match(useCwAdvance, /if \(!watchedCur\) continue;/);
  assert.doesNotMatch(useCwAdvance, /if \(!watchedCur && !i\.upNext\) continue;/);

  // deleteEpisodeWatchProgressFromNuvio sends episodeOnly: true
  assert.match(nuvioSync, /episodeOnly: true/);
  assert.match(extCw, /if \(detail\?\.episodeOnly\) return;/);

  // mediaProviderActions deletes only episode progress when hasNext is true
  assert.match(mediaActions, /deleteEpisodeWatchProgressFromNuvio\(slot, primaryId, ep\.season, ep\.episode\)/);
  assert.match(useMarkSeason, /deleteEpisodeWatchProgressFromNuvio\(slot, primaryId, ep\.seasonNumber, ep\.episodeNumber\)/);
});

test("dismissedNextUpKeys syncs to Nuvio Cloud, isolates profile slots, and prevents resurrecting dismissed series", () => {
  // nuvio-sync exports and storage isolation
  assert.match(nuvioSync, /export function readCachedDismissedNextUpKeys/);
  assert.match(nuvioSync, /export function writeCachedDismissedNextUpKeys/);
  assert.match(nuvioSync, /export function isDismissedNextUp/);
  assert.match(nuvioSync, /export async function pullDismissedNextUpKeysFromNuvio/);
  assert.match(nuvioSync, /export async function undismissNextUpInNuvioCloud/);
  assert.match(nuvioSync, /harbor\.nuvio\.dismissedNextUp\.v1\.\$\{profileIndex\}/);

  // reconcileNuvioWatched checks dismissedKeys and seeds un-dismissed midway shows
  assert.match(nuvioSync, /const dismissedKeys = await pullDismissedNextUpKeysFromNuvio\(profileIndex\)/);
  assert.match(nuvioSync, /if \(isDismissedNextUp\(entry\.id, entry\.season, entry\.episode, dismissedKeys\)\)/);
  assert.match(nuvioSync, /if \(\s*isDismissedNextUp\(item\.content_id, maxInfo\.season, maxInfo\.episode, dismissedKeys\) \|\|\s*isDismissedNextUp\(item\.content_id, nextS, nextE, dismissedKeys\) \|\|\s*isDismissedNextUp\(item\.content_id, -1, -1, dismissedKeys\)\s*\) \{\s*continue;\s*\}/);
});
