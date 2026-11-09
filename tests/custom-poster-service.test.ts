// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test, { beforeEach } from "node:test";
import {
  needsTmdbForPoster,
  rpdbBackdrop,
  rpdbPoster,
  setPosterBaseUrl,
  setPosterLanguage,
} from "../src/lib/providers/rpdb.ts";

const pictorium =
  "https://pictorium.elfhosted.com/api/poster/{type}/{tmdb_id|imdb_id}?u=test&live=1";

beforeEach(() => {
  setPosterBaseUrl("");
  setPosterLanguage([], "", "");
});

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

test("RPDB builds backdrop-default art for TV cards", () => {
  assert.equal(
    rpdbBackdrop("t1-key", "tt0944947", undefined, undefined, "", "series"),
    "https://api.ratingposterdb.com/t1-key/imdb/backdrop-default/tt0944947.jpg?fallback=true",
  );
  assert.equal(
    rpdbBackdrop("t1-key", "tmdb:tv:1399", undefined, undefined, "", "series"),
    "https://api.ratingposterdb.com/t1-key/tmdb/backdrop-default/series-1399.jpg?fallback=true",
  );
  assert.equal(
    rpdbBackdrop("t1-key", "tvdb:81189", undefined, undefined, "", "series"),
    "https://api.ratingposterdb.com/t1-key/tvdb/backdrop-default/series-81189.jpg?fallback=true",
  );
  assert.equal(
    rpdbBackdrop("", "tt0944947", undefined, undefined, "https://rpdb.example", "series"),
    undefined,
  );
  assert.equal(
    rpdbBackdrop("key", "tt0944947", undefined, undefined, "https://rpdb.example", "series"),
    "https://rpdb.example/key/imdb/backdrop-default/tt0944947.jpg?fallback=true",
  );
});

test("shape-aware poster services switch to their 16:9 renderer", () => {
  setPosterBaseUrl("");
  const postersPlus =
    "https://postersplus.elfhosted.com/poster?tmdb_id={tmdbId}&imdb_id={imdbId}&type={type}";
  assert.equal(
    rpdbBackdrop("", "tt0944947", undefined, "tmdb:tv:1399", postersPlus, "series"),
    "https://postersplus.elfhosted.com/poster?tmdb_id=1399&imdb_id=tt0944947&type=series&shape=landscape",
  );
  assert.equal(
    rpdbPoster("", "tt0944947", undefined, "tmdb:tv:1399", postersPlus, "series"),
    "https://postersplus.elfhosted.com/poster?tmdb_id=1399&imdb_id=tt0944947&type=series",
  );
  assert.equal(
    rpdbBackdrop("", "tt0944947", undefined, undefined, pictorium, "series"),
    "https://pictorium.elfhosted.com/api/poster/series/tt0944947?u=test&live=1&shape=landscape",
  );
  assert.equal(
    rpdbBackdrop(
      "",
      "tt0944947",
      undefined,
      undefined,
      "https://poster.example/art/{shape}/{imdbId}.jpg",
      "movie",
    ),
    "https://poster.example/art/landscape/tt0944947.jpg",
  );
  assert.equal(
    rpdbPoster(
      "",
      "tt0944947",
      undefined,
      undefined,
      "https://poster.example/art/{shape}/{imdbId}.jpg",
      "movie",
    ),
    "https://poster.example/art/poster/tt0944947.jpg",
  );
});

test("Better Posters has no landscape endpoint, so TV cards keep the metadata backdrop", () => {
  assert.equal(
    rpdbPoster("", "tt0944947", undefined, undefined, "https://btttr.cc", "series"),
    "https://btttr.cc/poster/imdb/poster-default/tt0944947.jpg",
  );
  assert.equal(
    rpdbBackdrop("", "tt0944947", undefined, undefined, "https://btttr.cc", "series"),
    undefined,
  );
});

test("custom services receive the configured artwork language", () => {
  setPosterLanguage(["English", "Original"], "it-IT", "en");
  assert.equal(
    rpdbBackdrop("", "tt0944947", undefined, undefined, pictorium, "series"),
    "https://pictorium.elfhosted.com/api/poster/series/tt0944947?u=test&live=1&shape=landscape&lang=en",
  );
  assert.equal(
    rpdbPoster("", "tt0944947", undefined, undefined, "https://btttr.cc", "series"),
    "https://btttr.cc/poster/imdb/poster-default/tt0944947.jpg?lang=en",
  );
  assert.equal(
    rpdbBackdrop("t1-key", "tt0944947", undefined, undefined, "", "series"),
    "https://api.ratingposterdb.com/t1-key/imdb/backdrop-default/tt0944947.jpg?fallback=true&lang=en",
  );
});

test("a language already in a template is replaced, and {lang} is filled in", () => {
  setPosterLanguage(["English"], "", "en");
  const pinnedItalian =
    "https://pictorium.elfhosted.com/api/poster/{type}/{imdb_id}?u=test&lang=it&live=1";
  assert.equal(
    rpdbPoster("", "tt0944947", undefined, undefined, pinnedItalian, "series"),
    "https://pictorium.elfhosted.com/api/poster/series/tt0944947?u=test&lang=en&live=1",
  );
  assert.equal(
    rpdbPoster(
      "",
      "tt0944947",
      undefined,
      undefined,
      "https://poster.example/{lang}/{imdbId}.jpg",
      "series",
    ),
    "https://poster.example/en/tt0944947.jpg",
  );
  setPosterLanguage(["French"], "", "en");
  assert.equal(
    rpdbBackdrop(
      "",
      "tt0944947",
      undefined,
      undefined,
      "https://poster.example/{lang}/{shape}/{imdbId}.jpg",
      "series",
    ),
    "https://poster.example/fr/landscape/tt0944947.jpg",
  );
});
