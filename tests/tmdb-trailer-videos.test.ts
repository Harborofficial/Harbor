import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeTrailerVideoGroups,
  pickTrailers,
  pickTrailerVideos,
  sortTrailerVideos,
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

test("sorts newest first within trailer and teaser groups", () => {
  const dated: Video[] = [
    {
      key: "old",
      site: "YouTube",
      type: "Trailer",
      official: true,
      published_at: "2014-06-14T01:00:01.000Z",
    },
    {
      key: "new",
      site: "YouTube",
      type: "Trailer",
      official: true,
      published_at: "2018-09-20T07:23:08.000Z",
    },
    {
      key: "mid",
      site: "YouTube",
      type: "Trailer",
      official: true,
      published_at: "2016-01-28T16:47:27.000Z",
    },
    {
      key: "teaser",
      site: "YouTube",
      type: "Teaser",
      official: true,
      published_at: "2019-01-01T00:00:00.000Z",
    },
    {
      key: "clip",
      site: "YouTube",
      type: "Clip",
      official: false,
      published_at: "2020-01-01T00:00:00.000Z",
    },
  ];
  assert.deepEqual(
    sortTrailerVideos(dated).map((video) => video.key),
    ["new", "mid", "old", "teaser", "clip"],
  );
});

test("keeps season videos before show-level videos and removes duplicates", () => {
  const season = sortTrailerVideos([
    {
      key: "season-pv",
      site: "YouTube",
      type: "Trailer",
      official: true,
      published_at: "2018-09-20T07:23:08.000Z",
    },
  ]);
  const show = sortTrailerVideos([
    {
      key: "show-2016",
      site: "YouTube",
      type: "Trailer",
      official: true,
      published_at: "2016-01-28T16:47:27.000Z",
    },
    {
      key: "show-2015",
      site: "YouTube",
      type: "Trailer",
      official: true,
      published_at: "2015-11-04T02:58:28.000Z",
    },
    {
      key: "season-pv",
      site: "YouTube",
      type: "Trailer",
      official: true,
      published_at: "2018-09-20T07:23:08.000Z",
    },
  ]);
  assert.deepEqual(
    mergeTrailerVideoGroups(season, show).map((video) => video.key),
    ["season-pv", "show-2016", "show-2015"],
  );
});
