import assert from "node:assert/strict";
import test from "node:test";
import { actualPlaybackSnapshot } from "../src/lib/player/actual-playback";
import { initialPlayerSnapshot } from "../src/lib/player/bridge";
import * as history from "../src/lib/playback-history";
import type { PlayerSrc } from "../src/lib/view";
import {
  continueActualPlayback,
  continuationAppliesToSource,
  continuationFor,
  type ContinuationServices,
} from "../src/lib/player/continue-playback";

const values = new Map<string, string>();
let failWrite = false;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrite) throw new Error("synthetic storage failure");
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
  },
});

const storageKey = "harbor.playback-history.v1.one";
const actor = { profileId: "one", storageProfileId: "one", accountId: null };
const snapshot = {
  ...initialPlayerSnapshot(),
  status: "playing" as const,
  firstFrameReady: true,
  durationSec: 400,
  audioTracks: [{ id: "2", kind: "audio" as const, label: "Arabic", lang: "ara", selected: true }],
  subDelaySec: 1.25,
  audioDelaySec: -0.2,
  subtitleFps: 23.976,
};

function configure(privateCw = false): void {
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
  values.set("harbor.settings.shared", JSON.stringify({ cwPerProfile: privateCw }));
}

function serverSource(provider: string, query: string): PlayerSrc {
  const credential = `synthetic-${provider}-credential`;
  const url = `https://${provider}.invalid/video?${query}=${credential}`;
  return {
    meta: {
      id: "tt-synthetic",
      type: "series",
      name: "Synthetic series",
      poster: `https://${provider}.invalid/poster?${query}=${credential}`,
      background: `https://synthetic-user:${credential}@${provider}.invalid/background`,
      logo: "https://public.invalid/logo.png",
      adult: true,
      addonOrigin: { id: "synthetic-addon", name: "Synthetic addon", base: url, logo: url },
      videos: [{ season: 2, episode: 3, thumbnail: url, streams: [{ url }] }],
    },
    episode: {
      season: 2,
      episode: 3,
      name: "Synthetic episode",
      still: url,
      sourceMetaId: "tt-source",
    },
    url,
    historyUrl: url,
    title: "Synthetic video",
    headers: { Authorization: credential, "X-Emby-Token": credential, "X-Plex-Token": credential },
    homeServer: {
      connectionId: `synthetic-${provider}-connection`,
      itemId: "synthetic-item",
      versionId: "synthetic-version",
      quality: "original",
      playbackSessionId: `synthetic-${provider}-temporary-session`,
    },
    subtitles: [{ id: "stable-subtitle-9", url: `${url}&subtitle=9`, lang: "ara" }],
    subtitlePreselect: { off: false, url: `${url}&subtitle=old` },
    playbackTraceId: "synthetic-temporary-trace",
    proxySessionId: "synthetic-temporary-proxy",
    streamRef: { infoHash: "abc", fileIdx: 4, resolvedFilename: "Synthetic.S02E03.mkv" },
  };
}

function observed(src: PlayerSrc, at = Date.now()): history.ActualPlayback {
  return actualPlaybackSnapshot(
    src,
    {
      ...snapshot,
      subtitleTracks: [
        {
          id: "temporary-native-7",
          kind: "subtitle",
          label: "Arabic",
          lang: "ara",
          selected: true,
          external: true,
          url: src.subtitles?.[0]?.url,
        },
      ],
    },
    30,
    { id: "synthetic-observed-session", actor: history.capturePlaybackActor() },
    at,
  )!;
}

for (const [provider, query] of [
  ["jellyfin", "api_key"],
  ["emby", "X-Emby-Token"],
  ["plex", "X-Plex-Token"],
]) {
  test(`${provider} observed playback persists identity and choices without authenticated transport`, () => {
    configure();
    const src = serverSource(provider, query);
    const before = JSON.stringify(src);
    const playback = observed(src);
    assert.equal(playback.src.url, "");
    assert.deepEqual(playback.src.homeServer, {
      connectionId: `synthetic-${provider}-connection`,
      itemId: "synthetic-item",
      versionId: "synthetic-version",
      quality: "original",
    });
    assert.equal(playback.subtitle?.homeServerSubtitleId, "stable-subtitle-9");
    assert.equal(playback.subtitle?.source, undefined);
    assert.equal(playback.subtitle?.trackId, undefined);
    assert.equal(playback.subtitle?.fpsOverride, 23.976);
    assert.equal(playback.subDelaySec, 1.25);
    assert.equal(playback.audioDelaySec, -0.2);
    assert.equal(playback.audioTrack?.lang, "ara");
    assert.equal(playback.src.episode?.sourceMetaId, "tt-source");
    assert.equal(playback.src.meta.logo, undefined, "an arbitrary host is not public provenance");
    assert.equal(playback.src.meta.adult, true);
    assert.equal(playback.src.meta.addonOrigin?.id, "synthetic-addon");
    assert.match(playback.src.meta.addonOrigin?.configurationKey ?? "", /^[a-f0-9]{64}$/);
    assert.equal(history.recordActualPlayback(playback), true);
    const serialized = values.get(storageKey)!;
    assert.doesNotMatch(
      serialized,
      /credential|temporary-|Authorization|X-Emby-Token|X-Plex-Token|playbackSessionId|subtitlePreselect/,
    );
    assert.equal(history.readLastActualPlayback()?.id, playback.id);
    assert.equal(history.readActualPlaybackFor(src)?.id, playback.id);
    assert.equal(JSON.stringify(src), before, "snapshot must not mutate runtime transport");
  });
}

test("read boundaries scrub legacy shared and private actual slots without changing progress or ownership", () => {
  for (const legacyKey of ["harbor.playback-history.v1", storageKey]) {
    configure(true);
    const src = serverSource("legacy", "access_token");
    const at = Date.now() - 1000;
    const base = {
      id: "legacy-one",
      actor: { ...actor, privateCw: true },
      playedAt: at,
      positionMs: 31000,
      durationMs: 400000,
      completed: false,
      src,
      requiresSourceRefresh: true,
      subtitle: {
        source: src.subtitles![0].url,
        external: true,
        trackId: "synthetic-temporary-native",
        fpsOverride: 25,
      },
      subDelaySec: 2,
    };
    const other = {
      ...base,
      id: "legacy-two",
      actor: { ...base.actor, profileId: "two" },
      playedAt: at + 1,
    };
    values.set(
      legacyKey,
      JSON.stringify({
        "tt-synthetic|s2e3": {
          savedAt: at + 2,
          title: "Existing title",
          actual: other,
          actualByProfile: { one: { actual: base }, two: { actual: other } },
        },
        unrelated: { savedAt: at, title: "Keep unrelated history" },
      }),
    );
    const saved = history.readLastActualPlayback();
    assert.equal(saved?.id, "legacy-one");
    assert.equal(saved?.positionMs, 31000);
    assert.equal(saved?.playedAt, at);
    assert.equal(saved?.subtitle?.homeServerSubtitleId, "stable-subtitle-9");
    const serialized = values.get(storageKey)!;
    assert.doesNotMatch(
      serialized,
      /credential|temporary-|playbackSessionId|Authorization|subtitlePreselect/,
    );
    const entries = JSON.parse(serialized);
    assert.equal(entries["tt-synthetic|s2e3"].actual.id, "legacy-two");
    assert.equal(entries["tt-synthetic|s2e3"].actualByProfile.two.actual.playedAt, at + 1);
    assert.equal(entries["tt-synthetic|s2e3"].savedAt, at + 2);
    assert.equal(entries.unrelated.title, "Keep unrelated history");
  }
});

test("credentialed generic sources refresh through a known release instead of persisting credentials", () => {
  configure();
  const src: PlayerSrc = {
    meta: {
      id: "tt-public",
      type: "movie",
      name: "Public",
      poster: "https://art.invalid/image?token=synthetic-generic-credential",
    },
    title: "Public",
    url: "https://synthetic-user:synthetic-generic-credential@video.invalid/movie",
    streamRef: { addonId: "addon", parsedTitle: "Public.2026", size: 42 },
  };
  const playback = actualPlaybackSnapshot(src, snapshot, 20, { id: "generic", actor })!;
  assert.equal(history.recordActualPlayback(playback), true);
  assert.equal(history.readLastActualPlayback()?.src.url, "");
  assert.equal(history.readLastActualPlayback()?.requiresSourceRefresh, true);
  assert.equal(history.readActualPlaybackFor(src)?.id, "generic");
  assert.equal(history.actualPlaybackSourceKey(playback), history.playbackSourceKey(src));
  const context = continuationFor(playback, actor);
  assert.equal(
    continuationAppliesToSource({ ...src, url: "https://public.invalid/renewed" }, context),
    true,
  );
  assert.equal(
    continuationAppliesToSource(
      { ...src, url: "https://public.invalid/renewed", streamRef: { ...src.streamRef, size: 43 } },
      context,
    ),
    false,
  );
  assert.doesNotMatch(values.get(storageKey)!, /synthetic-generic-credential|synthetic-user/);
  assert.equal(
    history.recordActualPlayback({
      ...playback,
      sourceFingerprint: undefined,
      src: { ...playback.src, streamRef: undefined },
    }),
    false,
    "empty transport without recoverable identity is invalid",
  );
});

test("unclassified direct sources retain fingerprints while local sources and subtitle choices remain durable", () => {
  for (const url of ["https://public.invalid/movie.mp4?quality=1080", "C:/synthetic/movie.mp4"]) {
    configure();
    const src: PlayerSrc = {
      meta: { id: "local:synthetic", type: "movie", name: "Synthetic" },
      title: "Synthetic",
      url,
    };
    const playback = actualPlaybackSnapshot(src, snapshot, 20, { id: "session", actor })!;
    assert.equal(history.recordActualPlayback({ ...playback, subtitle: { off: true } }), true);
    assert.equal(history.readLastActualPlayback()?.src.url, url.startsWith("https:") ? "" : url);
    assert.equal(history.readActualPlaybackFor(src)?.id, "session");
    assert.deepEqual(history.readLastActualPlayback()?.subtitle, { off: true });
    for (const source of ["C:/synthetic/sub.srt", "https://public.invalid/sub.vtt?lang=en"]) {
      assert.equal(
        history.recordActualPlayback({
          ...playback,
          subtitle: { external: true, source, fpsOverride: 25 },
        }),
        true,
      );
      assert.equal(
        history.readLastActualPlayback()?.subtitle?.source,
        source.startsWith("https:") ? undefined : source,
      );
      if (source.startsWith("https:"))
        assert.ok(history.readLastActualPlayback()?.subtitle?.sourceFingerprint);
    }
  }
});

test("history write boundary sanitizes raw snapshots and a failed security rewrite still returns safe data", () => {
  configure();
  const src = serverSource("write", "token");
  const raw = {
    id: "raw",
    actor,
    playedAt: Date.now(),
    positionMs: 30000,
    durationMs: 400000,
    completed: false,
    src,
    subtitle: { external: true, source: src.subtitles![0].url },
  };
  assert.equal(history.recordActualPlayback(raw), true);
  assert.doesNotMatch(
    values.get(storageKey)!,
    /credential|temporary-|playbackSessionId|Authorization/,
  );
  values.set(
    storageKey,
    JSON.stringify({ "tt-synthetic|s2e3": { savedAt: raw.playedAt, actual: raw } }),
  );
  failWrite = true;
  try {
    const safe = history.readLastActualPlayback();
    assert.equal(safe?.id, "raw");
    assert.doesNotMatch(
      JSON.stringify(safe),
      /credential|temporary-|playbackSessionId|Authorization/,
    );
    assert.equal(history.recordActualPlayback({ ...raw, id: "failed" }), false);
  } finally {
    failWrite = false;
  }
  assert.equal(history.readLastActualPlayback()?.id, "raw");
  assert.doesNotMatch(
    values.get(storageKey)!,
    /credential|temporary-|playbackSessionId|Authorization/,
  );
});

test("expired actual records cannot leave old credentials behind when history is read", () => {
  configure();
  const expired = {
    id: "expired",
    actor,
    playedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
    positionMs: 30000,
    durationMs: 400000,
    completed: false,
    src: serverSource("expired", "api_key"),
  };
  values.set(
    storageKey,
    JSON.stringify({ "tt-synthetic|s2e3": { savedAt: expired.playedAt, actual: expired } }),
  );
  assert.equal(history.readLastActualPlayback(), null);
  assert.doesNotMatch(
    values.get(storageKey)!,
    /credential|temporary-|playbackSessionId|Authorization/,
  );
});

test("generic credential query spellings cannot survive in artwork, episode fields, or subtitle choices", () => {
  for (const query of [
    "Api_Key",
    "access_token",
    "auth",
    "X-Plex-Token",
    "X-Amz-Credential",
    "signature",
  ]) {
    configure();
    const secret = `https://synthetic.invalid/resource?${query}=synthetic-query-credential`;
    const src: PlayerSrc = {
      meta: {
        id: "tt-public",
        type: "movie",
        name: "Public",
        poster: secret,
        providerBadge: { name: "Public", logo: secret, tint: "blue" },
      },
      title: "Public",
      url: "https://public.invalid/movie.mp4",
      episode: { season: 1, episode: 2, still: secret },
    };
    const playback = actualPlaybackSnapshot(
      src,
      {
        ...snapshot,
        subtitleTracks: [
          {
            id: "1",
            kind: "subtitle",
            label: "English",
            selected: true,
            external: true,
            originalUrl: secret,
          },
        ],
      },
      20,
      { id: "public", actor },
    )!;
    assert.equal(history.recordActualPlayback(playback), true);
    assert.doesNotMatch(values.get(storageKey)!, /synthetic-query-credential/);
    assert.equal(history.readLastActualPlayback()?.subtitle?.source, undefined);
    assert.equal(history.readLastActualPlayback()?.src.url, "");
    assert.equal(history.readLastActualPlayback()?.requiresSourceRefresh, true);
  }
});

test("known credentialed source preference URLs are scrubbed on both saves and existing history reads", () => {
  configure();
  history.savePlayback("tt-secret", {
    addonId: "synthetic-addon",
    url: "https://synthetic.invalid/video?api_key=synthetic-preference-credential",
    title: "Keep source identity",
  });
  assert.doesNotMatch(values.get(storageKey)!, /synthetic-preference-credential/);
  assert.equal(history.readPlayback("tt-secret")?.addonId, "synthetic-addon");
  values.set(
    storageKey,
    JSON.stringify({
      "tt-secret": {
        addonId: "synthetic-addon",
        url: "https://synthetic-user:synthetic-legacy-preference-credential@synthetic.invalid/video",
        savedAt: Date.now(),
      },
      "tt-public": { url: "https://public.invalid/video", savedAt: Date.now() },
    }),
  );
  assert.equal(history.readPlayback("tt-secret")?.url, undefined);
  assert.doesNotMatch(
    values.get(storageKey)!,
    /synthetic-legacy-preference-credential|synthetic-user/,
  );
  assert.equal(history.readPlayback("tt-public")?.url, undefined);
  assert.ok(history.readPlayback("tt-public")?.urlFingerprint);
});

test("a normal URL requiring runtime headers is refreshed instead of replayed without authentication", () => {
  configure();
  const src: PlayerSrc = {
    meta: { id: "tt-header", type: "movie", name: "Header source" },
    title: "Header source",
    url: "https://synthetic.invalid/video",
    headers: { Authorization: "synthetic-header-credential" },
    streamRef: { addonId: "synthetic-addon", parsedTitle: "Synthetic.2026", size: 42 },
  };
  const playback = actualPlaybackSnapshot(src, snapshot, 20, { id: "headers", actor })!;
  assert.equal(playback.requiresSourceRefresh, true);
  assert.equal(history.recordActualPlayback(playback), true);
  assert.equal(history.readLastActualPlayback()?.requiresSourceRefresh, true);
  assert.doesNotMatch(values.get(storageKey)!, /synthetic-header-credential|Authorization/);
  assert.equal(
    history.recordActualPlayback({ ...playback, requiresSourceRefresh: false, src }),
    true,
    "write boundary must also recognize raw headers",
  );
  assert.equal(history.readLastActualPlayback()?.requiresSourceRefresh, true);
});

test("an opaque signed source remains the latest session without retaining its credentialed URL", () => {
  configure();
  const src: PlayerSrc = {
    meta: { id: "tt-opaque", type: "movie", name: "Opaque source" },
    title: "Opaque source",
    url: "https://synthetic.invalid/video?token=synthetic-opaque-credential",
  };
  const at = Date.now();
  const previous = actualPlaybackSnapshot(
    { ...src, meta: { ...src.meta, id: "tt-older" }, url: "https://public.invalid/older" },
    snapshot,
    10,
    { id: "older", actor },
    at - 1000,
  )!;
  assert.equal(history.recordActualPlayback(previous), true);
  const playback = actualPlaybackSnapshot(src, snapshot, 45, { id: "opaque", actor }, at)!;
  assert.equal(history.recordActualPlayback(playback), true);
  const saved = history.readLastActualPlayback()!;
  assert.equal(saved.id, "opaque");
  assert.equal(saved.src.url, "");
  assert.equal(saved.requiresSourceRefresh, true);
  assert.equal(saved.positionMs, 45000);
  assert.equal(history.readActualPlaybackFor(src)?.id, "opaque");
  const context = continuationFor(saved, actor);
  assert.equal(continuationAppliesToSource(src, context), true);
  assert.equal(
    continuationAppliesToSource({ ...src, url: src.url + "-different" }, context),
    false,
  );
  assert.doesNotMatch(values.get(storageKey)!, /synthetic-opaque-credential|https:\/\/synthetic/);
  assert.equal(history.readLastActualPlayback()?.id, "opaque", "sanitized rereads keep identity");
});

test("empty source keys never establish that an unknown source matches a continuation", () => {
  const src: PlayerSrc = {
    meta: { id: "tt-empty", type: "movie", name: "Empty" },
    title: "Empty",
    url: "",
  };
  assert.equal(
    continuationAppliesToSource(src, {
      id: "empty",
      actor,
      positionMs: 45000,
      sourceKey: "",
      source: { savedAt: Date.now() },
      target: { metaId: src.meta.id },
    }),
    false,
  );
});

test("a redacted source returns to its live session or opens the picker with its saved choices", async () => {
  configure();
  const src: PlayerSrc = {
    meta: { id: "tt-return", type: "movie", name: "Return" },
    title: "Return",
    url: "https://synthetic.invalid/video?token=synthetic-return-credential",
  };
  assert.equal(
    history.recordActualPlayback(
      actualPlaybackSnapshot(src, snapshot, 45, { id: "return", actor })!,
    ),
    true,
  );
  const target = history.readLastActualPlayback()!;
  let returned = 0;
  let picked = 0;
  const services: ContinuationServices = {
    isCurrent: history.isPlaybackActorCurrent,
    latest: history.readLastActualPlayback,
    active: () => ({
      src,
      resume: async () => {
        returned++;
      },
    }),
    localFileExists: async () => {
      throw new Error("not a local source");
    },
    prepareServer: async () => {
      throw new Error("not a server source");
    },
    openPlayer: () => {
      throw new Error("redacted URL must not reopen");
    },
    openPicker: (_meta, _episode, options) => {
      picked++;
      assert.equal(options.autoPlay, false);
      assert.equal(options.continuation.positionMs, 45000);
      assert.deepEqual(options.continuation.audioTrack, target.audioTrack);
      assert.deepEqual(options.continuation.subtitle, { off: true });
      assert.equal(options.continuation.subDelaySec, 1.25);
      assert.equal(options.continuation.audioDelaySec, -0.2);
      assert.doesNotMatch(JSON.stringify(options), /synthetic-return-credential/);
    },
  };
  assert.equal(await continueActualPlayback(target, {}, services), "returned");
  assert.equal(returned, 1);
  assert.equal(
    await continueActualPlayback(target, {}, { ...services, active: () => null }),
    "picker-opened",
  );
  assert.equal(picked, 1);
});
