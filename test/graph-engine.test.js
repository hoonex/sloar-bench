import test from "node:test";
import assert from "node:assert/strict";
import { GraphEngine } from "../src/graph-engine.js";
import { FakeWorker } from "../src/fake-worker.js";
import { FakePublisher } from "../src/fake-publisher.js";

function makeEngine(options = {}) {
  const worker = new FakeWorker();
  const publisher = new FakePublisher();
  const engine = new GraphEngine({ worker, publisher, maxWorkers: options.maxWorkers ?? 2 });
  return { engine, worker, publisher };
}

test("builds a dependency chain", async () => {
  const { engine } = makeEngine();
  engine.defineSource("a", 2);
  engine.defineNode("b", ["a"], (a) => a * 3);
  engine.defineNode("c", ["b"], (b) => b + 1);

  const result = await engine.build(["c"]);
  assert.deepEqual(result.artifacts, { c: 7 });
  assert.equal(engine.get("c"), 7);
});

test("reuses a cached node", async () => {
  const { engine, worker } = makeEngine();
  engine.defineSource("a", 4);
  engine.defineNode("b", ["a"], (a) => a * 2);

  await engine.build(["b"]);
  await engine.build(["b"]);
  assert.equal(worker.calls.filter((call) => call.nodeId === "b").length, 1);
});

test("source changes invalidate a direct dependent", async () => {
  const { engine } = makeEngine();
  engine.defineSource("a", 2);
  engine.defineNode("b", ["a"], (a) => a * 5);

  assert.equal((await engine.build(["b"])).artifacts.b, 10);
  engine.defineSource("a", 3);
  assert.equal((await engine.build(["b"])).artifacts.b, 15);
});

test("identical concurrent target builds share work", async () => {
  const { engine, worker } = makeEngine();
  engine.defineSource("a", 5);
  engine.defineNode("b", ["a"], (a) => a + 1);
  worker.queueDelay(20);

  const [left, right] = await Promise.all([
    engine.build(["b"]),
    engine.build(["b"])
  ]);

  assert.equal(left.artifacts.b, 6);
  assert.equal(right.artifacts.b, 6);
  assert.equal(worker.calls.filter((call) => call.nodeId === "b").length, 1);
});

test("respects the worker concurrency limit", async () => {
  const { engine, worker } = makeEngine({ maxWorkers: 1 });
  engine.defineSource("a", 1);
  engine.defineNode("b", ["a"], (a) => a + 1);
  engine.defineNode("c", ["a"], (a) => a + 2);
  worker.queueDelay(10);
  worker.queueDelay(10);

  const result = await engine.build(["b", "c"]);
  assert.deepEqual(result.artifacts, { b: 2, c: 3 });
  assert.equal(worker.maxActive, 1);
});

test("publishes a successful build", async () => {
  const { engine, publisher } = makeEngine();
  engine.defineSource("a", 2);
  engine.defineNode("b", ["a"], (a) => a * 4);

  const result = await engine.build(["b"], { publish: true });
  assert.deepEqual(publisher.latest(), {
    buildId: result.buildId,
    artifacts: { b: 8 }
  });
});
