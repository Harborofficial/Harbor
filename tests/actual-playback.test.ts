import assert from "node:assert/strict";
import test from "node:test";
import * as history from "../src/lib/playback-history";

const values = new Map<string, string>();
let failWrite = false;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrite) throw new Error("fixture storage failure");
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
  },
});

function actor(profileId = "one", accountId = "account-one", shared?: string) {
  values.set(
    "harbor.profiles.v1",
    JSON.stringify({
      activeId: profileId,
      profiles: [
        { id: "one", isPrimary: true },
        { id: "two", shareStremioWith: shared },
      ],
    }),
  );
  values.set(
    `harbor.auth.${shared ?? profileId}`,
    JSON.stringify({ authKey: `key-${accountId}`, user: { _id: accountId } }),
  );
  return history.capturePlaybackActor();
}

function fixture(id: string, path: string, at: number, captured = actor()) {
  return {
    id,
    actor: captured,
    playedAt: at,
    positionMs: 12345,
    durationMs: 180000,
    completed: false,
    src: {
      meta: { id: "local:fixture", type: "movie" as const, name: "Fixture" },
      url: path,
      title: "Fixture",
      notWebReady: true,
    },
  };
}

function markLegacyDismissals(key: string): string {
  const stored = JSON.parse(values.get(key)!);
  for (const entry of Object.values(stored) as any[]) {
    if (entry.actual) entry.dismissedActualId = entry.actual.id;
    for (const state of Object.values(entry.actualByProfile ?? {}) as any[])
      if (state.actual) state.dismissedActualId = state.actual.id;
  }
  const raw = JSON.stringify(stored);
  values.set(key, raw);
  return raw;
}

test("actual playback does not derive recency from source selections or manual history", () => {
  values.clear();
  actor();
  history.savePlayback("tt-not-played", { title: "Opened source" });
  assert.equal(history.readLastActualPlayback(), null);
  const first = fixture("played-one", "C:/fixture/first.mp4", Date.now());
  assert.equal(history.recordActualPlayback(first), true);
  history.savePlayback("local:fixture", {
    url: "https://fixture.invalid/unplayed",
    title: "Not yet playing",
  });
  history.savePlayback("tt-newer-manual", { title: "Manually watched" });
  assert.equal(history.readLastActualPlayback()?.id, "played-one");
  assert.equal(history.readLastActualPlayback()?.src.url, first.src.url);
});

test("exact physical source and position survive storage round trip without title merging", () => {
  values.clear();
  actor();
  const one = fixture("file-one", "C:/fixture/one.mp4", Date.now());
  const two = { ...fixture("file-two", "C:/fixture/two.mp4", Date.now() + 1), positionMs: 67890 };
  history.recordActualPlayback(one);
  history.recordActualPlayback(two);
  const read = history.readLastActualPlayback();
  assert.equal(read?.src.url, two.src.url);
  assert.equal(read?.positionMs, 67890);
  assert.notEqual(read, two);
});

test("actor changes reject delayed writes and account changes hide previous account playback", () => {
  values.clear();
  const one = actor();
  history.recordActualPlayback(fixture("old", "C:/fixture/a.mp4", Date.now(), one));
  actor("two", "account-two");
  assert.equal(
    history.recordActualPlayback(fixture("late", "C:/fixture/a.mp4", Date.now() + 1, one)),
    false,
  );
  assert.equal(history.readLastActualPlayback(), null);
  actor("one", "new-account");
  assert.equal(history.readLastActualPlayback(), null);
});

test("intentional shared Stremio history scope is preserved but delayed actor writes are rejected", () => {
  values.clear();
  const one = actor();
  history.recordActualPlayback(fixture("shared", "C:/fixture/a.mp4", Date.now(), one));
  actor("two", "account-one", "one");
  assert.equal(history.readLastActualPlayback()?.id, "shared");
  assert.equal(
    history.recordActualPlayback(fixture("late", "C:/fixture/a.mp4", Date.now(), one)),
    false,
  );
});

test("failed persistence preserves existing record and does not report a saved replacement", () => {
  values.clear();
  actor();
  history.recordActualPlayback(fixture("saved", "C:/fixture/a.mp4", Date.now()));
  failWrite = true;
  try {
    assert.equal(
      history.recordActualPlayback(fixture("not-saved", "C:/fixture/b.mp4", Date.now() + 1)),
      false,
    );
  } finally {
    failWrite = false;
  }
  assert.equal(history.readLastActualPlayback()?.id, "saved");
});

test("rejecting an unplayed bad source clears its preference but retains actual last playback", () => {
  values.clear();
  actor();
  history.recordActualPlayback(fixture("played", "C:/fixture/a.mp4", Date.now()));
  history.savePlayback("local:fixture", { infoHash: "bad-source", fileIdx: 2 });
  history.clearPlayback("local:fixture");
  assert.equal(history.readPlayback("local:fixture")?.infoHash, undefined);
  assert.equal(history.readLastActualPlayback()?.id, "played");
});

test("EOF without mpv tracks persists the last valid audio from that same playback session", () => {
  values.clear();
  const first = fixture("same-session", "C:/fixture/a.mp4", Date.now());
  const audioTrack = {
    id: "2",
    lang: "ara",
    title: "Commentary",
    channels: "stereo",
    channelCount: 2,
  };
  history.recordActualPlayback({ ...first, audioTrack });
  history.recordActualPlayback({
    ...first,
    playedAt: first.playedAt + 1,
    positionMs: 179600,
    completed: true,
  });
  const ended = history.readLastActualPlayback();
  assert.deepEqual(ended?.audioTrack, audioTrack);
  assert.equal(ended?.completed, true);
  assert.equal(ended?.positionMs, 179600);
});

test("EOF audio preservation never crosses a physical source, session, or actor", () => {
  for (const change of ["source", "session", "actor"] as const) {
    values.clear();
    const first = fixture("one-session", "C:/fixture/a.mp4", Date.now());
    history.recordActualPlayback({ ...first, audioTrack: { id: "2", lang: "ara" } });
    const second = {
      ...first,
      completed: true,
      playedAt: first.playedAt + 1,
      id: change === "session" ? "two-session" : first.id,
      src: change === "source" ? { ...first.src, url: "C:/fixture/b.mp4" } : first.src,
      actor: change === "actor" ? actor("one", "new-account") : first.actor,
    };
    history.recordActualPlayback(second);
    assert.equal(history.readLastActualPlayback()?.audioTrack, undefined, change);
  }
});

test("an invalid prior snapshot cannot supply EOF audio or prevent the new snapshot from saving", () => {
  values.clear();
  const first = fixture("same-session", "C:/fixture/a.mp4", Date.now());
  history.recordActualPlayback({ ...first, audioTrack: { id: "2", lang: "ara" } });
  const key = "harbor.playback-history.v1.one";
  const stored = JSON.parse(values.get(key)!);
  delete stored["local:fixture"].actual.actor;
  delete stored["local:fixture"].actualByProfile.one.actual.actor;
  values.set(key, JSON.stringify(stored));
  assert.equal(history.recordActualPlayback({ ...first, completed: true }), true);
  assert.equal(history.readLastActualPlayback()?.audioTrack, undefined);
});

test("legacy dismissal flags cannot hide the newest shared or private playback or replace it with an older item", () => {
  for (const privateCw of [false, true]) {
    values.clear();
    values.set("harbor.settings.shared", JSON.stringify({ cwPerProfile: privateCw }));
    actor("one", "account-one", "one");
    const older = fixture("old", "C:/fixture/old.mp4", Date.now(), history.capturePlaybackActor());
    older.src.meta.id = "local:older";
    history.recordActualPlayback(older);
    const latest = fixture(
      "new",
      "C:/fixture/new.mp4",
      Date.now() + 1,
      history.capturePlaybackActor(),
    );
    history.recordActualPlayback(latest);
    const key = "harbor.playback-history.v1.one";
    const persisted = markLegacyDismissals(key);
    assert.equal(history.readLastActualPlayback()?.id, latest.id);
    assert.equal(values.get(key), persisted, "reading an old flag never rewrites stored history");
    assert.equal(history.readActualPlaybackFor(latest.src)?.id, latest.id);
    assert.equal(history.readPlayback("local:older")?.actual?.id, older.id);
    values.set(key, JSON.stringify(JSON.parse(persisted)));
    assert.equal(history.readLastActualPlayback()?.id, latest.id, "fresh reads ignore old flags");
    history.recordActualPlayback({ ...latest, playedAt: latest.playedAt + 1, positionMs: 13000 });
    assert.equal(history.readLastActualPlayback()?.positionMs, 13000);
    history.savePlayback(latest.src.meta.id, { title: "A metadata edit" });
    assert.equal(history.readLastActualPlayback()?.id, latest.id);
    history.recordActualPlayback({
      ...latest,
      id: "genuine-new-session",
      playedAt: Date.now() + 3,
    });
    assert.equal(history.readLastActualPlayback()?.id, "genuine-new-session");
  }
});

test("ignoring legacy dismissal keeps account isolation and failed-write protection", () => {
  values.clear();
  const captured = actor();
  const target = fixture("one", "C:/fixture/a.mp4", Date.now(), captured);
  history.recordActualPlayback(target);
  markLegacyDismissals("harbor.playback-history.v1.one");
  assert.equal(history.readLastActualPlayback()?.id, target.id);
  const next = { ...target, id: "two", playedAt: target.playedAt + 1 };
  failWrite = true;
  try {
    assert.equal(history.recordActualPlayback(next), false);
  } finally {
    failWrite = false;
  }
  assert.equal(history.readLastActualPlayback()?.id, target.id);
  actor("two", "other-account");
  assert.equal(history.readLastActualPlayback(), null);
  assert.equal(history.recordActualPlayback(next), false);
  actor();
  assert.equal(history.readLastActualPlayback()?.id, target.id);
});

test("existing history retention accepts a four-day-old session but not an expired actual session refreshed by metadata", () => {
  values.clear();
  actor();
  const day = 24 * 60 * 60 * 1000;
  history.recordActualPlayback(fixture("four-days", "C:/fixture/a.mp4", Date.now() - 4 * day));
  assert.equal(history.readLastActualPlayback()?.id, "four-days");
  values.clear();
  actor();
  const stale = fixture("expired", "C:/fixture/a.mp4", Date.now() - 31 * day);
  history.recordActualPlayback(stale);
  history.savePlayback(stale.src.meta.id, { title: "Unplayed source selection" });
  assert.equal(history.readLastActualPlayback(), null);
});

test("natural EOF preserves the last subtitle intent and delays from its exact session", () => {
  values.clear();
  const first = {
    ...fixture("same", "C:/fixture/a.mp4", Date.now()),
    subtitle: { source: "C:/fixture/a.srt", external: true },
    subDelaySec: 2,
    audioDelaySec: -0.3,
  };
  history.recordActualPlayback(first);
  history.recordActualPlayback({
    ...first,
    completed: true,
    playedAt: first.playedAt + 1,
    subtitle: undefined,
    subDelaySec: undefined,
    audioDelaySec: undefined,
  });
  const ended = history.readLastActualPlayback();
  assert.deepEqual(ended?.subtitle, first.subtitle);
  assert.equal(ended?.subDelaySec, 2);
  assert.equal(ended?.audioDelaySec, -0.3);
});

test("late subtitle caching upgrades only the captured actual session without changing recency or honoring old dismissal", () => {
  values.clear();
  const now = Date.now();
  const original = {
    source: "https://fixture.invalid/a.srt",
    external: true,
    streamKey: "torrent:abc:2",
    subId: "a",
    provider: "Fixture",
  };
  const playback = {
    ...fixture("played", "C:/fixture/a.mp4", now),
    subtitle: original,
    subDelaySec: 1.2,
  };
  playback.src.streamRef = { infoHash: "abc", fileIdx: 2 };
  history.recordActualPlayback(playback);
  const captured = history.readActualPlaybackForSubtitle(
    "local:fixture||",
    "torrent:abc:2",
    now - 1,
  );
  assert.equal(captured?.id, "played");
  assert.equal(
    history.readActualPlaybackForSubtitle("local:fixture||", "torrent:abc:2", now + 1),
    null,
  );
  markLegacyDismissals("harbor.playback-history.v1.one");
  const cached = { ...original, source: "C:/fixture/cached.srt", imported: true };
  assert.equal(history.cacheActualPlaybackSubtitle(captured!, original, cached), true);
  const saved = history.readActualPlaybackFor(playback.src)!;
  assert.equal(saved.subtitle?.source, cached.source);
  assert.equal(saved.playedAt, now);
  assert.equal(saved.subDelaySec, 1.2);
  assert.equal(history.readLastActualPlayback()?.id, playback.id);
  history.recordActualPlayback({ ...playback, id: "new-session", playedAt: now + 1 });
  assert.equal(history.cacheActualPlaybackSubtitle(captured!, original, cached), false);
  actor("two", "other-account");
  assert.equal(history.cacheActualPlaybackSubtitle(captured!, original, cached), false);
});

test("private CW keeps same-title actual playback independent and ignores old flags without changing shared source history", () => {
  values.clear();
  values.set("harbor.settings.shared", JSON.stringify({ cwPerProfile: true }));
  const one = actor("one", "account-one", "one");
  const first = fixture("private-one", "C:/fixture/one.mp4", Date.now(), one);
  history.savePlayback(first.src.meta.id, { addonId: "shared-addon", title: "Fixture" });
  assert.equal(history.recordActualPlayback(first), true);
  const two = actor("two", "account-one", "one");
  assert.equal(history.readLastActualPlayback(), null);
  assert.equal(history.readActualPlaybackFor(first.src), null);
  assert.equal(history.readPlayback(first.src.meta.id)?.addonId, "shared-addon");
  const second = fixture("private-two", "C:/fixture/two.mp4", first.playedAt + 1, two);
  assert.equal(history.recordActualPlayback(second), true);
  markLegacyDismissals("harbor.playback-history.v1.one");
  assert.equal(history.readLastActualPlayback()?.id, second.id);
  actor("one", "account-one", "one");
  assert.equal(history.readLastActualPlayback()?.id, first.id);
  history.savePlayback(first.src.meta.id, { title: "Metadata only" });
  history.clearPlayback(first.src.meta.id);
  assert.equal(history.readLastActualPlayback()?.id, first.id);
  actor("two", "account-one", "one");
  assert.equal(history.readLastActualPlayback()?.id, second.id);
  assert.equal(history.readActualPlaybackFor(second.src)?.id, second.id);
  actor("one", "account-one", "one");
  values.set("harbor.settings.shared", JSON.stringify({ cwPerProfile: false }));
  assert.equal(
    history.readLastActualPlayback()?.id,
    second.id,
    "shared suggestion keeps the latest shared actual session",
  );
});

test("private legacy adoption requires the actual playback owner's identity", () => {
  values.clear();
  const one = actor("one", "account-one", "one");
  const first = fixture("legacy-one", "C:/fixture/one.mp4", Date.now(), one);
  values.set(
    "harbor.playback-history.v1.one",
    JSON.stringify({ "local:fixture": { actual: first, savedAt: first.playedAt } }),
  );
  values.set("harbor.settings.shared", JSON.stringify({ cwPerProfile: true }));
  assert.equal(history.readLastActualPlayback()?.id, first.id);
  actor("two", "account-one", "one");
  assert.equal(history.readLastActualPlayback(), null);
  assert.equal(history.readActualPlaybackFor(first.src), null);
  assert.equal(history.recordActualPlayback(first), false);
});

test("private EOF and late cache keep their own session without replacing a newer shared session", () => {
  values.clear();
  values.set("harbor.settings.shared", JSON.stringify({ cwPerProfile: true }));
  const one = actor("one", "account-one", "one");
  const original = { source: "https://fixture.invalid/one.srt", external: true };
  const first = {
    ...fixture("private-one", "C:/fixture/one.mp4", Date.now(), one),
    subtitle: original,
    audioTrack: { id: "2", lang: "ara" },
    subDelaySec: 1.2,
  };
  history.recordActualPlayback(first);
  const two = actor("two", "account-one", "one");
  const second = fixture("private-two", "C:/fixture/two.mp4", first.playedAt + 2, two);
  history.recordActualPlayback(second);
  actor("one", "account-one", "one");
  const cached = { ...original, source: "C:/fixture/cached-one.srt", imported: true };
  assert.equal(history.cacheActualPlaybackSubtitle(first, original, cached), true);
  assert.equal(history.readLastActualPlayback()?.subtitle?.source, cached.source);
  assert.equal(history.readPlayback(first.src.meta.id)?.actual?.id, second.id);
  history.recordActualPlayback({
    ...first,
    completed: true,
    playedAt: first.playedAt + 1,
    audioTrack: undefined,
    subtitle: undefined,
    subDelaySec: undefined,
  });
  assert.deepEqual(history.readLastActualPlayback()?.audioTrack, first.audioTrack);
  assert.equal(history.readLastActualPlayback()?.subtitle?.source, cached.source);
  assert.equal(history.readLastActualPlayback()?.subDelaySec, 1.2);
  assert.equal(history.readPlayback(first.src.meta.id)?.actual?.id, second.id);
});

test("a fresh shared entry cannot extend an expired private actual session", () => {
  values.clear();
  values.set("harbor.settings.shared", JSON.stringify({ cwPerProfile: true }));
  const one = actor("one", "account-one", "one");
  const first = fixture("private-one", "C:/fixture/one.mp4", Date.now(), one);
  history.recordActualPlayback(first);
  const two = actor("two", "account-one", "one");
  history.recordActualPlayback(fixture("private-two", "C:/fixture/two.mp4", Date.now() + 1, two));
  const key = "harbor.playback-history.v1.one";
  const stored = JSON.parse(values.get(key)!);
  stored["local:fixture"].actualByProfile.one.actual.playedAt =
    Date.now() - 31 * 24 * 60 * 60 * 1000;
  values.set(key, JSON.stringify(stored));
  actor("one", "account-one", "one");
  assert.equal(history.readLastActualPlayback(), null);
  assert.equal(history.readActualPlaybackFor(first.src), null);
});

test("privacy policy changes invalidate captured writes without hiding the existing session", () => {
  values.clear();
  const one = actor("one", "account-one", "one");
  const first = fixture("shared-one", "C:/fixture/one.mp4", Date.now(), one);
  history.recordActualPlayback(first);
  actor("two", "account-one", "one");
  assert.equal(history.readLastActualPlayback()?.id, first.id);
  markLegacyDismissals("harbor.playback-history.v1.one");
  actor("one", "account-one", "one");
  assert.equal(history.readLastActualPlayback()?.id, first.id);
  values.set("harbor.settings.shared", JSON.stringify({ cwPerProfile: true }));
  assert.equal(history.isPlaybackActorCurrent(one), false);
  assert.equal(history.recordActualPlayback({ ...first, id: "late" }), false);
  assert.equal(
    history.readLastActualPlayback()?.id,
    first.id,
    "private suggestion remains available from its own observed session",
  );
});

test("Nuvio account, provider, and slot changes isolate last actual playback and reject stale actors", () => {
  values.clear();
  actor();
  history.recordActualPlayback(fixture("old-stremio", "C:/fixture/stremio.mp4", Date.now()));
  values.set("harbor.account-provider", "nuvio");
  const nuvio = (accountId: string, slot: number) => {
    values.set(
      "harbor.nuvio.state.v1",
      JSON.stringify({ activeProfileIndex: slot, session: { user: { id: accountId } } }),
    );
    return history.capturePlaybackActor();
  };
  const one = nuvio("nuvio-account-a", 1);
  assert.equal(
    history.readLastActualPlayback(),
    null,
    "Nuvio cannot adopt an unattributed legacy Stremio session",
  );
  const first = fixture("nuvio-one", "C:/fixture/one.mp4", Date.now(), one);
  assert.equal(history.recordActualPlayback(first), true);
  const two = nuvio("nuvio-account-a", 2);
  assert.equal(history.isPlaybackActorCurrent(one), false);
  assert.equal(history.readLastActualPlayback(), null);
  const second = fixture("nuvio-two", "C:/fixture/two.mp4", first.playedAt + 1, two);
  assert.equal(history.recordActualPlayback(second), true);
  markLegacyDismissals("harbor.playback-history.v1.nuvio.nuvio-account-a.nuvio-2");
  nuvio("nuvio-account-a", 1);
  assert.equal(history.readLastActualPlayback()?.id, first.id);
  nuvio("nuvio-account-b", 1);
  assert.equal(history.isPlaybackActorCurrent(one), false);
  assert.equal(history.readLastActualPlayback(), null);
  assert.equal(history.recordActualPlayback({ ...first, id: "late" }), false);
  nuvio("nuvio-account-a", 2);
  assert.equal(history.readLastActualPlayback()?.id, second.id);
  values.set("harbor.account-provider", "stremio");
  assert.equal(history.isPlaybackActorCurrent(two), false);
  assert.equal(history.readLastActualPlayback()?.id, "old-stremio");
  const stremio = fixture("stremio", "C:/fixture/stremio.mp4", Date.now());
  history.recordActualPlayback(stremio);
  values.set("harbor.account-provider", "nuvio");
  nuvio("nuvio-account-a", 1);
  assert.equal(history.readLastActualPlayback()?.id, first.id);
});

test("scope events notify only for account, provider, profile, slot, or privacy changes", () => {
  values.clear();
  actor("one", "account-one", "one");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  let notifications = 0;
  const revision = history.getPlaybackRevision();
  const unsubscribe = history.subscribePlayback(() => notifications++);
  const unsubscribeOther = history.subscribePlayback(() => {});
  try {
    events.dispatchEvent(new Event("harbor:settings-changed"));
    assert.equal(notifications, 0);
    values.set("harbor.settings.shared", JSON.stringify({ cwPerProfile: true }));
    events.dispatchEvent(new Event("harbor:settings-changed"));
    assert.equal(notifications, 1);
    actor("two", "account-one", "one");
    events.dispatchEvent(new Event("harbor:active-profile-changed"));
    assert.equal(notifications, 2);
    values.set("harbor.account-provider", "nuvio");
    values.set(
      "harbor.nuvio.state.v1",
      JSON.stringify({ activeProfileIndex: 1, session: { user: { id: "account-a" } } }),
    );
    events.dispatchEvent(new Event("harbor:account-provider-changed"));
    assert.equal(notifications, 3);
    values.set(
      "harbor.nuvio.state.v1",
      JSON.stringify({
        activeProfileIndex: 2,
        session: { user: { id: "account-a" }, access_token: "fixture-refresh" },
      }),
    );
    events.dispatchEvent(new Event("harbor:nuvio-profile-changed"));
    assert.equal(notifications, 4);
    values.set(
      "harbor.nuvio.state.v1",
      JSON.stringify({
        activeProfileIndex: 2,
        session: { user: { id: "account-a" }, access_token: "fixture-next-refresh" },
      }),
    );
    events.dispatchEvent(new Event("harbor:nuvio-state-changed"));
    assert.equal(notifications, 4, "token refresh cannot invalidate a same-owner session");
    values.set(
      "harbor.nuvio.state.v1",
      JSON.stringify({ activeProfileIndex: 2, session: { user: { id: "account-b" } } }),
    );
    events.dispatchEvent(new Event("harbor:nuvio-state-changed"));
    assert.equal(notifications, 5);
    assert.equal(
      history.getPlaybackRevision(),
      revision + 5,
      "revision advances once per scope change, not per subscriber",
    );
    unsubscribe();
    unsubscribeOther();
    values.set("harbor.account-provider", "stremio");
    events.dispatchEvent(new Event("harbor:account-provider-changed"));
    assert.equal(notifications, 5, "scope listeners are cleaned up after the last subscriber");
  } finally {
    unsubscribe();
    unsubscribeOther();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
