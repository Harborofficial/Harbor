import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const auth = read("../src/lib/auth.tsx");
const stremio = read("../src/lib/stremio.ts");
const stremioWriteQueue = read("../src/lib/stremio-write-queue.ts");
const stremioWatchedSync = read("../src/lib/stremio-watched-sync.ts");
const watchlist = read("../src/lib/watchlist.ts");
const nuvioClient = read("../src/lib/nuvio/nuvio-client.ts");
const app = read("../src/App.tsx");
const nuvioAuth = read("../src/lib/nuvio/nuvio-auth.ts");
const nuvioSync = read("../src/lib/nuvio/nuvio-sync.ts");
const accountProviderPanel = read("../src/views/settings/account/account-provider-panel.tsx");

test("AuthProvider hides Stremio user and authKey when Nuvio provider is active", () => {
  assert.match(auth, /const isNuvio = isNuvioProviderActive\(\) \|\| provider === "nuvio";/);
  assert.match(auth, /user:\s*isNuvio \? null : \(session\?\.user \?\? null\)/);
  assert.match(auth, /authKey:\s*isNuvio \? null : \(session\?\.authKey \?\? null\)/);
  assert.match(auth, /export function clearPrimaryStremioSession\(\): void/);
});

test("stremio module completely guards libraryPut, bookmarks, and provides comprehensive expunge", () => {
  assert.match(stremio, /export async function libraryPut\(\s*authKey: string,\s*item: LibraryItem,\s*forceAllow = false/);
  assert.match(stremio, /if \(isNuvioProviderActive\(\) && !forceAllow\) return;/);
  assert.match(stremio, /export async function saveStremioBookmark\(/);
  assert.match(stremio, /if \(isNuvioProviderActive\(\)\) return;/);
  assert.match(stremio, /export async function removeStremioBookmark\(/);
  assert.match(stremio, /export async function expungeLeachedNuvioItemsFromStremio/);
  assert.match(stremio, /collectAllNuvioItemIds\(\)/);
  assert.match(stremio, /sanitizeStremioLocalCw\(Array\.from\(targetIds\)\)/);
  assert.match(stremio, /timeOffset: 0/);
  assert.match(stremio, /video_id: undefined/);
  assert.match(stremio, /flaggedWatched: 0/);
});

test("stremio write queue and flusher strictly refuse execution in Nuvio mode", () => {
  assert.match(stremioWriteQueue, /export async function cloudLibraryPut/);
  assert.match(stremioWriteQueue, /if \(isNuvioProviderActive\(\)\) return true;/);
  assert.match(stremioWriteQueue, /export async function flushWriteQueue/);
  assert.match(stremioWriteQueue, /if \(isNuvioProviderActive\(\)\) \{\s*load\(\);\s*if \(queue\.size > 0\) \{\s*queue\.clear\(\);\s*persist\(\);\s*\}\s*return;\s*\}/);
  assert.match(stremioWriteQueue, /export function startWriteQueueFlusher/);
  assert.match(stremioWriteQueue, /isNuvioProviderActive\(\)/);
});

test("stremio watched sync modules never write to cloud in Nuvio mode", () => {
  assert.match(stremioWatchedSync, /async function putWithState/);
  assert.match(stremioWatchedSync, /if \(isNuvioProviderActive\(\)\) return true;/);
  assert.match(stremioWatchedSync, /export function markMovieWatchedStremio/);
  assert.match(stremioWatchedSync, /if \(isNuvioProviderActive\(\)\) return Promise\.resolve\(true\);/);
  assert.match(stremioWatchedSync, /export async function setEpisodesWatchedStremio/);
  assert.match(stremioWatchedSync, /if \(isNuvioProviderActive\(\)\) return false;/);
});

test("watchlist sync with Stremio is disabled in Nuvio mode", () => {
  assert.match(watchlist, /async function syncWithStremio/);
  assert.match(watchlist, /if \(isNuvioProviderActive\(\)\) return;/);
});

test("nuvio-client exports collectAllNuvioItemIds scanning all Nuvio storage prefixes", () => {
  assert.match(nuvioClient, /export function collectAllNuvioItemIds\(\): Set<string>/);
  assert.match(nuvioClient, /key\.startsWith\("harbor\.nuvio\."\)/);
  assert.match(nuvioClient, /key\.includes\("\.nuvio\."\)/);
  assert.match(nuvioClient, /key\.startsWith\("harbor\.watchedFlag\.nuvio"\)/);
});

test("automatic expungement runs across App startup, Nuvio activation, reconcile, and provider switch", () => {
  assert.match(app, /function StremioLeachedExpungeRunner\(\)/);
  assert.match(app, /void expungeLeachedNuvioItemsFromStremio\(\)\.catch\(\(\) => \{\}\);/);
  assert.match(app, /<StremioLeachedExpungeRunner \/>/);
  assert.match(nuvioAuth, /export function activateNuvioAccountProvider/);
  assert.match(nuvioAuth, /void expungeLeachedNuvioItemsFromStremio\(\)\.catch\(\(\) => \{\}\);/);
  assert.match(nuvioSync, /export async function reconcileNuvioWatched/);
  assert.match(nuvioSync, /void expungeLeachedNuvioItemsFromStremio\(\)\.catch\(\(\) => \{\}\);/);
  assert.match(accountProviderPanel, /void expungeLeachedNuvioItemsFromStremio\(stremioAuth\);/);
});
