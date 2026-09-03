import test from "node:test";
import assert from "node:assert/strict";
import { TaskScheduler } from "../src/scheduler.js";
import { FakeRunner } from "../src/fake-runner.js";
import { TransientError } from "../src/errors.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function turn() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("submits and resolves a task", async () => {
  const scheduler = new TaskScheduler();
  const handle = scheduler.submit(
    { tenantId: "t1", id: "a", group: "g1", input: { x: 1 } },
    async (task) => ({ ok: true, id: task.id })
  );
  assert.deepEqual(await handle.promise, { ok: true, id: "a" });
});

test("respects the global concurrency limit", async () => {
  const scheduler = new TaskScheduler({ maxConcurrent: 2, maxPerGroup: 99 });
  const runner = new FakeRunner();
  const a = deferred();
  const b = deferred();
  const c = deferred();
  runner.gate(a.promise);
  runner.gate(b.promise);
  runner.gate(c.promise);

  scheduler.submit({ tenantId: "t1", id: "a", group: "g" }, runner.run.bind(runner));
  scheduler.submit({ tenantId: "t1", id: "b", group: "g" }, runner.run.bind(runner));
  scheduler.submit({ tenantId: "t1", id: "c", group: "g" }, runner.run.bind(runner));
  await turn();

  assert.equal(runner.calls.length, 2);
  assert.equal(runner.maxActive, 2);

  a.resolve();
  await turn();
  assert.equal(runner.calls.length, 3);
  b.resolve();
  c.resolve();
  await scheduler.drain();
  assert.equal(scheduler.runningCount(), 0);
});

test("identical submissions share one underlying execution", async () => {
  const scheduler = new TaskScheduler();
  let calls = 0;
  const gate = deferred();
  const task = { tenantId: "t1", id: "same", group: "g", input: { mode: "x" } };
  const runner = async () => {
    calls += 1;
    await gate.promise;
    return "done";
  };

  const first = scheduler.submit(task, runner);
  const second = scheduler.submit(task, runner);
  await turn();
  assert.equal(calls, 1);
  assert.equal(first.promise, second.promise);

  gate.resolve();
  assert.equal(await first.promise, "done");
  assert.equal(await second.promise, "done");
});

test("transient failure retries once with the same execution id", async () => {
  const scheduler = new TaskScheduler({ maxAttempts: 2 });
  const executionIds = [];
  let attempts = 0;

  const handle = scheduler.submit(
    { tenantId: "t1", id: "retry", group: "g" },
    async (_task, context) => {
      attempts += 1;
      executionIds.push(context.executionId);
      if (attempts === 1) throw new TransientError();
      return "recovered";
    }
  );

  assert.equal(await handle.promise, "recovered");
  assert.equal(attempts, 2);
  assert.equal(executionIds[0], executionIds[1]);
});

test("drain waits for work that is pending when drain is called", async () => {
  const scheduler = new TaskScheduler();
  const gate = deferred();
  scheduler.submit({ tenantId: "t1", id: "slow", group: "g" }, async () => {
    await gate.promise;
    return "ok";
  });

  let drained = false;
  const draining = scheduler.drain().then(() => {
    drained = true;
  });
  await turn();
  assert.equal(drained, false);

  gate.resolve();
  await draining;
  assert.equal(drained, true);
});
