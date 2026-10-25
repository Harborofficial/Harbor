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
const nuvioAuth = read("../src/lib/nuvio/nuvio-auth.ts");
const nuvioPlayback = read("../src/lib/nuvio/nuvio-playback.ts");
const auth = read("../src/lib/auth.tsx");

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

test("signOutNuvio purges all Nuvio keys and resets watched memory caches", () => {
  assert.match(nuvioAuth, /clearWatchedFlagMemoryCache\(\)/);
  assert.match(nuvioAuth, /clearMovieWatchedMemoryCache\(\)/);
  assert.match(nuvioAuth, /clearManualWatchedMemoryCache\(\)/);
  assert.match(nuvioAuth, /lower\.startsWith\("harbor\."\) && lower\.includes\("nuvio"\)/);
});

test("signOut clears Stremio watched flags and memory caches", () => {
  assert.match(auth, /clearWatchedFlagMemoryCache\(\)/);
  assert.match(auth, /clearMovieWatchedMemoryCache\(\)/);
  assert.match(auth, /clearManualWatchedMemoryCache\(\)/);
  assert.match(auth, /localStorage\.removeItem\(`harbor\.watchedFlag\.v1\.\$\{activeProfile\.id\}`\)/);
});

test("buildNuvioPlaybackItems advances finished series episode to Next Up with isUpNext = true", () => {
  assert.match(nuvioPlayback, /targetEpisode = latestEpisode \+ 1/);
  assert.match(nuvioPlayback, /isUpNext = true/);
  assert.match(home, /upNext: e\.type === "series" && e\.positionMs === 0/);
});

test("reconcileNuvioWatched advances series to next episode in Continue Watching", () => {
  assert.match(nuvioSync, /const nextEpisode = s\.maxEpisode \+ 1/);
  assert.match(nuvioSync, /saveLocalCw\(nextCw, `nuvio-\$\{profileIndex\}`\)/);
  assert.match(nuvioSync, /harbor:continue-watching-updated/);
});
