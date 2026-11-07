import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSeekrVtt,
  seekrQueryFor,
  seekrTileFromCues,
  type SeekrCue,
} from "../src/lib/seekr.ts";

const VTT = `WEBVTT

00:00:00.000 --> 00:00:10.000
https://sprites.seekr.tv/603/8280000/sheet_001.jpg?sig=1#xywh=0,0,320,180

00:00:10.000 --> 00:00:20.000
https://sprites.seekr.tv/603/8280000/sheet_001.jpg?sig=1#xywh=320,0,320,180

00:00:20.000 --> 00:00:30.000
sheet_002.jpg?sig=1#xywh=0,0,320,180
`;

test("Seekr VTT parses timed sprite tiles and resolves relative sheets", () => {
  const cues = parseSeekrVtt(VTT, "https://sprites.seekr.tv/603/8280000/thumbnails.vtt?sig=1");
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[1].tile, {
    url: "https://sprites.seekr.tv/603/8280000/sheet_001.jpg?sig=1",
    x: 320,
    y: 0,
    w: 320,
    h: 180,
  });
  assert.equal(cues[2].tile.url, "https://sprites.seekr.tv/603/8280000/sheet_002.jpg?sig=1");
});

test("Seekr tile lookup applies the source scale", () => {
  const cues: SeekrCue[] = [
    {
      start: 0,
      end: 10,
      tile: { url: "a.jpg", x: 0, y: 0, w: 320, h: 180 },
    },
    {
      start: 10,
      end: 20,
      tile: { url: "b.jpg", x: 320, y: 0, w: 320, h: 180 },
    },
  ];
  assert.equal(seekrTileFromCues(cues, 1, 5)?.url, "a.jpg");
  assert.equal(seekrTileFromCues(cues, 1, 15)?.url, "b.jpg");
  // Client duration is twice the sprite source, so 15s maps to 7.5s.
  assert.equal(seekrTileFromCues(cues, 2, 15)?.url, "a.jpg");
  assert.equal(seekrTileFromCues(cues, 1, 25)?.url, "b.jpg");
});

test("Seekr lookup uses movie and episode identifiers", () => {
  assert.equal(
    seekrQueryFor({ apiKey: "k", metaId: "tmdb:movie:603", durationSec: 120 }),
    "duration_ms=120000&tmdb_id=603",
  );
  assert.equal(
    seekrQueryFor({ apiKey: "k", metaId: "tt0133093", durationSec: 120 }),
    "duration_ms=120000&imdb_id=tt0133093",
  );
  assert.equal(
    seekrQueryFor({
      apiKey: "k",
      metaId: "tt0944947",
      season: 1,
      episode: 2,
      durationSec: 60,
    }),
    "duration_ms=60000&show_imdb_id=tt0944947&season=1&episode=2",
  );
  assert.equal(
    seekrQueryFor({
      apiKey: "k",
      metaId: "tmdb:tv:1399",
      type: "series",
      season: 1,
      episode: 1,
      durationSec: 60,
    }),
    "duration_ms=60000&show_tmdb_id=1399&season=1&episode=1",
  );
  assert.equal(
    seekrQueryFor({ apiKey: "k", metaId: "tmdb:tv:1399", type: "series", durationSec: 60 }),
    null,
  );
  assert.equal(seekrQueryFor({ apiKey: "k", metaId: "kitsu:1", durationSec: 60 }), null);
});
