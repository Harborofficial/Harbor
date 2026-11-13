// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import ts from "typescript";

function loadModule(
  path: string,
  mocks: Record<string, unknown>,
  globals: Record<string, unknown> = {},
) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const names = Object.keys(globals);
  new Function("require", "module", "exports", ...names, output)(
    (name: string) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    },
    module,
    module.exports,
    ...names.map((name) => globals[name]),
  );
  return module.exports as typeof import("../src/lib/trakt/client") &
    typeof import("../src/lib/trakt/playback");
}

function harness(respond: () => Promise<Response>) {
  let session = {
    accessToken: "token-a",
    refreshToken: "refresh-a",
    createdAt: 0,
    expiresIn: 3600,
    username: "alice",
  } as { username: string | null; [key: string]: unknown };
  let calls = 0;
  const fetchStub = async () => {
    calls++;
    return respond();
  };
  const sessionMock = {
    getSession: () => session,
    setSession: (next: typeof session | null) => {
      session = next as typeof session;
    },
  };
  const config = {
    TRAKT_API_BASE: "https://trakt.test",
    TRAKT_API_VERSION: "2",
    TRAKT_CLIENT_ID: "client-id",
    TRAKT_TOKEN_PROXY: "https://trakt.test/token",
  };
  const client = loadModule(
    "src/lib/trakt/client.ts",
    { "./config": config, "./session": sessionMock },
    { fetch: fetchStub },
  );
  const playback = loadModule("src/lib/trakt/playback.ts", {
    "./client": client,
    "./session": sessionMock,
    "@/lib/cw-dismiss": { isCwDismissed: () => false },
    "@/lib/resume": { readResumeEntry: () => undefined, saveResumeMs: () => {} },
  });
  return {
    playback,
    calls: () => calls,
    setAccount(username: string | null) {
      session = { ...session, username };
    },
  };
}

test("a 429 retry cannot run a DELETE under a different Trakt account", async () => {
  const h = harness(async () => new Response("", { status: 429, headers: { "retry-after": "0" } }));

  const pending = h.playback.deleteTraktPlayback("42");
  // The client waits one second; switch accounts during that delay.
  await new Promise((resolve) => setTimeout(resolve, 100));
  h.setAccount("bob");

  const outcome = await pending;

  assert.deepEqual(outcome, { ok: false });
  assert.equal(h.calls(), 1, "the retry must not use the new account");
});

test("an HTTP-date Retry-After is honored, not treated as an immediate retry", async () => {
  const retryAt = new Date(Date.now() + 1_200).toUTCString();
  const responses = [
    new Response("", { status: 429, headers: { "retry-after": retryAt } }),
    new Response(null, { status: 204 }),
  ];
  const h = harness(async () => {
    const next = responses.shift();
    assert.ok(next, "unexpected extra request");
    return next;
  });

  const started = Date.now();
  const outcome = await h.playback.deleteTraktPlayback("43");

  assert.deepEqual(outcome, { ok: true });
  assert.equal(h.calls(), 2);
  assert.ok(Date.now() - started >= 900, "the date header produced a real delay");
});
