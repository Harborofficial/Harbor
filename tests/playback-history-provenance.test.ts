import assert from "node:assert/strict";
import test from "node:test";
import * as history from "../src/lib/playback-history";
import { actualPlaybackSnapshot } from "../src/lib/player/actual-playback";
import { initialPlayerSnapshot } from "../src/lib/player/bridge";
import { persistablePlaybackUrl } from "../src/lib/player/playback-history-source";
import {
  continueActualPlayback,
  continuationAppliesToSource,
  continuationFor,
  type ContinuationServices,
} from "../src/lib/player/continue-playback";
import { subtitleMediaKey, subtitleStreamKey } from "../src/lib/subtitles/subtitle-memory";
import type { PlayerSrc } from "../src/lib/view";
import { readSeasonLock, saveSeasonLock } from "../src/lib/season-lock";
import { selectPlaybackSubtitle } from "../src/lib/player/subtitle-choice";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});
const storageKey = "harbor.playback-history.v1.one";
const actor = { profileId: "one", storageProfileId: "one", accountId: null };
const snap = {
  ...initialPlayerSnapshot(),
  status: "playing" as const,
  firstFrameReady: true,
  durationSec: 400,
};
const urls = [
  "https://media.example/v1/key/PATHSECRET123/play.m3u8",
  "https://media.example/watch?accessCode=QUERYSECRET123",
  "https://proxy.example/watch?url=https%3A%2F%2Fcdn.example%2Fvideo%3Ftoken%3DINNERSECRET",
];
function configure() {
  values.clear();
  values.set(
    "harbor.profiles.v1",
    JSON.stringify({
      activeId: "one",
      profiles: [
        { id: "one", isPrimary: true },
        { id: "two", shareStremioWith: "one" },
      ],
    }),
  );
}
function source(url = urls[0]): PlayerSrc {
  return {
    meta: { id: "tt-provenance", type: "movie", name: "A real title" },
    title: "A real title",
    url,
    streamRef: { addonId: "synthetic-addon", parsedTitle: "A.Real.Title.2026", size: 42 },
  };
}
function recorded(src = source(), id = "observed") {
  return actualPlaybackSnapshot(src, snap, 45, { id, actor })!;
}

for (const [index, url] of urls.entries()) {
  test(`unclassified transport case ${index + 1} cannot enter history through URL or text fields`, () => {
    configure();
    assert.equal(persistablePlaybackUrl(url), undefined);
    const src = source(url);
    src.meta.poster = url;
    src.meta.providerBadge = { name: "Provider", logo: url };
    src.episode = { season: 1, episode: 2, name: url, still: url };
    assert.equal(
      history.recordActualPlayback({
        ...recorded(src),
        subtitle: { external: true, source: url, title: url },
      }),
      true,
    );
    history.savePlayback(src.meta.id, {
      url,
      title: url,
      parsedTitle: encodeURIComponent(url),
      unexpectedTransport: url,
    } as any);
    const actual = history.readLastActualPlayback()!;
    assert.equal(actual.positionMs, 45000);
    assert.equal(actual.src.url, "");
    assert.equal(actual.requiresSourceRefresh, true);
    assert.equal(history.readActualPlaybackFor(src)?.id, "observed");
    assert.doesNotMatch(
      values.get(storageKey)!,
      /PATHSECRET123|QUERYSECRET123|INNERSECRET|unexpectedTransport/,
    );
  });
}

test("an ordinary-looking HTTP URL is not evidence of public provenance", () => {
  configure();
  const src = source("https://media.example/movies/a-film.mp4");
  assert.equal(history.recordActualPlayback(recorded(src)), true);
  assert.equal(history.readLastActualPlayback()?.src.url, "");
  assert.equal(history.readLastActualPlayback()?.requiresSourceRefresh, true);
  assert.equal(history.readActualPlaybackFor(src)?.id, "observed");
});

test("scoped legacy history scrubs transport copies, unknown properties and URL-bearing map keys", () => {
  configure();
  const url = urls[1];
  const id = `url:${url}`;
  const src = source(url);
  src.meta.id = id;
  src.meta.name = "QUERYSECRET123";
  src.title = "QUERYSECRET123";
  values.set(
    storageKey,
    JSON.stringify({
      [id]: {
        savedAt: Date.now(),
        url,
        title: url,
        extra: { url },
        actual: { ...recorded(src), src, unexpectedTransport: url },
        actualByProfile: { one: { actual: { ...recorded(src), src }, unexpectedTransport: url } },
      },
    }),
  );
  const saved = history.readLastActualPlayback()!;
  assert.ok(saved);
  assert.doesNotMatch(values.get(storageKey)!, /QUERYSECRET123|https:|unexpectedTransport/);
  assert.equal(history.readActualPlaybackFor(src)?.id, saved.id);
  assert.equal(continuationAppliesToSource(src, continuationFor(saved, actor)), true);
  assert.equal(history.readPlayback(id)?.actual?.id, saved.id);
  assert.equal(
    history.readLastActualPlayback()?.src.meta.id,
    saved.src.meta.id,
    "ID normalization is idempotent",
  );
});

test("encoded provider-page IDs do not retain a hidden network URL", () => {
  configure();
  const src = source(urls[2]);
  src.meta.id = `capstan:synthetic:${encodeURIComponent(urls[2])}`;
  assert.equal(history.recordActualPlayback(recorded(src)), true);
  const target = history.readLastActualPlayback()!;
  assert.doesNotMatch(values.get(storageKey)!, /INNERSECRET|https%3A/i);
  assert.equal(continuationAppliesToSource(src, continuationFor(target, actor)), true);
});

test("explicit public image routes retain artwork without allowing arbitrary network images", () => {
  configure();
  const src = source();
  src.meta.poster = "https://image.tmdb.org/t/p/w500/1E5baAaEse26fej7uHcjOgEE2t2.jpg";
  src.meta.background = urls[0];
  assert.equal(history.recordActualPlayback(recorded(src)), true);
  assert.equal(history.readLastActualPlayback()?.src.meta.poster, src.meta.poster);
  assert.equal(history.readLastActualPlayback()?.src.meta.background, undefined);
});

test("unknown history fields cannot bypass the retained entry, actor, track, or profile schemas", () => {
  configure();
  const raw: any = recorded();
  raw.actor = { ...actor, extra: urls[0] };
  raw.audioTrack = { id: "1", lang: "ara", title: urls[1], extra: urls[2] };
  raw.extra = urls[0];
  assert.equal(history.recordActualPlayback(raw), true);
  const entry: any = history.readPlayback(raw.src.meta.id);
  values.set(
    storageKey,
    JSON.stringify({
      [raw.src.meta.id]: {
        ...entry,
        extra: urls[0],
        actualByProfile: { one: { ...entry.actualByProfile.one, extra: urls[0] } },
      },
    }),
  );
  history.readLastActualPlayback();
  assert.doesNotMatch(values.get(storageKey)!, /PATHSECRET123|QUERYSECRET123|INNERSECRET|"extra"/);
});

test("a URL-only source preference and its season lock retain exact matching without storing transport", () => {
  configure();
  const url = urls[0];
  const entry = {
    addonId: "synthetic-addon",
    url,
    title: url,
    parsedTitle: encodeURIComponent(url),
    extra: url,
  };
  history.savePlayback("tt-preference", entry);
  saveSeasonLock("tt-preference", entry, 2);
  const saved = history.readPlayback("tt-preference")!;
  assert.equal(history.streamMatchesEntry({ addonId: "synthetic-addon", url }, saved), true);
  assert.equal(
    history.streamMatchesEntry({ addonId: "synthetic-addon", url: urls[1] }, saved),
    false,
  );
  assert.equal(history.streamMatchesEntry({ url }, readSeasonLock("tt-preference", 2)!), true);
  assert.doesNotMatch([...values.values()].join(""), /PATHSECRET123|"extra"|https%3A/i);
});

test("legacy key migration keeps both private profile sessions when a canonical key already exists", () => {
  configure();
  const src = source(urls[1]);
  src.meta.id = `url:${urls[1]}`;
  history.recordActualPlayback(recorded(src, "one"));
  const canonical = Object.keys(JSON.parse(values.get(storageKey)!))[0];
  const one = { ...recorded(src, "one"), actor: { ...actor, privateCw: true } };
  const two = {
    ...recorded(src, "two"),
    actor: { ...actor, profileId: "two", privateCw: true },
    playedAt: one.playedAt + 1,
  };
  values.set(
    storageKey,
    JSON.stringify({
      [src.meta.id]: {
        savedAt: one.playedAt,
        actual: one,
        actualByProfile: { one: { actual: one } },
      },
      [canonical]: {
        savedAt: two.playedAt,
        actual: two,
        actualByProfile: { two: { actual: two } },
      },
    }),
  );
  values.set("harbor.settings.shared", JSON.stringify({ cwPerProfile: true }));
  assert.equal(history.readLastActualPlayback()?.id, "one");
  const migrated = JSON.parse(values.get(storageKey)!);
  assert.deepEqual(Object.keys(migrated), [canonical]);
  assert.equal(migrated[canonical].actualByProfile.two.actual.id, "two");
  assert.doesNotMatch(values.get(storageKey)!, /QUERYSECRET123/);
});

test("a late subtitle cache update identifies the exact redacted source and rejects a newer selection", () => {
  configure();
  const src = source();
  src.meta.id = `url:${urls[0]}`;
  const first = {
    source: urls[0],
    external: true,
    lang: "ara",
    streamKey: subtitleStreamKey(src.streamRef),
  };
  assert.equal(history.recordActualPlayback({ ...recorded(src), subtitle: first }), true);
  const target = history.readActualPlaybackForSubtitle(
    subtitleMediaKey(src.meta.id),
    first.streamKey,
    0,
  )!;
  assert.ok(target);
  const cached = { imported: true, external: true, lang: "ara", source: "C:/synthetic/cached.srt" };
  assert.equal(history.cacheActualPlaybackSubtitle(target, first, cached), true);
  assert.equal(history.readLastActualPlayback()?.subtitle?.source, cached.source);
  assert.equal(
    history.recordActualPlayback({ ...recorded(src), subtitle: { ...first, source: urls[1] } }),
    true,
  );
  assert.equal(history.cacheActualPlaybackSubtitle(target, first, cached), false);
  assert.doesNotMatch(values.get(storageKey)!, /PATHSECRET123|QUERYSECRET123/);
});

test("a manual URL returns to its live session but asks for re-entry after restart", async () => {
  configure();
  const src = source(urls[0]);
  src.meta.id = `url:${urls[0]}`;
  assert.equal(history.recordActualPlayback(recorded(src)), true);
  const target = history.readLastActualPlayback()!;
  let returned = false;
  const services: ContinuationServices = {
    isCurrent: history.isPlaybackActorCurrent,
    latest: history.readLastActualPlayback,
    active: () => ({
      src,
      resume: async () => {
        returned = true;
      },
    }),
    localFileExists: async () => {
      throw new Error("not local");
    },
    prepareServer: async () => {
      throw new Error("not a server");
    },
    openPlayer: () => {
      throw new Error("must not reopen a retained network URL");
    },
    openPicker: () => {
      throw new Error("no resolver for a manual URL");
    },
  };
  assert.equal(await continueActualPlayback(target, {}, services), "returned");
  assert.equal(returned, true);
  await assert.rejects(
    continueActualPlayback(target, {}, { ...services, active: () => null }),
    /open.*source|enter.*link/i,
  );
});

test("protocol-relative URLs in ordinary text and IDs are not retained", () => {
  configure();
  const src = source();
  const label = "Provider //media.example/private/PATHSECRET";
  src.meta.name = label;
  src.title = label;
  history.recordActualPlayback(recorded(src));
  history.savePlayback("addon " + label, { title: label });
  assert.doesNotMatch(values.get(storageKey)!, /PATHSECRET/);
});

test("invalid required snapshot scalars are rejected and optional scalars cannot store objects", () => {
  configure();
  const actual = recorded(source("C:/synthetic/movie.mp4"));
  const nested = { url: urls[0] };
  assert.equal(history.recordActualPlayback({ ...actual, completed: nested } as any), false);
  assert.equal(
    history.recordActualPlayback({
      ...actual,
      subDelaySec: nested,
      audioDelaySec: nested,
      requiresSourceRefresh: nested,
    } as any),
    true,
  );
  assert.doesNotMatch(values.get(storageKey)!, /PATHSECRET123/);
  assert.equal(history.readLastActualPlayback()?.subDelaySec, undefined);
});

test("a malformed legacy snapshot cannot prevent cleaning other history entries", () => {
  configure();
  const valid = recorded(source("C:/synthetic/movie.mp4"));
  values.set(
    storageKey,
    JSON.stringify({
      broken: {
        savedAt: Date.now(),
        actual: { ...valid, src: { ...valid.src, meta: { ...valid.src.meta, id: 42 } } },
      },
      valid: { savedAt: Date.now(), url: urls[0], actual: valid },
    }),
  );
  assert.equal(history.readLastActualPlayback()?.id, valid.id);
  assert.doesNotMatch(values.get(storageKey)!, /PATHSECRET123/);
});

test("legacy URL IDs ending in key-like text retain their exact source identity", () => {
  for (const suffix of ["|all", "|s2e3"]) {
    configure();
    const src = source(urls[1] + suffix);
    src.meta.id = `url:${src.url}`;
    values.set(
      storageKey,
      JSON.stringify({ [src.meta.id]: { savedAt: Date.now(), actual: { ...recorded(src), src } } }),
    );
    assert.equal(history.readActualPlaybackFor(src)?.id, "observed");
    assert.equal(history.readPlayback(src.meta.id)?.actual?.id, "observed");
    assert.doesNotMatch(values.get(storageKey)!, /QUERYSECRET123/);
  }
});

test("raw-key statistics scrub old transport without imposing an earlier history expiry", () => {
  configure();
  const id = `url:${urls[0]}`;
  values.set(
    storageKey,
    JSON.stringify({ [id]: { savedAt: Date.now() - 31 * 86400000, url: urls[0] } }),
  );
  const keys = history.playbackHistoryRawKeys();
  assert.equal(keys.length, 1);
  assert.doesNotMatch(keys[0], /PATHSECRET123/);
  assert.doesNotMatch(values.get(storageKey)!, /PATHSECRET123/);
  assert.equal(Object.keys(JSON.parse(values.get(storageKey)!)).length, 1);
});

test("expired season locks cannot leave their old transport in storage", () => {
  configure();
  values.set(
    "harbor.season-lock.v1",
    JSON.stringify({ "tt-old|s2": { savedAt: Date.now() - 121 * 86400000, url: urls[1] } }),
  );
  assert.equal(readSeasonLock("tt-old", 2), null);
  assert.doesNotMatch(values.get("harbor.season-lock.v1")!, /QUERYSECRET123/);
});

test("late subtitle caching still matches a provider whose opaque ID contains a URL", () => {
  configure();
  const src = source();
  src.streamRef!.addonId = urls[1];
  const original = {
    source: urls[0],
    external: true,
    lang: "ara",
    streamKey: subtitleStreamKey(src.streamRef),
  };
  history.recordActualPlayback({ ...recorded(src), subtitle: original });
  const target = history.readActualPlaybackForSubtitle(
    subtitleMediaKey(src.meta.id),
    original.streamKey,
    0,
  )!;
  assert.ok(target);
  assert.equal(
    history.cacheActualPlaybackSubtitle(target, original, {
      source: "C:/synthetic/cached.srt",
      imported: true,
      external: true,
    }),
    true,
  );
  assert.doesNotMatch(values.get(storageKey)!, /PATHSECRET123|QUERYSECRET123/);
});

test("manual URL preferences do not retain a path credential as a bare title", () => {
  configure();
  const id = "url:https://media.example/play/BARESECRET123";
  const entry = {
    url: "https://media.example/play/BARESECRET123",
    title: "BARESECRET123",
    parsedTitle: "BARESECRET123",
  };
  history.savePlayback(id, entry);
  saveSeasonLock(id, entry, 1);
  assert.doesNotMatch([...values.values()].join(""), /BARESECRET123/);
});

test("a redacted external subtitle restores only an exact fresh transport or its provider identity", () => {
  configure();
  const original = { external: true, lang: "ara", source: urls[0] };
  history.recordActualPlayback({ ...recorded(), subtitle: original });
  const choice = history.readLastActualPlayback()!.subtitle!;
  const track = {
    id: "new-id",
    kind: "subtitle" as const,
    external: true,
    lang: "ara",
    label: "Arabic",
    originalUrl: urls[0],
  };
  assert.equal(selectPlaybackSubtitle([track], choice)?.id, "new-id");
  assert.equal(selectPlaybackSubtitle([{ ...track, originalUrl: urls[1] }], choice), null);
  assert.equal(
    selectPlaybackSubtitle([track, { ...track, id: "duplicate" }], choice),
    null,
    "ambiguous matches remain unavailable",
  );
  const cached = { ...choice, source: "C:/synthetic/chosen.srt", imported: true };
  const local = { ...track, id: "cached", originalUrl: undefined, externalFilename: cached.source };
  assert.equal(
    selectPlaybackSubtitle([track, local], cached)?.id,
    "cached",
    "the exact cached file takes precedence over its old remote fingerprint",
  );
  assert.doesNotMatch(values.get(storageKey)!, /PATHSECRET123/);
});

test("the existing empty guest scope remains a valid playback owner", () => {
  values.clear();
  const guest = history.capturePlaybackActor();
  assert.equal(guest.profileId, "");
  assert.equal(
    history.recordActualPlayback({ ...recorded(source("C:/synthetic/guest.mp4")), actor: guest }),
    true,
  );
  assert.equal(history.readLastActualPlayback()?.id, "observed");
});

test("free text cannot hide a relative transport behind punctuation or URI nesting", () => {
  configure();
  for (const prefix of [
    "Provider{",
    "Provider:",
    "Provider_",
    "Provider/",
    "Provider|",
    "Provider[",
    "Provider(",
  ]) {
    const text = `${prefix}//media.example/private/PUNCTSECRET`;
    for (const label of [
      text,
      encodeURIComponent(text),
      encodeURIComponent(encodeURIComponent(text)),
    ]) {
      const src = source("C:/synthetic/movie.mp4");
      src.title = label;
      src.meta.name = label;
      history.recordActualPlayback(recorded(src));
      history.savePlayback("tt-provenance", { title: label, parsedTitle: label });
      assert.doesNotMatch(values.get(storageKey)!, /PUNCTSECRET/);
    }
  }
});

test("validated filesystem and installed-plugin identities remain usable", () => {
  configure();
  const src = source("file:///C:/synthetic/movie.mp4");
  src.meta.id = `local:${src.url}`;
  src.meta.addonOrigin = {
    id: "synthetic",
    name: "Installed plugin",
    base: "harbor-plugin://synthetic/id",
  };
  history.recordActualPlayback(recorded(src));
  const saved = history.readLastActualPlayback()!;
  assert.equal(saved.src.url, src.url);
  assert.equal(saved.src.meta.id, src.meta.id);
  assert.equal(saved.src.meta.name, src.meta.name);
  assert.equal(saved.src.meta.addonOrigin?.base, src.meta.addonOrigin.base);
});
