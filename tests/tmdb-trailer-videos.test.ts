import assert from "node:assert/strict";
import test from "node:test";
import {
  pickTrailers,
  pickTrailerVideos,
  type Video,
} from "../src/lib/providers/tmdb/tmdb-trailers.ts";

const videos: Video[] = [
  { key: "teaser", site: "YouTube", type: "Teaser", official: true, name: "Official Teaser" },
  { key: "trailer", site: "YouTube", type: "Trailer", official: true, name: "Official Trailer" },
  { key: "vimeo", site: "Vimeo", type: "Trailer", official: true, name: "Vimeo" },
  { key: "trailer", site: "YouTube", type: "Trailer", official: true, name: "Duplicate" },
  { key: "clip", site: "YouTube", type: "Clip", official: false, name: "Clip" },
];

test("orders trailer videos and keeps their names", () => {
  const picked = pickTrailerVideos(videos);
  assert.deepEqual(
    picked.map((video) => [video.key, video.name]),
    [
      ["trailer", "Official Trailer"],
      ["teaser", "Official Teaser"],
      ["clip", "Clip"],
    ],
  );
  assert.deepEqual(pickTrailers(videos), ["trailer", "teaser", "clip"]);
});
