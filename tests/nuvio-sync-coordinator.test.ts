import test from "node:test";
import assert from "node:assert/strict";
import { createNuvioSyncCoordinator } from "../src/lib/nuvio/nuvio-sync-coordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("coalesces concurrent triggers into one reconcile/refresh cycle", async () => {
  const gate = deferred<void>();
  const calls: string[] = [];
  const coordinator = createNuvioSyncCoordinator({
    isActive: () => true,
    reconcile: async () => {
      calls.push("reconcile");
      await gate.promise;
    },
    refresh: async () => {
      calls.push("refresh");
      await gate.promise;
    },
  });

  const first = coordinator.request(false);
  const second = coordinator.request(false);
  assert.equal(first, second, "concurrent triggers must share the in-flight cycle");
  await tick();
  assert.deepEqual(calls.sort(), ["reconcile", "refresh"]);

  gate.resolve();
  await first;
  assert.equal(coordinator.isRunning(), false);
});

test("a forced trigger during a normal cycle queues exactly one forced cycle", async () => {
  const gate = deferred<void>();
  const reconcileForces: boolean[] = [];
  const coordinator = createNuvioSyncCoordinator({
    isActive: () => true,
    reconcile: async (force) => {
      reconcileForces.push(force);
      await gate.promise;
    },
    refresh: async () => {},
  });

  const normal = coordinator.request(false);
  await tick();
  const forced = coordinator.request(true);
  assert.equal(forced, normal, "a forced request must join the in-flight cycle");

  gate.resolve();
  await normal;
  await tick();
  await tick();
  assert.deepEqual(reconcileForces, [false, true], "the queued forced cycle must run once");
});

test("inactive providers never start a cycle", async () => {
  let calls = 0;
  const coordinator = createNuvioSyncCoordinator({
    isActive: () => false,
    reconcile: async () => {
      calls++;
    },
    refresh: async () => {
      calls++;
    },
  });

  await coordinator.request(true);
  await coordinator.request(false);
  assert.equal(calls, 0);
  assert.equal(coordinator.isRunning(), false);
});

test("a failed cycle does not wedge the coordinator", async () => {
  let attempts = 0;
  const coordinator = createNuvioSyncCoordinator({
    isActive: () => true,
    reconcile: async () => {
      attempts++;
      throw new Error("offline");
    },
    refresh: async () => {},
  });

  await assert.doesNotReject(coordinator.request(true));
  assert.equal(coordinator.isRunning(), false);
  await assert.doesNotReject(coordinator.request(true));
  assert.equal(attempts, 2, "a later cycle must run after a failure");
});
