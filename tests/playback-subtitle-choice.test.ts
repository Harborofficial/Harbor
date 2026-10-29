import assert from "node:assert/strict";
import test from "node:test";
import { playbackSubtitleChoice, selectPlaybackSubtitle } from "../src/lib/player/subtitle-choice";
import type { TrackInfo } from "../src/lib/player/bridge";

const track = (id: string, title: string): TrackInfo => ({
  id,
  title,
  label: title,
  lang: "ara",
  codec: "ass",
  kind: "subtitle",
  selected: true,
});

test("embedded subtitle identity wins over a stale numeric id after track ordering changes", () => {
  const selected = playbackSubtitleChoice(track("1", "Full dialogue"));
  assert.equal(
    selectPlaybackSubtitle([track("1", "Signs only"), track("7", "Full dialogue")], selected)?.id,
    "7",
  );
  assert.equal(selectPlaybackSubtitle([track("7", "Unrelated")], selected), null);
});

test("ephemeral subtitle URLs are not persisted as durable identities", () => {
  assert.equal(
    playbackSubtitleChoice({ ...track("1", "Arabic"), external: true, url: "blob:temp" }).source,
    undefined,
  );
  assert.equal(
    playbackSubtitleChoice({
      ...track("1", "Arabic"),
      external: true,
      url: "blob:temp",
      originalUrl: "C:/fixture/arabic.srt",
    }).source,
    "C:/fixture/arabic.srt",
  );
  assert.equal(
    playbackSubtitleChoice(
      {
        ...track("1", "Arabic"),
        external: true,
        url: "blob:temp",
        subId: "id",
        provider: "Provider",
      },
      { source: "blob:old", subId: "id", provider: "Provider", updatedAt: 1 },
    ).source,
    undefined,
  );
});

test("durable local subtitle identity accepts platform path separators without accepting another language", () => {
  const local = { ...track("1", "Arabic"), external: true, originalUrl: "C:/fixture/arabic.srt" };
  assert.equal(
    selectPlaybackSubtitle([local], { external: true, source: "C:\\fixture\\arabic.srt" })?.id,
    "1",
  );
  const choice = { external: true, subId: "provider:1", provider: "Provider", lang: "ara" };
  assert.equal(
    selectPlaybackSubtitle(
      [{ ...local, subId: "provider:1", provider: "Provider", lang: "eng" }],
      choice,
    ),
    null,
  );
});

test("indistinguishable embedded subtitle tracks are not guessed using an old numeric id", () => {
  const choice = playbackSubtitleChoice(track("1", "Full dialogue"));
  assert.equal(
    selectPlaybackSubtitle([track("1", "Full dialogue"), track("2", "Full dialogue")], choice),
    null,
  );
});
