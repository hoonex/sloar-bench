import test from "node:test";
import assert from "node:assert/strict";
import { GraphEngine } from "../src/graph-engine.js";
import { FakeWorker } from "../src/fake-worker.js";
import { FakePublisher } from "../src/fake-publisher.js";

function makeEngine(options = {}) {
  const worker = options.worker ?? new FakeWorker();
  const publisher = options.publisher ?? new FakePublisher();
  const engine = new GraphEngine({
    worker,
    publisher,
    maxWorkers: options.maxWorkers ?? 2
  });
  return { engine, worker, publisher };
}

async function waitFor(predicate, message = "condition") {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function callsFor(worker, nodeId) {
  return worker.calls.filter((call) => call.nodeId === nodeId);
}

test("source changes invalidate every transitive dependent and hide stale get values", async () => {
  const { engine, worker } = makeEngine();
  engine.defineSource("a", 2);
  engine.defineNode("b", ["a"], (a) => a + 1);
  engine.defineNode("c", ["b"], (b) => b * 3);
  engine.defineNode("d", ["c"], (c) => c - 2);

  assert.equal((await engine.build(["d"])).artifacts.d, 7);
  assert.equal(engine.get("b"), 3);
  assert.equal(engine.get("c"), 9);
  assert.equal(engine.get("d"), 7);

  engine.defineSource("a", 4);
  assert.equal(engine.get("b"), undefined);
  assert.equal(engine.get("c"), undefined);
  assert.equal(engine.get("d"), undefined);
  assert.equal((await engine.build(["d"])).artifacts.d, 13);
  assert.equal(callsFor(worker, "b").length, 2);
  assert.equal(callsFor(worker, "c").length, 2);
  assert.equal(callsFor(worker, "d").length, 2);
});

test("node dependency redefinition removes ghost edges and invalidates downstream", async () => {
  const { engine, worker } = makeEngine();
  engine.defineSource("a", 1);
  engine.defineSource("x", 10);
  engine.defineNode("b", ["a"], (a) => a + 1);
  engine.defineNode("c", ["b"], (b) => b * 2);

  assert.equal((await engine.build(["c"])).artifacts.c, 4);
  engine.defineNode("b", ["x"], (x) => x + 1);
  assert.equal(engine.get("b"), undefined);
  assert.equal(engine.get("c"), undefined);
  assert.equal((await engine.build(["c"])).artifacts.c, 22);

  const bCalls = callsFor(worker, "b").length;
  const cCalls = callsFor(worker, "c").length;
  engine.defineSource("a", 99);

  // The removed a -> b edge must not invalidate b/c anymore.
  assert.equal(engine.get("b"), 11);
  assert.equal(engine.get("c"), 22);
  assert.equal((await engine.build(["c"])).artifacts.c, 22);
  assert.equal(callsFor(worker, "b").length, bCalls);
  assert.equal(callsFor(worker, "c").length, cCalls);
});

test("compute redefinition invalidates its old result and every downstream result", async () => {
  const { engine, worker } = makeEngine();
  engine.defineSource("a", 3);
  engine.defineNode("b", ["a"], (a) => a + 1);
  engine.defineNode("c", ["b"], (b) => b * 2);

  assert.equal((await engine.build(["c"])).artifacts.c, 8);
  engine.defineNode("b", ["a"], (a) => a + 10);
  assert.equal(engine.get("b"), undefined);
  assert.equal(engine.get("c"), undefined);
  assert.equal((await engine.build(["c"])).artifacts.c, 26);
  assert.equal(callsFor(worker, "b").length, 2);
  assert.equal(callsFor(worker, "c").length, 2);
});

test("repeated targets and a diamond share each compatible computation once", async () => {
  const { engine, worker } = makeEngine();
  engine.defineSource("a", 2);
  engine.defineNode("shared", ["a"], (a) => a + 1);
  engine.defineNode("left", ["shared"], (v) => v * 2);
  engine.defineNode("right", ["shared"], (v) => v * 3);
  engine.defineNode("top", ["left", "right"], (l, r) => l + r);

  const result = await engine.build(["top", "top", "left", "right"]);
  assert.deepEqual(result.artifacts, { top: 15, left: 6, right: 9 });
  assert.equal(callsFor(worker, "shared").length, 1);
  assert.equal(callsFor(worker, "left").length, 1);
  assert.equal(callsFor(worker, "right").length, 1);
  assert.equal(callsFor(worker, "top").length, 1);
});

test("incompatible source snapshots do not dedupe and stale completion cannot overwrite get", async () => {
  const { engine, worker } = makeEngine({ maxWorkers: 2 });
  engine.defineSource("a", 1);
  engine.defineNode("b", ["a"], (a) => a + 1);
  worker.queueDelay(40);
  worker.queueDelay(0);

  const oldBuild = engine.build(["b"]);
  await waitFor(() => callsFor(worker, "b").length === 1, "old b worker");
  engine.defineSource("a", 10);
  assert.equal(engine.get("b"), undefined);

  const newBuild = engine.build(["b"]);
  assert.equal((await newBuild).artifacts.b, 11);
  assert.equal(engine.get("b"), 11);
  assert.equal((await oldBuild).artifacts.b, 2);
  assert.equal(engine.get("b"), 11);
  assert.equal(callsFor(worker, "b").length, 2);
  assert.deepEqual(callsFor(worker, "b").map((call) => call.inputs[0]).sort((a, b) => a - b), [1, 10]);
});

test("incompatible graph definitions do not dedupe and preserve per-build provenance", async () => {
  const { engine, worker } = makeEngine({ maxWorkers: 2 });
  engine.defineSource("a", 2);
  engine.defineNode("b", ["a"], (a) => `old:${a}`);
  worker.queueDelay(40);
  worker.queueDelay(0);

  const oldBuild = engine.build(["b"]);
  await waitFor(() => callsFor(worker, "b").length === 1, "old definition worker");
  engine.defineNode("b", ["a"], (a) => `new:${a}`);
  const newBuild = engine.build(["b"]);

  assert.equal((await newBuild).artifacts.b, "new:2");
  assert.equal(engine.get("b"), "new:2");
  assert.equal((await oldBuild).artifacts.b, "old:2");
  assert.equal(engine.get("b"), "new:2");
  assert.equal(callsFor(worker, "b").length, 2);
});

test("a multi-target build stays on one logical snapshot while sources change", async () => {
  const { engine, worker } = makeEngine({ maxWorkers: 1 });
  engine.defineSource("a", 2);
  engine.defineNode("left", ["a"], (a) => a + 1);
  engine.defineNode("right", ["a"], (a) => a + 10);
  worker.queueDelay(25);
  worker.queueDelay(0);

  const build = engine.build(["left", "right"]);
  await waitFor(() => worker.calls.length === 1, "first target worker");
  engine.defineSource("a", 100);

  assert.deepEqual((await build).artifacts, { left: 3, right: 12 });
  assert.equal(engine.get("left"), undefined);
  assert.equal(engine.get("right"), undefined);

  assert.deepEqual((await engine.build(["left", "right"])).artifacts, {
    left: 101,
    right: 110
  });
});

test("worker failure clears shared in-flight state and releases the worker slot for retry", async () => {
  const { engine, worker } = makeEngine({ maxWorkers: 1 });
  engine.defineSource("a", 5);
  engine.defineNode("b", ["a"], (a) => a * 2);
  worker.failNext("boom");

  await assert.rejects(engine.build(["b"]), /boom/);
  assert.equal(engine.activeWorkers, 0);
  assert.equal(engine.inflight.size, 0);

  assert.equal((await engine.build(["b"])).artifacts.b, 10);
  assert.equal(callsFor(worker, "b").length, 2);
  assert.equal(worker.maxActive, 1);
});

test("maxWorkers is global across simultaneous builds and failure does not leak slots", async () => {
  const { engine, worker } = makeEngine({ maxWorkers: 2 });
  engine.defineSource("a", 1);
  for (const id of ["b", "c", "d", "e"]) {
    engine.defineNode(id, ["a"], (a) => a + id.charCodeAt(0));
    worker.queueDelay(15);
  }

  const results = await Promise.all([
    engine.build(["b"]),
    engine.build(["c"]),
    engine.build(["d"]),
    engine.build(["e"])
  ]);
  assert.equal(results.length, 4);
  assert.equal(worker.maxActive, 2);
  assert.equal(engine.activeWorkers, 0);
});

test("cancelling one caller does not cancel a shared computation still needed by another", async () => {
  const { engine, worker } = makeEngine();
  engine.defineSource("a", 7);
  engine.defineNode("b", ["a"], (a) => a + 1);
  worker.queueDelay(35);

  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = engine.build(["b"], { signal: firstController.signal });
  const second = engine.build(["b"], { signal: secondController.signal });
  await waitFor(() => callsFor(worker, "b").length === 1, "shared worker");
  firstController.abort();

  await assert.rejects(first, { name: "AbortError" });
  assert.equal((await second).artifacts.b, 8);
  assert.equal(callsFor(worker, "b").length, 1);
  assert.equal(engine.get("b"), 8);
});

test("when every consumer cancels while queued, worker.run is never invoked", async () => {
  const { engine, worker } = makeEngine({ maxWorkers: 1 });
  engine.defineSource("a", 1);
  engine.defineNode("blocker", ["a"], (a) => a + 1);
  engine.defineNode("queued", ["a"], (a) => a + 2);
  worker.queueDelay(40);

  const blocker = engine.build(["blocker"]);
  await waitFor(() => callsFor(worker, "blocker").length === 1, "blocker worker");

  const c1 = new AbortController();
  const c2 = new AbortController();
  const one = engine.build(["queued"], { signal: c1.signal });
  const two = engine.build(["queued"], { signal: c2.signal });
  c1.abort();
  c2.abort();

  await assert.rejects(one, { name: "AbortError" });
  await assert.rejects(two, { name: "AbortError" });
  await blocker;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(callsFor(worker, "queued").length, 0);
  assert.equal(engine.activeWorkers, 0);
});

test("all-consumer cancellation after worker start still fences the actual user compute callback", async () => {
  const { engine, worker } = makeEngine();
  engine.defineSource("a", 1);
  let computeCalls = 0;
  engine.defineNode("b", ["a"], (a) => {
    computeCalls += 1;
    return a + 1;
  });
  worker.queueDelay(35);

  const c1 = new AbortController();
  const c2 = new AbortController();
  const one = engine.build(["b"], { signal: c1.signal });
  const two = engine.build(["b"], { signal: c2.signal });
  await waitFor(() => callsFor(worker, "b").length === 1, "worker invocation before compute");
  c1.abort();
  c2.abort();

  await assert.rejects(one, { name: "AbortError" });
  await assert.rejects(two, { name: "AbortError" });
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(callsFor(worker, "b").length, 1);
  assert.equal(computeCalls, 0);
  assert.equal(engine.activeWorkers, 0);
});

test("cancelled builds cannot commit even when cancellation lands during publisher delay", async () => {
  const { engine, publisher } = makeEngine();
  engine.defineSource("a", 2);
  engine.defineNode("b", ["a"], (a) => a * 2);
  publisher.queueDelay(35);

  const controller = new AbortController();
  const build = engine.build(["b"], { publish: true, signal: controller.signal });
  await waitFor(() => publisher.calls.length === 1, "publisher call");
  controller.abort();

  await assert.rejects(build, { name: "AbortError" });
  assert.equal(publisher.commits.length, 0);
});

test("multi-target publication is atomic when one target fails", async () => {
  const { engine, worker, publisher } = makeEngine({ maxWorkers: 1 });
  engine.defineSource("a", 2);
  engine.defineNode("good", ["a"], (a) => a + 1);
  engine.defineNode("bad", ["a"], (a) => a + 2);
  worker.failNext("target failed");

  await assert.rejects(engine.build(["good", "bad"], { publish: true }), /target failed/);
  assert.equal(publisher.calls.length, 0);
  assert.equal(publisher.commits.length, 0);
});

test("publish failure preserves the previous commit and later retry can publish", async () => {
  const { engine, publisher } = makeEngine();
  engine.defineSource("a", 2);
  engine.defineNode("b", ["a"], (a) => a * 2);

  const first = await engine.build(["b"], { publish: true });
  assert.deepEqual(publisher.latest(), { buildId: first.buildId, artifacts: { b: 4 } });

  engine.defineSource("a", 3);
  publisher.failNext("publish boom");
  await assert.rejects(engine.build(["b"], { publish: true }), /publish boom/);
  assert.deepEqual(publisher.latest(), { buildId: first.buildId, artifacts: { b: 4 } });

  const retry = await engine.build(["b"], { publish: true });
  assert.deepEqual(publisher.latest(), { buildId: retry.buildId, artifacts: { b: 6 } });
});

test("a build whose snapshot becomes stale before publication is rejected without a commit", async () => {
  const { engine, worker, publisher } = makeEngine();
  engine.defineSource("a", 1);
  engine.defineNode("b", ["a"], (a) => a + 1);
  worker.queueDelay(30);

  const stale = engine.build(["b"], { publish: true });
  await waitFor(() => callsFor(worker, "b").length === 1, "stale worker");
  engine.defineSource("a", 9);

  await assert.rejects(stale, { name: "StaleBuildError" });
  assert.equal(publisher.commits.length, 0);

  const fresh = await engine.build(["b"], { publish: true });
  assert.deepEqual(publisher.latest(), { buildId: fresh.buildId, artifacts: { b: 10 } });
});

test("graph mutation during publisher delay fences the stale commit at the commit boundary", async () => {
  const { engine, publisher } = makeEngine();
  engine.defineSource("a", 1);
  engine.defineNode("b", ["a"], (a) => a + 1);
  publisher.queueDelay(35);

  const stale = engine.build(["b"], { publish: true });
  await waitFor(() => publisher.calls.length === 1, "delayed publisher");
  engine.defineSource("a", 10);

  await assert.rejects(stale, { name: "StaleBuildError" });
  assert.equal(publisher.commits.length, 0);
});

test("a newer completed publish prevents an older late build from rolling publication backward", async () => {
  const { engine, worker, publisher } = makeEngine({ maxWorkers: 2 });
  engine.defineSource("a", 1);
  engine.defineNode("slow", ["a"], (a) => a + 10);
  engine.defineNode("fast", ["a"], (a) => a + 20);
  worker.queueDelay(40);
  worker.queueDelay(0);

  const older = engine.build(["slow"], { publish: true });
  await waitFor(() => callsFor(worker, "slow").length === 1, "slow worker");
  const newer = engine.build(["fast"], { publish: true });

  const newerResult = await newer;
  assert.deepEqual(publisher.latest(), {
    buildId: newerResult.buildId,
    artifacts: { fast: 21 }
  });
  await assert.rejects(older, { name: "StaleBuildError" });
  assert.deepEqual(publisher.commits.map((commit) => commit.buildId), [newerResult.buildId]);
});

test("publisher calls already in flight are serialized so commit history never ends with an older build", async () => {
  const { engine, publisher } = makeEngine({ maxWorkers: 2 });
  engine.defineSource("a", 1);
  engine.defineNode("left", ["a"], (a) => a + 1);
  engine.defineNode("right", ["a"], (a) => a + 2);
  publisher.queueDelay(35);

  const older = engine.build(["left"], { publish: true });
  await waitFor(() => publisher.calls.length === 1, "older publish start");
  const newer = engine.build(["right"], { publish: true });

  const [oldResult, newResult] = await Promise.all([older, newer]);
  assert.deepEqual(publisher.commits.map((commit) => commit.buildId), [
    oldResult.buildId,
    newResult.buildId
  ]);
  assert.deepEqual(publisher.latest(), {
    buildId: newResult.buildId,
    artifacts: { right: 3 }
  });
});

test("dependency cycles fail clearly and the same engine recovers after the cycle is fixed", async () => {
  const { engine } = makeEngine();
  engine.defineNode("b", ["c"], (c) => c + 1);
  engine.defineNode("c", ["b"], (b) => b + 1);

  await assert.rejects(engine.build(["b"]), /dependency cycle: b -> c -> b/);
  assert.equal(engine.inflight.size, 0);

  engine.defineSource("a", 5);
  engine.defineNode("c", ["a"], (a) => a * 2);
  assert.equal((await engine.build(["b"])).artifacts.b, 11);
});

test("an unrelated revision change keeps compatible in-flight work deduped by provenance", async () => {
  const { engine, worker } = makeEngine();
  engine.defineSource("a", 4);
  engine.defineSource("unrelated", 1);
  engine.defineNode("b", ["a"], (a) => a * 2);
  worker.queueDelay(35);

  const first = engine.build(["b"]);
  await waitFor(() => callsFor(worker, "b").length === 1, "compatible in-flight worker");
  engine.defineSource("unrelated", 2);
  const second = engine.build(["b"]);

  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.artifacts.b, 8);
  assert.equal(right.artifacts.b, 8);
  assert.equal(callsFor(worker, "b").length, 1);
  assert.equal(engine.get("b"), 8);
});

test("a multi-target build keeps old graph definitions coherent across a mid-build redefinition", async () => {
  const { engine, worker } = makeEngine({ maxWorkers: 1 });
  engine.defineSource("a", 2);
  engine.defineNode("base", ["a"], (a) => a + 1);
  engine.defineNode("left", ["base"], (v) => v * 2);
  engine.defineNode("right", ["base"], (v) => v * 3);
  worker.queueDelay(25);

  const oldBuild = engine.build(["left", "right"]);
  await waitFor(() => callsFor(worker, "base").length === 1, "old base worker");
  engine.defineNode("base", ["a"], (a) => a + 10);

  assert.deepEqual((await oldBuild).artifacts, { left: 6, right: 9 });
  assert.equal(engine.get("base"), undefined);
  assert.equal(engine.get("left"), undefined);
  assert.equal(engine.get("right"), undefined);

  assert.deepEqual((await engine.build(["left", "right"])).artifacts, {
    left: 24,
    right: 36
  });
});

test("worker failure and later cancellation leave the last successful publication intact", async () => {
  const { engine, worker, publisher } = makeEngine();
  engine.defineSource("a", 2);
  engine.defineNode("b", ["a"], (a) => a * 2);
  const first = await engine.build(["b"], { publish: true });
  const committed = { buildId: first.buildId, artifacts: { b: 4 } };

  engine.defineSource("a", 3);
  worker.failNext("compute failed");
  await assert.rejects(engine.build(["b"], { publish: true }), /compute failed/);
  assert.deepEqual(publisher.latest(), committed);

  publisher.queueDelay(30);
  const controller = new AbortController();
  const cancelled = engine.build(["b"], { publish: true, signal: controller.signal });
  await waitFor(() => publisher.calls.length >= 2, "cancelled publish start");
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.deepEqual(publisher.latest(), committed);
});
