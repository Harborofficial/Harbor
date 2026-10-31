import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { keenableSearch } from "../src/lib/keenable-search.ts";
import { liveWebContext } from "../src/lib/live-web.ts";

type Call = { url: string; init: RequestInit };

function mockFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("keyless search posts to the public endpoint and maps snippets", async (t) => {
  const long = "word ".repeat(400);
  const { calls, restore } = mockFetch(() =>
    json({
      results: [
        {
          title: " Dune: Part Two ",
          url: "https://example.com/dune",
          snippet: "Line one\n\n  line two",
          description: "",
        },
        { title: "", url: "https://example.com/untitled", snippet: long },
        { title: "Not a page", url: "ftp://example.com/file", snippet: "skip" },
      ],
    }),
  );
  t.after(restore);

  const hits = await keenableSearch("  dune part two reviews  ");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.keenable.ai/v1/search/public?keenable_title=Harbor");
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["X-API-Key"], undefined);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    query: "dune part two reviews",
    max_results: 8,
  });
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], {
    title: "Dune: Part Two",
    url: "https://example.com/dune",
    snippet: "Line one line two",
  });
  assert.equal(hits[1].title, "https://example.com/untitled");
  assert.equal(hits[1].snippet.length, 800);
});

test("a saved key switches to the keyed endpoint", async (t) => {
  const { calls, restore } = mockFetch(() => json({ results: [] }));
  t.after(restore);

  assert.deepEqual(await keenableSearch("query", "  key-123  "), []);
  assert.equal(calls[0].url, "https://api.keenable.ai/v1/search?keenable_title=Harbor");
  assert.equal((calls[0].init.headers as Record<string, string>)["X-API-Key"], "key-123");
});

test("blank queries skip the request and HTTP errors surface", async (t) => {
  const { calls, restore } = mockFetch(() => new Response("Too many requests", { status: 429 }));
  t.after(restore);

  assert.deepEqual(await keenableSearch("   "), []);
  assert.equal(calls.length, 0);
  await assert.rejects(keenableSearch("query"), /Keenable error \(429\)\. Too many requests/);
});

test("live web context follows the selected source", async (t) => {
  const { calls, restore } = mockFetch(({ url }) =>
    url.startsWith("https://api.keenable.ai/")
      ? json({ results: [{ title: "Result", url: "https://example.com/a", snippet: "Text" }] })
      : new Response("", { status: 200 }),
  );
  t.after(restore);

  const keenable = await liveWebContext("query", {
    aiWebSource: "keenable",
    jinaKey: "",
    keenableKey: "",
  });
  assert.equal(keenable.context, "[1] Result — https://example.com/a\nText");

  await liveWebContext("query", { aiWebSource: "jina", jinaKey: "", keenableKey: "" });
  assert.ok(calls.at(-1)!.url.startsWith("https://r.jina.ai/https://html.duckduckgo.com/html/"));
});

test("Jina stays the default source; Keenable is used only after it is picked", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const defaults = read("src/lib/settings/defaults.ts");
  assert.match(defaults, /aiWebSearch: false,/);
  assert.match(defaults, /aiWebSource: "jina",/);
  assert.match(defaults, /keenableKey: "",/);
  assert.match(read("src/lib/live-web.ts"), /settings\.aiWebSource === "keenable"/);
});
