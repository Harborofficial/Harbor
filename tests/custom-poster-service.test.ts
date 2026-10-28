// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { needsTmdbForPoster, rpdbPoster, setPosterBaseUrl } from "../src/lib/providers/rpdb.ts";

const pictorium =
  "https://pictorium.elfhosted.com/api/poster/{type}/{tmdb_id|imdb_id}?u=test&live=1";

test("Pictorium's copied template works with IMDb and TMDB titles without an RPDB key", () => {
  assert.equal(
    rpdbPoster("", "tt0499549", undefined, undefined, pictorium, "movie"),
    "https://pictorium.elfhosted.com/api/poster/movie/tt0499549?u=test&live=1",
  );
  assert.equal(
    rpdbPoster("", "tt0944947", undefined, undefined, pictorium, "series"),
    "https://pictorium.elfhosted.com/api/poster/series/tt0944947?u=test&live=1",
  );
  assert.equal(
    rpdbPoster("", "tmdb:tv:1399", undefined, undefined, pictorium),
    "https://pictorium.elfhosted.com/api/poster/series/1399?u=test&live=1",
  );
});

test("an explicit poster setting takes effect before the global setting effect runs", () => {
  setPosterBaseUrl("");
  const tmdbTemplate = pictorium.replace("{tmdb_id|imdb_id}", "{tmdbId}");
  assert.equal(needsTmdbForPoster("", "tt0944947", tmdbTemplate), true);
  assert.equal(
    rpdbPoster("", "tt0944947", undefined, "tmdb:tv:1399", tmdbTemplate),
    "https://pictorium.elfhosted.com/api/poster/series/1399?u=test&live=1",
  );
  assert.equal(rpdbPoster("", "tt0944947", "default.jpg", undefined, ""), "default.jpg");
  assert.equal(needsTmdbForPoster("", "tt0944947", pictorium), false);
});
