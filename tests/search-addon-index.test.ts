import assert from "node:assert/strict";
import test from "node:test";
import { searchAddonIndex } from "../src/lib/search-addon-index.ts";

test("global addon search respects the adult-content setting for installed addons", () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });

  try {
    values.set(
      "harbor.installed-addons",
      JSON.stringify([
        {
          id: "fixture.flagged",
          transportUrl: "https://flagged.example/manifest.json",
          installedAt: 1,
          manifest: {
            id: "fixture.flagged",
            name: "Fixture Flagged",
            behaviorHints: { adult: true },
          },
        },
        {
          id: "fixture.xxx",
          transportUrl: "https://named.example/manifest.json",
          installedAt: 2,
          manifest: { id: "fixture.xxx", name: "Fixture XXX" },
        },
        {
          id: "fixture.normal",
          transportUrl: "https://normal.example/manifest.json",
          installedAt: 3,
          manifest: { id: "fixture.normal", name: "Fixture Normal" },
        },
      ]),
    );

    assert.deepEqual(
      searchAddonIndex("fixture").map((hit) => hit.id),
      ["fixture.normal"],
    );

    values.set("harbor.settings", JSON.stringify({ hideContent: { adult: false } }));
    assert.deepEqual(
      searchAddonIndex("fixture").map((hit) => hit.id),
      ["fixture.flagged", "fixture.xxx", "fixture.normal"],
    );
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
