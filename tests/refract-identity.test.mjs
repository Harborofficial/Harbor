import test from "node:test";
import assert from "node:assert/strict";
import {
  createRefractAttemptGuard,
  refractMappedEpisodes,
  parseRefractHistoryId,
} from "../src/lib/refract/identity.ts";

test("anime season and episode coordinates must both be verified", () => {
  assert.equal(refractMappedEpisodes([{ imdbSeason: 2 }]), undefined);
  assert.equal(refractMappedEpisodes([{ imdbEpisode: 4 }]), undefined);
  assert.deepEqual(refractMappedEpisodes([{ imdbSeason: 2, imdbEpisode: 4 }]), [
    { season: 2, episode: 4 },
  ]);
  assert.equal(refractMappedEpisodes([{ imdbSeason: 2, imdbEpisode: 4 }, {}]), undefined);
  assert.equal(parseRefractHistoryId("kitsu:12", "episode"), null);
  assert.equal(parseRefractHistoryId("tmdb:movie:42", "episode"), null);
});

test("unmount and later verification invalidate previous key attempts", () => {
  const guard = createRefractAttemptGuard();
  const first = guard.begin();
  const next = guard.begin();
  assert.equal(first(), false);
  assert.equal(next(), true);
  guard.invalidate();
  assert.equal(next(), false);
  assert.equal(guard.begin()(), true);
});
