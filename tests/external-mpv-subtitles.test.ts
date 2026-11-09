import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as snapshots from "../src/lib/player/bridge.ts";
import * as cleanups from "../src/lib/player/prepared-subtitle-cleanups.ts";
import * as registry from "../src/lib/subtitles/prepared-registry.ts";
import * as providerUrl from "../src/lib/subtitles/provider-url.ts";
import * as subtitleMemory from "../src/lib/subtitles/subtitle-memory.ts";
import type { PlayerBridge } from "../src/lib/player/bridge.ts";
import type { PreparedSubtitle } from "../src/lib/subtitles/prepare.ts";

type ExternalMpvModule = {
  createExternalMpvBridge: (opts: { binary: string; args: string; title: string }) => PlayerBridge;
  mpvSubtitleTitle: (name?: string, provider?: string) => string | undefined;
  externalMpvEnabled: (settings: { playerExternalMpv: boolean }) => boolean;
};

function harness(desktop = true) {
  const source = readFileSync(
    new URL("../src/lib/player/external-mpv.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const commands: unknown[][] = [];
  let nextSession = 1;
  const dependencies: Record<string, unknown> = {
    "@tauri-apps/api/core": {
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        if (command === "external_player_start") return nextSession++;
        if (command === "external_player_command") commands.push(args.cmd as unknown[]);
      },
    },
    "@tauri-apps/api/event": {
      listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
        handlers.set(name, handler);
        return () => handlers.delete(name);
      },
    },
    "@tauri-apps/plugin-dialog": { message: async () => {} },
    "@/lib/i18n": { t: (text: string) => text },
    "@/lib/platform": {
      isWindowsDesktop: () => desktop,
      isMacDesktop: () => false,
      isLinuxDesktop: () => false,
    },
    "@/lib/subtitles/prepared-registry": registry,
    "@/lib/subtitles/provider-url": providerUrl,
    "@/lib/subtitles/subtitle-memory": subtitleMemory,
    "@/lib/tauri-unlisten": { makeSafeTauriUnlisten: (fn: unknown) => fn },
    "./bridge": { ...snapshots, initialPlayerSnapshot: () => ({ ...snapshots.emptySnapshot }) },
    "./prepared-subtitle-cleanups": cleanups,
  };
  const module = { exports: {} as ExternalMpvModule };
  new Function("require", "module", "exports", "window", compiled)(
    (id: string) => {
      if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
      return dependencies[id];
    },
    module,
    module.exports,
    { dispatchEvent: () => true, setTimeout: () => 0 },
  );
  return {
    module: module.exports,
    bridge: module.exports.createExternalMpvBridge({ binary: "", args: "", title: "" }),
    subAdds: () => commands.filter((cmd) => cmd[0] === "sub-add"),
    firstFrame(session: number) {
      handlers.get("external-player://state")?.({
        payload: {
          session,
          positionSec: 0,
          durationSec: 1400,
          paused: false,
          buffering: false,
          loaded: true,
          eof: false,
          width: 1920,
          height: 1080,
          error: null,
          launchError: null,
        },
      });
    },
  };
}

/** Pretends Harbor saved a subtitle file, the way fetch-into-player does before addSubtitle. */
function preparedFile(path: string, text = `1\n00:00:01,000 --> 00:00:02,000\n${path}\n`) {
  let deleted = 0;
  registry.registerPreparedSubtitle({
    playableUrl: path,
    text,
    cleanup: () => {
      deleted += 1;
    },
  } as PreparedSubtitle);
  return { path, deleted: () => deleted };
}

test("prepared subtitles reach mpv at the first frame with the provider in the title", async () => {
  const h = harness();
  await h.bridge.load({ url: "https://fixture.test/show.mkv" });
  const file = preparedFile("C:\\Temp\\harbor-subs\\prepared\\a\\subtitle.srt");
  const ok = await h.bridge.addSubtitle(file.path, "eng", "The.Show.S01E01.1080p.WEB", true, {
    provider: "SubMaker",
    prepared: true,
  });
  assert.equal(ok, true);
  assert.deepEqual(h.subAdds(), []);

  h.firstFrame(1);
  assert.deepEqual(h.subAdds(), [
    ["sub-add", file.path, "auto", "[SubMaker] The Show S01E01 1080p WEB", "eng"],
  ]);
  assert.equal(file.deleted(), 0);
});

test("prepared files are deleted when the next episode starts or the player closes", async () => {
  const h = harness();
  await h.bridge.load({ url: "https://fixture.test/episode-1.mkv" });
  const first = preparedFile("C:\\Temp\\harbor-subs\\prepared\\e1\\subtitle.srt");
  await h.bridge.addSubtitle(first.path, "eng", "Episode 1", false, { provider: "OpenSubtitles" });
  assert.equal(first.deleted(), 0);

  await h.bridge.load({ url: "https://fixture.test/episode-2.mkv" });
  assert.equal(first.deleted(), 1);
  const second = preparedFile("C:\\Temp\\harbor-subs\\prepared\\e2\\subtitle.srt");
  await h.bridge.addSubtitle(second.path, "eng", "Episode 2", false, { provider: "OpenSubtitles" });

  h.bridge.destroy();
  assert.equal(second.deleted(), 1);
  assert.equal(first.deleted(), 1);
});

test("mpv only gets subtitles it can open, and provider links must be public", async () => {
  const h = harness();
  await h.bridge.load({ url: "https://fixture.test/show.mkv" });
  assert.equal(await h.bridge.addSubtitle("blob:harbor/1", "eng", "Blob"), false);
  assert.equal(
    await h.bridge.addSubtitle("http://192.168.1.20/sub.srt", "eng", "LAN", false, {
      provider: "Some addon",
    }),
    false,
  );
  assert.equal(
    await h.bridge.addSubtitle("https://subs.fixture.test/1.srt", "eng", "Show.S01E01", false, {
      provider: "OpenSubtitles",
    }),
    true,
  );
  // A file the viewer dropped on Harbor keeps its own name, and Harbor never deletes it.
  assert.equal(
    await h.bridge.addSubtitle("D:\\Subs\\My.Movie.srt", undefined, "My.Movie", true),
    true,
  );

  h.firstFrame(1);
  assert.deepEqual(h.subAdds(), [
    ["sub-add", "https://subs.fixture.test/1.srt", "auto", "[OpenSubtitles] Show S01E01", "eng"],
    ["sub-add", "D:\\Subs\\My.Movie.srt", "auto", "My.Movie", ""],
  ]);
});

test("a stream's own subtitles need a public link unless its addon runs locally", async () => {
  const h = harness();
  await h.bridge.load({
    url: "https://fixture.test/show.mkv",
    subtitles: [
      { url: "https://subs.fixture.test/public.srt", lang: "eng" },
      { url: "http://192.168.1.20/from-public-addon.srt", lang: "eng" },
      { url: "http://192.168.1.20/from-local-addon.srt", lang: "spa", trustedSource: true },
      { url: "C:\\Videos\\Show.srt", lang: "eng", trustedSource: true },
    ],
  });
  h.firstFrame(1);
  assert.deepEqual(h.subAdds(), [
    ["sub-add", "https://subs.fixture.test/public.srt", "auto", "eng", "eng"],
    ["sub-add", "http://192.168.1.20/from-local-addon.srt", "auto", "spa", "spa"],
  ]);
});

test("a prepared file that arrives after the player closed is deleted right away", async () => {
  const h = harness();
  await h.bridge.load({ url: "https://fixture.test/show.mkv" });
  h.bridge.destroy();
  const late = preparedFile("C:\\Temp\\harbor-subs\\prepared\\late\\subtitle.srt");
  const ok = await h.bridge.addSubtitle(late.path, "eng", "Late", false, { provider: "SubDL" });
  assert.equal(ok, false);
  assert.equal(late.deleted(), 1);
});

test("mpv gets one copy when two sources serve the same subtitle file", async () => {
  const h = harness();
  await h.bridge.load({ url: "https://fixture.test/show.mkv" });
  const text = "1\n00:00:01,000 --> 00:00:02,000\nHola\n";
  const viaSubMaker = preparedFile("C:\\Temp\\harbor-subs\\prepared\\d1\\subtitle.srt", text);
  const viaOpenSubtitles = preparedFile(
    "C:\\Temp\\harbor-subs\\prepared\\d2\\subtitle.srt",
    text.replace(/\n/g, "\r\n"),
  );
  const first = await h.bridge.addSubtitle(viaSubMaker.path, "spa", "Hola", false, {
    provider: "SubMaker",
  });
  const copy = await h.bridge.addSubtitle(
    viaOpenSubtitles.path,
    "spa",
    "OpenSubtitles V3 #1",
    false,
    {
      provider: "OpenSubtitles",
    },
  );
  assert.equal(first, true);
  assert.equal(copy, true);

  h.firstFrame(1);
  assert.deepEqual(
    h.subAdds().map((cmd) => cmd[1]),
    [viaSubMaker.path],
  );
  assert.equal(viaOpenSubtitles.deleted(), 1);
  assert.equal(viaSubMaker.deleted(), 0);
});

test("the same link, or a saved file's original link, is not added twice", async () => {
  const h = harness();
  await h.bridge.load({ url: "https://fixture.test/show.mkv" });
  const file = preparedFile("C:\\Temp\\harbor-subs\\prepared\\o1\\subtitle.srt");
  const source = "https://subs.fixture.test/7835505.srt";
  const other = "https://subs.fixture.test/other.srt";
  await h.bridge.addSubtitle(file.path, "eng", "Show", false, {
    provider: "OpenSubtitles",
    originalUrl: source,
  });
  // A remembered pick brings back the saved file's original link.
  await h.bridge.addSubtitle(source, "eng", "Show", true, { provider: "OpenSubtitles" });
  await h.bridge.addSubtitle(other, "eng", "Other", false, { provider: "OpenSubtitles" });
  await h.bridge.addSubtitle(other, "eng", "Other", false, { provider: "OpenSubtitles" });

  h.firstFrame(1);
  assert.deepEqual(
    h.subAdds().map((cmd) => cmd[1]),
    [file.path, other],
  );
});

test("each video starts with a fresh list, so its subtitles are not taken for copies", async () => {
  const h = harness();
  const link = "https://subs.fixture.test/a.srt";
  await h.bridge.load({ url: "https://fixture.test/episode-1.mkv" });
  await h.bridge.addSubtitle(link, "eng", "A", false, { provider: "OpenSubtitles" });
  await h.bridge.load({ url: "https://fixture.test/episode-2.mkv" });
  await h.bridge.addSubtitle(link, "eng", "A", false, { provider: "OpenSubtitles" });

  h.firstFrame(2);
  assert.deepEqual(
    h.subAdds().map((cmd) => cmd[1]),
    [link],
  );
});

test("videos go to your own mpv only when it is turned on and Harbor runs on desktop", () => {
  assert.equal(harness().module.externalMpvEnabled({ playerExternalMpv: true }), true);
  assert.equal(harness().module.externalMpvEnabled({ playerExternalMpv: false }), false);
  assert.equal(harness(false).module.externalMpvEnabled({ playerExternalMpv: true }), false);
});

test("track titles name the provider once and leave titles without a provider alone", () => {
  const { mpvSubtitleTitle } = harness().module;
  assert.equal(mpvSubtitleTitle("eng", "SubDL · SubMaker"), "[SubDL · SubMaker] eng");
  assert.equal(mpvSubtitleTitle("SubMaker", "SubMaker"), "SubMaker");
  assert.equal(mpvSubtitleTitle(undefined, "OpenSubtitles"), "OpenSubtitles");
  assert.equal(mpvSubtitleTitle("My.Movie.eng", undefined), "My.Movie.eng");
  assert.equal(mpvSubtitleTitle(undefined, undefined), undefined);
});

test("different subtitles with the same name get numbers in mpv's list, per video", async () => {
  const h = harness();
  const add = (id: number) =>
    h.bridge.addSubtitle(
      `https://subs.fixture.test/${id}.srt`,
      "spa",
      "The Show · S01E01 · BluRay",
      false,
      { provider: "OpenSubtitles v3" },
    );
  await h.bridge.load({ url: "https://fixture.test/episode-1.mkv" });
  await add(1);
  await add(2);
  await add(3);
  h.firstFrame(1);
  await h.bridge.load({ url: "https://fixture.test/episode-2.mkv" });
  await add(4);
  h.firstFrame(2);

  const name = "[OpenSubtitles v3] The Show · S01E01 · BluRay";
  assert.deepEqual(
    h.subAdds().map((cmd) => cmd[3]),
    [name, `${name} #2`, `${name} #3`, name],
  );
});

test("a stream that lists the same subtitle twice gives mpv one copy", async () => {
  const h = harness();
  await h.bridge.load({
    url: "https://fixture.test/show.mkv",
    subtitles: [
      { url: "https://subs.fixture.test/a.srt", lang: "eng" },
      { url: "https://subs.fixture.test/a.srt", lang: "eng" },
      { url: "https://subs.fixture.test/b.srt", lang: "spa" },
    ],
  });
  h.firstFrame(1);
  assert.deepEqual(
    h.subAdds().map((cmd) => cmd[1]),
    ["https://subs.fixture.test/a.srt", "https://subs.fixture.test/b.srt"],
  );
});
