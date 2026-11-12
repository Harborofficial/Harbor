import test from "node:test";
import assert from "node:assert/strict";
import { parseNexusGameLink } from "../src/lib/games/nexus-game-data.ts";

const result = (...nodes: object[]) => ({ data: { games: { totalCount: nodes.length, nodes } } });

test("links directly to the matched Nexus Mods game page, not search", () => {
  assert.deepEqual(
    parseNexusGameLink(
      result(
        { name: "Elden Ring Nightreign", domainName: "eldenringnightreign" },
        { name: "Elden Ring", domainName: "eldenring" },
      ),
      "Elden Ring",
    ),
    {
      name: "Nexus Mods",
      url: "https://www.nexusmods.com/games/eldenring/mods",
    },
  );
  assert.equal(
    parseNexusGameLink(
      result({ name: "Skyrim Special Edition", domainName: "skyrimspecialedition" }),
      "Skyrim Special Edition",
    )?.url,
    "https://www.nexusmods.com/games/skyrimspecialedition/mods",
  );
});

test("rejects guesses, ambiguous editions, malformed domains and missing data", () => {
  assert.equal(
    parseNexusGameLink(
      result({ name: "Elden Ring Nightreign", domainName: "eldenringnightreign" }),
      "Elden Ring",
    ),
    null,
  );
  assert.equal(
    parseNexusGameLink(
      result(
        { name: "Skyrim", domainName: "skyrim" },
        { name: "Skyrim", domainName: "skyrimclassic" },
      ),
      "Skyrim",
    ),
    null,
  );
  assert.equal(
    parseNexusGameLink(result({ name: "Elden Ring", domainName: "../external" }), "Elden Ring"),
    null,
  );
  assert.equal(
    parseNexusGameLink(
      result({ name: "Elden Ring", domainName: "https://example.com" }),
      "Elden Ring",
    ),
    null,
  );
  assert.equal(parseNexusGameLink({ errors: [{ message: "error" }] }, "Elden Ring"), null);
});

test("title punctuation and capitalization can differ", () => {
  assert.equal(
    parseNexusGameLink(
      result({ name: "Marvel's Spider-Man Remastered", domainName: "marvelsspidermanremastered" }),
      "MARVELS SPIDER MAN REMASTERED",
    )?.url,
    "https://www.nexusmods.com/games/marvelsspidermanremastered/mods",
  );
});
