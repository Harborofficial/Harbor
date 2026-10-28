import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(file, dependencies) {
  const compiled = ts.transpileModule(
    readFileSync(new URL(`../src/lib/manga/sources/suwayomi/${file}.ts`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (id) => {
      assert.ok(id in dependencies, `Unexpected dependency ${id}`);
      return dependencies[id];
    },
    module,
    module.exports,
  );
  return module.exports;
}

const model = { isDigits: (id) => /^\d+$/.test(id), toDateIso: () => undefined };
const { gqlChapters } = load("graphql", { "./model": model, "./server-message": {} });
const { restChapters } = load("rest", { "./model": model });

test("GraphQL refresh discovers chapters even when the server already has chapters", async () => {
  const calls = [];
  const client = {
    postJson: async (_path, { query }) => {
      calls.push(query);
      return query.includes("mutation")
        ? { data: { fetchChapters: { chapters: [{ id: 1 }, { id: 2 }] } } }
        : { data: { chapters: { nodes: [{ id: 1 }] } } };
    },
  };
  assert.equal((await gqlChapters(client, "42")).length, 1);
  assert.equal(calls.length, 1);
  assert.equal((await gqlChapters(client, "42", true)).length, 2);
  assert.match(calls[2], /fetchChapters/);
});

test("GraphQL refresh keeps stored chapters when the source is unavailable", async () => {
  for (const throws of [true, false]) {
    const client = {
      postJson: async (_path, { query }) => {
        if (!query.includes("mutation")) return { data: { chapters: { nodes: [{ id: 1 }] } } };
        if (throws) throw new Error("Source offline");
        return { errors: [{ message: "Source offline" }] };
      },
    };
    assert.equal((await gqlChapters(client, "42", true)).length, 1);
  }
});

test("REST refresh requests onlineFetch and falls back to stored chapters on failure", async () => {
  for (const failure of [false, true]) {
    const calls = [];
    const client = {
      getJson: async (path) => {
        calls.push(path);
        if (path.includes("?")) {
          if (failure) throw new Error("Source offline");
          return [{ index: 0 }, { index: 1 }];
        }
        return [{ index: 0 }];
      },
    };
    assert.equal((await restChapters(client, "42", true)).length, failure ? 1 : 2);
    assert.equal(calls[0], "/api/v1/manga/42/chapters?onlineFetch=true");
    assert.equal(calls.length, failure ? 2 : 1);
  }
});
