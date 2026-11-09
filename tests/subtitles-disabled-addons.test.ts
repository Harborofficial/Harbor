import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/lib/subtitles/addon-source.ts", import.meta.url),
  "utf8",
);

type Addon = { transportUrl: string };
type Api = { gatherSubtitleAddons(authKey: string | null): Promise<Addon[]> };

function load() {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const disabled = new Set([
    "https://disabled.test/manifest.json",
    "https://local-disabled.test/manifest.json",
  ]);
  const fetched: string[] = [];
  const manifest = (name: string) => ({ id: name, name, resources: ["subtitles"] });
  const cloud = [
    { transportUrl: "https://cloud.test/manifest.json", manifest: manifest("Cloud") },
    { transportUrl: "https://disabled.test/manifest.json", manifest: manifest("Disabled") },
  ];
  const local = [
    { id: "local", transportUrl: "https://local.test/manifest.json", manifest: null },
    {
      id: "disabled-local",
      transportUrl: "https://local-disabled.test/manifest.json",
      manifest: null,
    },
  ];
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (name: string) => {
      if (name === "@/lib/addons") return { userAddons: async () => cloud };
      if (name === "@/lib/nuvio/nuvio-client")
        return { isNuvioProviderActive: () => false, isNuvioSignedIn: () => false };
      if (name === "@/lib/nuvio/nuvio-sync") return { fetchNuvioAddons: async () => [] };
      if (name === "@/lib/addon-store")
        return {
          fetchManifestAt: async (url: string) => {
            fetched.push(url);
            return manifest("Local");
          },
          filterEnabled: (items: Addon[]) => items.filter((a) => !disabled.has(a.transportUrl)),
          loadDisabledAddons: () => disabled,
          loadInstalled: () => local,
        };
      if (name === "@/lib/debug") return { dlog: () => {} };
      if (name === "./autoload")
        return {
          SUBTITLE_PROVIDER_TIMEOUT_MS: 1_000,
          withSubtitleTimeout: (promise: Promise<unknown>) => promise,
        };
      throw new Error(`unexpected import ${name}`);
    },
    module,
    module.exports,
  );
  return { api: module.exports as Api, disabled, fetched };
}

test("disabled addons are excluded from subtitle gathering", async () => {
  const { api, fetched } = load();
  const result = await api.gatherSubtitleAddons("auth");
  assert.deepEqual(result.map((addon) => addon.transportUrl).sort(), [
    "https://cloud.test/manifest.json",
    "https://local.test/manifest.json",
  ]);
  assert.deepEqual(fetched, ["https://local.test/manifest.json"]);
});

test("disabling an addon invalidates the subtitle addon cache", async () => {
  const { api, disabled } = load();
  const first = await api.gatherSubtitleAddons("auth");
  assert.ok(first.some((addon) => addon.transportUrl === "https://cloud.test/manifest.json"));

  disabled.add("https://cloud.test/manifest.json");
  const second = await api.gatherSubtitleAddons("auth");
  assert.deepEqual(
    second.map((addon) => addon.transportUrl),
    ["https://local.test/manifest.json"],
  );
});
