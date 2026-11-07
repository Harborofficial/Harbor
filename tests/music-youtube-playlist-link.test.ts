import assert from "node:assert/strict";
import test from "node:test";
import { parseYouTubePlaylistLink } from "../src/lib/music/youtube-playlist-link.ts";

// Captured provider IDs from playlist-page-fixture.json and youtube_music/artist.rs.
const playlistId = "PLw-VjHDlEOgtH-Ce-dJzPOtIm5xTVC4t2";
const albumId = "OLAK5uy_moM-aHZhmdVNw8mXuIS0wnznLvo6MM2os";
// Synthetic format case, not a claim that this playlist exists at the provider.
const curatedId = "RDCLAK5uy_format-check_123-ABC";
const hosts = [
  "music.youtube.com",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
];

test("accepts provider playlist IDs and trims surrounding whitespace", () => {
  for (const id of [playlistId, albumId, curatedId]) {
    assert.equal(parseYouTubePlaylistLink(id), id);
    assert.equal(parseYouTubePlaylistLink(` \t${id}\r\n`), id);
  }
});

test("removes exactly one VL browse prefix from IDs and list parameters", () => {
  for (const id of [playlistId, albumId, curatedId]) {
    assert.equal(parseYouTubePlaylistLink(`VL${id}`), id);
    assert.equal(parseYouTubePlaylistLink(`https://music.youtube.com/playlist?list=VL${id}`), id);
    assert.throws(() => parseYouTubePlaylistLink(`VLVL${id}`), Error);
  }
});

test("accepts HTTP(S) playlist or watch links only on the exact YouTube hosts", () => {
  for (const host of hosts.slice(0, 4)) {
    for (const scheme of ["https", "http"]) {
      assert.equal(
        parseYouTubePlaylistLink(`${scheme}://${host}/playlist?list=${playlistId}`),
        playlistId,
      );
      assert.equal(
        parseYouTubePlaylistLink(`${scheme}://${host}/watch?v=oRdxUFDoQe0&list=${playlistId}`),
        playlistId,
      );
    }
  }
  assert.equal(
    parseYouTubePlaylistLink(`  HTTPS://MUSIC.YOUTUBE.COM/playlist?list=${albumId}  `),
    albumId,
  );
});

test("accepts short video links with a list parameter on both youtu.be hosts", () => {
  for (const host of hosts.slice(4)) {
    for (const scheme of ["https", "http"]) {
      assert.equal(
        parseYouTubePlaylistLink(`${scheme}://${host}/oRdxUFDoQe0?si=share&list=${playlistId}`),
        playlistId,
      );
    }
  }
});

test("reads only the list parameter, independently of order, tracking and fragments", () => {
  assert.equal(
    parseYouTubePlaylistLink(
      `https://music.youtube.com/playlist?si=share&list=${albumId}&index=2#section`,
    ),
    albumId,
  );
  assert.equal(
    parseYouTubePlaylistLink(`https://youtube.com/watch?list=${curatedId}&v=oRdxUFDoQe0#list=WL`),
    curatedId,
  );
  assert.equal(
    parseYouTubePlaylistLink(
      `https://music.youtube.com/playlist?list=%50%4C${playlistId.slice(2)}`,
    ),
    playlistId,
  );
});

test("preserves the selected video and Mix playlist identity for manual sync", () => {
  assert.equal(
    parseYouTubePlaylistLink(
      "https://www.youtube.com/watch?v=05VSCSna5WA&list=RDGMEMCMFH2exzjBeE_zAHHJOdxgVMWUJYt4Zs3Ko&index=14",
    ),
    "RDGMEMCMFH2exzjBeE_zAHHJOdxgVMWUJYt4Zs3Ko:05VSCSna5WA",
  );
  assert.equal(
    parseYouTubePlaylistLink("https://youtu.be/05VSCSna5WA?list=RDAMVMWUJYt4Zs3Ko"),
    "RDAMVMWUJYt4Zs3Ko:05VSCSna5WA",
  );
});

test("requires an unambiguous eleven-character seed video for generated Mixes", () => {
  for (const raw of [
    "RDAMVMoRdxUFDoQe0",
    "https://music.youtube.com/playlist?list=RDAMVMoRdxUFDoQe0",
    "https://youtube.com/watch?v=short&list=RDAMVMoRdxUFDoQe0",
    "https://youtube.com/watch?v=05VSCSna5WA&v=oRdxUFDoQe0&list=RDAMVMoRdxUFDoQe0",
    "https://youtube.com/watch?v=05VSCSna5WA&list=RD",
    "https://youtube.com/watch?v=05VSCSna5WA&list=RD%3Aunsafe",
    "https://youtu.be/05VSCSna5WAextra?list=RDAMVMoRdxUFDoQe0",
  ]) {
    assert.throws(() => parseYouTubePlaylistLink(raw), Error);
  }
});

test("rejects liked playlists and watch-later with actionable public-playlist guidance", () => {
  for (const id of ["LM", "WL"]) {
    for (const raw of [id, `VL${id}`, `https://music.youtube.com/playlist?list=${id}`]) {
      assert.throws(
        () => parseYouTubePlaylistLink(raw),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /liked.*watch[- ]later.*cannot be linked/i);
          assert.match(error.message, /public.*unlisted/i);
          assert.match(error.message, /signing in.*not supported/i);
          return true;
        },
      );
    }
  }
});

test("rejects missing or invalid playlist prefixes including case changes and empty suffixes", () => {
  for (const id of [
    "",
    "  ",
    "PL",
    "OLAK5uy_",
    "RDCLAK5uy_",
    "VL",
    "UCchannel",
    "UUuploads",
    "oRdxUFDoQe0",
    "pllower",
    "OlAK5uy_case",
    `prefix${playlistId}`,
  ]) {
    assert.throws(() => parseYouTubePlaylistLink(id), Error);
  }
});

test("rejects non-ASCII and unsafe ID characters instead of trimming or repairing them", () => {
  for (const suffix of [
    "/segment",
    "?query",
    "#fragment",
    ".dot",
    "+plus",
    "=padding",
    ":colon",
    "@user",
    " space",
    "\ttab",
    "\nnewline",
    "\0null",
    "\\slash",
    "é",
    "Ａ",
    "\u{1F600}",
  ]) {
    const id = `${playlistId}${suffix}`;
    assert.throws(() => parseYouTubePlaylistLink(id), Error);
    assert.throws(
      () =>
        parseYouTubePlaylistLink(
          `https://music.youtube.com/playlist?list=${encodeURIComponent(id)}`,
        ),
      Error,
    );
  }
  for (const list of [
    `${playlistId}+space`,
    `${playlistId}%`,
    `${playlistId}%FF`,
    `${playlistId}%252F`,
  ]) {
    assert.throws(
      () => parseYouTubePlaylistLink(`https://youtube.com/playlist?list=${list}`),
      Error,
    );
  }
});

test("enforces the 80-character limit on the normalized ID, not its VL prefix", () => {
  const id = `PL${"a".repeat(78)}`;
  assert.equal(parseYouTubePlaylistLink(id), id);
  assert.equal(parseYouTubePlaylistLink(`VL${id}`), id);
  assert.equal(parseYouTubePlaylistLink(`https://youtube.com/playlist?list=VL${id}`), id);
  for (const raw of [`${id}a`, `VL${id}a`, `https://youtube.com/playlist?list=${id}a`]) {
    assert.throws(() => parseYouTubePlaylistLink(raw), Error);
  }
});

test("accepts 2048-character trimmed URLs but rejects longer input", () => {
  const base = `https://music.youtube.com/playlist?list=${playlistId}&si=`;
  const atLimit = base + "a".repeat(2048 - base.length);
  assert.equal(parseYouTubePlaylistLink(atLimit), playlistId);
  assert.equal(parseYouTubePlaylistLink(`  ${atLimit}\n`), playlistId);
  assert.throws(() => parseYouTubePlaylistLink(`${atLimit}a`), Error);
  assert.throws(() => parseYouTubePlaylistLink(`PL${"a".repeat(2047)}`), Error);
});

test("rejects missing, empty, ambiguous or fragment-only list parameters", () => {
  for (const query of [
    "",
    "?v=oRdxUFDoQe0",
    "?list=",
    "?List=PLabc",
    `#list=${playlistId}`,
    `?notlist=${playlistId}`,
    `?list=${playlistId}&list=WL`,
    `?list=WL&list=${playlistId}`,
    `?list=${playlistId}&list=${playlistId}`,
  ]) {
    assert.throws(() => parseYouTubePlaylistLink(`https://youtube.com/playlist${query}`), Error);
  }
});

test("rejects arbitrary or normalized-away paths, and watch links without a video", () => {
  for (const path of [
    "",
    "/",
    "/feed/library",
    "/channel/UCchannel",
    "/shorts/oRdxUFDoQe0",
    "/embed/oRdxUFDoQe0",
    "/playlist/extra",
    "/playlist/",
    "/watch/",
    "/PLAYLIST",
    "/other/../playlist",
    "/%70laylist",
    "/watch",
    "/watch?v=",
  ]) {
    const separator = path.includes("?") ? "&" : "?";
    assert.throws(
      () => parseYouTubePlaylistLink(`https://youtube.com${path}${separator}list=${playlistId}`),
      Error,
    );
  }
  for (const path of ["", "/", "/video/extra", "/other/../oRdxUFDoQe0", "/video%2Fextra"]) {
    assert.throws(
      () => parseYouTubePlaylistLink(`https://youtu.be${path}?list=${playlistId}`),
      Error,
    );
  }
});

test("rejects spoofed hosts, trailing dots, unrelated subdomains and non-YouTube hosts", () => {
  for (const host of [
    "youtube.com.evil",
    "music.youtube.com.evil",
    "evil.youtube.com",
    "www.music.youtube.com",
    "youtube.com.",
    "youtu.be.evil",
    "notyoutube.com",
    "youtube-nocookie.com",
    "example.com",
    "%79outube.com",
  ]) {
    assert.throws(
      () => parseYouTubePlaylistLink(`https://${host}/playlist?list=${playlistId}`),
      Error,
    );
  }
});

test("rejects every credential-bearing URL even on a permitted host", () => {
  for (const authority of [
    "user@youtube.com",
    "user:password@music.youtube.com",
    ":password@www.youtube.com",
    "user:@m.youtube.com",
    "user@youtu.be",
    "@youtube.com",
  ]) {
    assert.throws(
      () => parseYouTubePlaylistLink(`https://${authority}/playlist?list=${playlistId}`),
      Error,
    );
  }
});

test("rejects unsupported schemes and scheme-less links rather than guessing", () => {
  for (const raw of [
    ...["ftp", "file", "javascript", "data", "harbor"].map(
      (scheme) => `${scheme}://youtube.com/playlist?list=${playlistId}`,
    ),
    `https:youtube.com/playlist?list=${playlistId}`,
    `https:///youtube.com/playlist?list=${playlistId}`,
    `//youtube.com/playlist?list=${playlistId}`,
    ...hosts.map((host) => `${host}/playlist?list=${playlistId}`),
  ]) {
    assert.throws(() => parseYouTubePlaylistLink(raw), Error);
  }
});

test("rejects embedded whitespace and backslashes before URL normalization", () => {
  for (const raw of [
    `https://you\ntube.com/playlist?list=${playlistId}`,
    `https://youtube.com/playlist?list=PL\ta`,
    `https://youtube.com\\playlist?list=${playlistId}`,
    `https://youtube.com/playlist?list=${playlistId}&si=has space`,
  ]) {
    assert.throws(() => parseYouTubePlaylistLink(raw), Error);
  }
});

test("errors never include submitted credentials, tokens, URLs or underlying URL errors", () => {
  const secret = "private-token-do-not-expose";
  for (const raw of [
    `https://${secret}:password@youtube.com/playlist?list=${playlistId}`,
    `https://[${secret}]/playlist?list=${playlistId}`,
    `https://example.com/playlist?list=${playlistId}&token=${secret}`,
    `https://youtube.com/playlist?list=${secret}`,
    `https://youtube.com/playlist?token=${secret}`,
    `https://youtube.com/${secret}?list=${playlistId}`,
    `https://youtube.com/playlist?list=WL&token=${secret}`,
    `PL${secret}${"a".repeat(2048)}`,
  ]) {
    assert.throws(
      () => parseYouTubePlaylistLink(raw),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes(secret));
        assert.ok(!error.message.includes(raw));
        assert.ok(!error.stack?.includes(secret));
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
});

test("invalid link guidance states the public/unlisted and no-sign-in restrictions", () => {
  assert.throws(
    () => parseYouTubePlaylistLink("not-a-playlist"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /public.*unlisted/i);
      assert.match(error.message, /signing in.*not supported/i);
      return true;
    },
  );
});
