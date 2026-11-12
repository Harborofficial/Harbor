import assert from "node:assert/strict";
import test from "node:test";
import { playerTitleLines } from "../src/components/player/transport/title-lines.ts";

test("a show logo replaces the show name and keeps the episode below", () => {
  assert.deepEqual(
    playerTitleLines({
      title: "Acceptance",
      subtitle: "Dr. House · S1 · E11",
      showName: "Dr. House",
      isSeries: true,
      hasLogo: true,
      seriesFirst: true,
    }),
    { title: "Dr. House", subtitle: "Acceptance · S1 · E11", seriesFirst: false },
  );
});

test("a movie logo keeps the year below it and drops a repeated title", () => {
  assert.deepEqual(
    playerTitleLines({
      title: "Heart of the Beast",
      subtitle: "2024",
      showName: "Heart of the Beast",
      isSeries: false,
      hasLogo: true,
      seriesFirst: true,
    }),
    { title: "Heart of the Beast", subtitle: "2024", seriesFirst: false },
  );
  assert.deepEqual(
    playerTitleLines({
      title: "Heart of the Beast",
      subtitle: "Heart of the Beast",
      showName: "Heart of the Beast",
      isSeries: false,
      hasLogo: true,
      seriesFirst: false,
    }),
    { title: "Heart of the Beast", subtitle: undefined, seriesFirst: false },
  );
});

test("series name first never applies to movies, with or without a logo", () => {
  const movie = {
    title: "Heart of the Beast",
    subtitle: "2024",
    showName: "Heart of the Beast",
    isSeries: false,
    seriesFirst: true,
  };
  assert.deepEqual(playerTitleLines({ ...movie, hasLogo: false }), {
    title: "Heart of the Beast",
    subtitle: "2024",
    seriesFirst: false,
  });
  assert.deepEqual(playerTitleLines({ ...movie, hasLogo: true }), {
    title: "Heart of the Beast",
    subtitle: "2024",
    seriesFirst: false,
  });
});

test("series name first still applies to series without a logo", () => {
  assert.deepEqual(
    playerTitleLines({
      title: "Acceptance",
      subtitle: "Dr. House · S1 · E11",
      showName: "Dr. House",
      isSeries: true,
      hasLogo: false,
      seriesFirst: true,
    }),
    { title: "Acceptance", subtitle: "Dr. House · S1 · E11", seriesFirst: true },
  );
});

test("a local series without an episode title keeps its own line", () => {
  assert.deepEqual(
    playerTitleLines({
      title: "Dr. House",
      subtitle: "Local · S1E2",
      showName: "Dr. House",
      isSeries: true,
      hasLogo: true,
      seriesFirst: false,
    }),
    { title: "Dr. House", subtitle: "Local · S1E2", seriesFirst: false },
  );
});
