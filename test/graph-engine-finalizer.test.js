import test from "node:test";
import assert from "node:assert/strict";
import { GraphEngine } from "../src/graph-engine.js";
import { FakeWorker } from "../src/fake-worker.js";
import { FakePublisher } from "../src/fake-publisher.js";

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

test("a late finalizer from a cancelled execution cannot detach its newer replacement", async () => {
  const worker = new FakeWorker();
  const engine = new GraphEngine({ worker, publisher: new FakePublisher(), maxWorkers: 2 });
  const callsForB = () => worker.calls.filter((call) => call.nodeId === "b").length;

  engine.defineSource("a", 1);
  engine.defineNode("b", ["a"], (a) => a + 1);
  worker.queueDelay(20);
  worker.queueDelay(50);

  const controller = new AbortController();
  const cancelled = engine.build(["b"], { signal: controller.signal });
  await waitFor(() => callsForB() === 1, "cancelled execution worker");
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });

  const replacement = engine.build(["b"]);
  await waitFor(() => callsForB() === 2, "replacement worker");

  // Let the cancelled execution settle while the replacement is still active.
  await new Promise((resolve) => setTimeout(resolve, 25));
  const joiner = engine.build(["b"]);

  const [replacementResult, joinerResult] = await Promise.all([replacement, joiner]);
  assert.equal(replacementResult.artifacts.b, 2);
  assert.equal(joinerResult.artifacts.b, 2);
  assert.equal(callsForB(), 2);
  assert.equal(engine.activeWorkers, 0);
});
