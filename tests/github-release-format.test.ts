// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  installerForVersion,
  newestReleases,
  normalizeReleaseTag,
  parseGithubRelease,
  parseReleaseBody,
} from "../src/lib/updater/github-release-format.ts";

const BETA_BODY = `# Harbor v1.0.1 Beta

This release adds a redesigned Season Explorer with TVDB anime support.

---

### ☁️ Nuvio Cloud & Accounts (Experimental)

* **Nuvio Cloud Integration:** Added Nuvio as an account provider under **Settings → Account** (@glpc-blaze).
* **Profile Mapping & Synced Addons:** Choose which profile syncs. See the [guide](https://example.com/guide).

---

### 🎬 Video Player & Playback

* **"More Like This" End Screen:** Recommendations appear near the end of playback.
  * **Corner Mini-Player:** Your video shrinks into a corner mini-player.
  * **Big Picture Navigation:** Full D-pad support.
* **Chapter &amp; Timeline:** Improved \`mpv\` handling with <br> chapter markers.
`;

const STABLE_BODY = `# Harbor has set sail once again! We are happy to have you aboard.

### Mac and linux builds will come soon, as will fixes.

## Harbor Patch Notes

### 🎵 Music & Spotify Integration

* **Spotify Playback Pairing:** Seamlessly pair Spotify playback.
`;

test("maps a GitHub release tag to an app version and channel", () => {
  assert.deepEqual(normalizeReleaseTag("v1.0.1-beta"), { version: "1.0.1", channel: "beta" });
  assert.deepEqual(normalizeReleaseTag("V1.0.0"), { version: "1.0.0", channel: "stable" });
  assert.deepEqual(normalizeReleaseTag("v1.2.3-stable"), { version: "1.2.3", channel: "stable" });
  assert.equal(normalizeReleaseTag("libmpv-windows-x64"), null);
  assert.equal(normalizeReleaseTag("nanojson-e9d656d"), null);
});

test("turns release markdown into rich note sections", () => {
  const note = parseReleaseBody(BETA_BODY, "Harbor v1.0.1 Beta");
  assert.equal(note.title, "Harbor v1.0.1 Beta");
  assert.equal(
    note.intro,
    "This release adds a redesigned Season Explorer with TVDB anime support.",
  );
  assert.deepEqual(
    note.sections?.map((section) => section.heading),
    ["☁️ Nuvio Cloud & Accounts (Experimental)", "🎬 Video Player & Playback"],
  );
  assert.deepEqual(note.sections?.[0].items, [
    "Nuvio Cloud Integration: Added Nuvio as an account provider under Settings → Account (@glpc-blaze).",
    "Profile Mapping & Synced Addons: Choose which profile syncs. See the guide.",
  ]);
});

test("flattens nested bullets and removes inline markdown", () => {
  const note = parseReleaseBody(BETA_BODY, "Harbor v1.0.1 Beta");
  assert.deepEqual(note.sections?.[1].items, [
    '"More Like This" End Screen: Recommendations appear near the end of playback.',
    "Corner Mini-Player: Your video shrinks into a corner mini-player.",
    "Big Picture Navigation: Full D-pad support.",
    "Chapter & Timeline: Improved mpv handling with chapter markers.",
  ]);
});

test("keeps prose from empty headings and drops generic headings", () => {
  const note = parseReleaseBody(STABLE_BODY, "1.0.0 Preliminary Beta");
  assert.equal(note.title, "1.0.0 Preliminary Beta");
  assert.equal(
    note.intro,
    "Harbor has set sail once again! We are happy to have you aboard. Mac and linux builds will come soon, as will fixes.",
  );
  assert.deepEqual(
    note.sections?.map((section) => section.heading),
    ["🎵 Music & Spotify Integration"],
  );
  assert.deepEqual(note.sections?.[0].items, [
    "Spotify Playback Pairing: Seamlessly pair Spotify playback.",
  ]);
});

test("builds a version entry with installers from release assets", () => {
  const parsed = parseGithubRelease({
    tag_name: "v1.0.1-beta",
    name: "Harbor v1.0.1 Beta",
    body: BETA_BODY,
    published_at: "2026-10-21T20:50:02Z",
    prerelease: false,
    assets: [
      {
        name: "harbor-shipyard-v1.0.1-beta.exe",
        browser_download_url: "https://example.com/harbor-shipyard.exe",
        size: 10,
      },
      {
        name: "harbor-shipyard-v1.0.1-beta.exe.sig",
        browser_download_url: "https://example.com/harbor-shipyard.exe.sig",
      },
      {
        name: "Harbor_1.0.1_aarch64.dmg",
        browser_download_url: "https://example.com/Harbor_1.0.1_aarch64.dmg",
      },
    ],
  });
  assert.equal(parsed?.version, "1.0.1");
  assert.equal(parsed?.channel, "beta");
  assert.equal(parsed?.date, "2026-10-21");
  assert.equal(parsed?.win, "https://example.com/harbor-shipyard.exe");
  assert.equal(parsed?.winSig, "https://example.com/harbor-shipyard.exe.sig");
  assert.equal(parsed?.winSize, 10);
  assert.equal(parsed?.mac, "https://example.com/Harbor_1.0.1_aarch64.dmg");
  assert.equal(
    parsed?.summary,
    "This release adds a redesigned Season Explorer with TVDB anime support.",
  );
  assert.equal(parsed?.note.title, "Harbor v1.0.1 Beta");
});

test("Modify selects the installed version, never a newer release", () => {
  const beta = parseGithubRelease({
    tag_name: "v1.0.1-beta",
    name: "Harbor v1.0.1 Beta",
    body: BETA_BODY,
    assets: [
      {
        name: "harbor-shipyard-v1.0.1-beta.exe",
        browser_download_url: "https://example.com/beta.exe",
      },
      {
        name: "harbor-shipyard-v1.0.1-beta.exe.sig",
        browser_download_url: "https://example.com/beta.exe.sig",
      },
    ],
  });
  const stable = parseGithubRelease({
    tag_name: "v1.0.0",
    name: "Harbor 1.0.0",
    body: STABLE_BODY,
    assets: [
      {
        name: "harbor-shipyard-v1.0.0-stable.exe",
        browser_download_url: "https://example.com/stable.exe",
      },
    ],
  });
  const stable101 = parseGithubRelease({
    tag_name: "v1.0.1",
    name: "Harbor 1.0.1",
    body: BETA_BODY,
    assets: [
      {
        name: "harbor-shipyard-v1.0.1-stable.exe",
        browser_download_url: "https://example.com/stable-1.0.1.exe",
      },
    ],
  });
  assert.ok(beta && stable && stable101);
  assert.equal(installerForVersion([beta, stable], "1.0.0")?.version, "1.0.0");
  assert.equal(installerForVersion([beta, stable], "0.9.128"), null);
  assert.equal(installerForVersion([beta, stable101], "1.0.1", "stable")?.channel, "stable");
  assert.equal(installerForVersion([beta, stable101], "1.0.1", "beta")?.channel, "beta");
});

test("ignores utility releases and keeps the newest release per version", () => {
  assert.equal(
    parseGithubRelease({
      tag_name: "libmpv-windows-x64",
      name: "libmpv Windows x64",
      body: "dll",
    }),
    null,
  );
  const releases = [
    parseGithubRelease({
      tag_name: "v1.0.1-beta",
      name: "Harbor v1.0.1 Beta",
      body: BETA_BODY,
      published_at: "2026-10-20T00:00:00Z",
      assets: [],
    }),
    parseGithubRelease({
      tag_name: "v1.0.1",
      name: "Harbor 1.0.1",
      body: BETA_BODY,
      published_at: "2026-10-22T00:00:00Z",
      assets: [],
    }),
    parseGithubRelease({
      tag_name: "v1.0.0",
      name: "Harbor 1.0.0",
      body: STABLE_BODY,
      published_at: "2026-10-19T00:00:00Z",
      assets: [],
    }),
  ].filter((release) => release !== null);
  assert.deepEqual(
    newestReleases(releases).map((release) => [release.version, release.channel]),
    [
      ["1.0.1", "stable"],
      ["1.0.0", "stable"],
    ],
  );
});
