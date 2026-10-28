import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function ratingsActionHarness() {
  const local = new Map<string, any>();
  const jobs: Array<ReturnType<typeof deferred>> = [];
  const source = readFileSync(new URL("../src/lib/ratings/actions.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const deps: Record<string, unknown> = {
    "./store": {
      getRating: (key: string) => local.get(key) ?? null,
      setRatingLocal: (rating: any) => local.set(rating.itemKey, rating),
      removeRatingLocal: (key: string) => local.delete(key),
    },
    "@/lib/social/ratings-api": {
      upsertRating: () => {
        const job = deferred();
        jobs.push(job);
        return job.promise;
      },
      deleteRatingRemote: async () => {},
    },
  };
  const exports: any = {};
  new Function("require", "exports", output.outputText)((name: string) => {
    assert.ok(name in deps, "Unexpected dependency: " + name);
    return deps[name];
  }, exports);
  const target = { itemKey: "tt12345", mediaType: "movie" as const, title: "Movie" };
  return {
    local,
    jobs,
    target,
    rate: exports.rate as typeof import("../src/lib/ratings/actions.ts").rate,
  };
}

test("a stale rejected rating write cannot revert the newer shared-cache rating", async () => {
  const h = ratingsActionHarness();
  const older = h.rate(h.target, 3, { review: "first" });
  const newer = h.rate(h.target, 8, { review: "second" });
  assert.equal(h.local.get(h.target.itemKey)?.score, 8);
  h.jobs[1].resolve({ ...h.target, score: 8, review: "second", updatedAt: 2 });
  await newer;
  h.jobs[0].reject(Object.assign(new Error("old request refused"), { status: 403 }));
  await assert.rejects(older);
  assert.equal(h.local.get(h.target.itemKey)?.score, 8);
  assert.equal(h.local.get(h.target.itemKey)?.review, "second");
});

test("a stale successful rating write cannot overwrite a newer shared-cache rating", async () => {
  const h = ratingsActionHarness();
  const older = h.rate(h.target, 3, { review: "first" });
  const newer = h.rate(h.target, 8, { review: "second" });
  h.jobs[1].resolve({ ...h.target, score: 8, review: "second", updatedAt: 2 });
  await newer;
  h.jobs[0].resolve({ ...h.target, score: 3, review: "first", updatedAt: 1 });
  await older;
  assert.equal(h.local.get(h.target.itemKey)?.score, 8);
  assert.equal(h.local.get(h.target.itemKey)?.review, "second");
});
