import test from "node:test";
import assert from "node:assert/strict";
import { seasonIndex } from "../src/lib/season-index";

const episode = (season: number, episode: number) =>
  ({ season, episode, airDate: "2020-01-01" }) as any;

test("indexes max episode per season and the overall order key", () => {
  const index = seasonIndex([
    episode(1, 1),
    episode(1, 3),
    episode(1, 2),
    episode(2, 4),
    episode(2, 1),
  ]);
  assert.equal(index.maxEpisode.get(1), 3);
  assert.equal(index.maxEpisode.get(2), 4);
  assert.equal(index.maxOrderKey, 200004);
});

test("keeps season 0 and handles empty lists", () => {
  const empty = seasonIndex([]);
  assert.equal(empty.maxEpisode.size, 0);
  assert.equal(empty.maxOrderKey, 0);

  const zero = seasonIndex([episode(0, 2), episode(0, 5)]);
  assert.equal(zero.maxEpisode.get(0), 5);
  assert.equal(zero.maxOrderKey, 5);
});

test("caches by list identity and does not share results across equal arrays", () => {
  const list = [episode(1, 1), episode(1, 2)];
  assert.equal(seasonIndex(list), seasonIndex(list));

  const equal = [episode(1, 1), episode(1, 2)];
  assert.notEqual(seasonIndex(equal), seasonIndex(list));
  assert.equal(seasonIndex(equal).maxEpisode.get(1), 2);
});
