import test from "node:test";
import assert from "node:assert/strict";
import { TaskScheduler } from "../src/scheduler.js";
import { CancelledError, TransientError } from "../src/errors.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const turn = () => new Promise((resolve) => setImmediate(resolve));

test("canonical identity dedupes one execution but gives callers independent handles", async () => {
  const scheduler = new TaskScheduler();
  const gate = deferred();
  let calls = 0;
  let signal;
  const runner = async (_task, context) => {
    calls += 1;
    signal = context.signal;
    await gate.promise;
    return "done";
  };
  const first = scheduler.submit({
    tenantId: "t1", id: "same", group: "g", input: { a: 1, nested: { x: true, list: [1, 2] } }
  }, runner);
  const second = scheduler.submit({
    tenantId: "t1", id: "same", group: "other", priority: 99,
    input: { nested: { list: [1, 2], x: true }, a: 1 }
  }, runner);

  assert.notEqual(first, second);
  assert.notEqual(first.promise, second.promise);
  await turn();
  assert.equal(calls, 1);

  const cancelled = assert.rejects(first.promise, CancelledError);
  first.cancel();
  await cancelled;
  assert.equal(signal.aborted, false);

  gate.resolve();
  assert.equal(await second.promise, "done");
  assert.equal(signal.aborted, false);
});

test("identity distinguishes tenant, input value, and array order", async () => {
  const scheduler = new TaskScheduler({ maxConcurrent: 4, maxPerGroup: 4 });
  const ids = await Promise.all([
    { tenantId: "t1", id: "x", input: { v: [1, 2] } },
    { tenantId: "t2", id: "x", input: { v: [1, 2] } },
    { tenantId: "t1", id: "x", input: { v: [2, 1] } },
    { tenantId: "t1", id: "x", input: { v: [1, 3] } }
  ].map((task) => scheduler.submit(task, async (_task, context) => context.executionId).promise));
  assert.equal(new Set(ids).size, 4);
});

test("all callers cancelling before invocation skips runner; running cancellation aborts and suppresses retry", async () => {
  const before = new TaskScheduler({ maxConcurrent: 1 });
  let calls = 0;
  const task = { tenantId: "t1", id: "before", group: "g" };
  const a = before.submit(task, async () => { calls += 1; });
  const b = before.submit(task, async () => { calls += 1; });
  const ar = assert.rejects(a.promise, CancelledError);
  const br = assert.rejects(b.promise, CancelledError);
  a.cancel(); b.cancel();
  await Promise.all([ar, br, before.drain()]);
  assert.equal(calls, 0);

  const running = new TaskScheduler({ maxAttempts: 3 });
  const gate = deferred();
  let attempts = 0;
  let signal;
  const runner = async (_task, context) => {
    attempts += 1;
    signal = context.signal;
    await gate.promise;
    throw new TransientError("late");
  };
  const c = running.submit({ tenantId: "t1", id: "running", group: "g" }, runner);
  const d = running.submit({ tenantId: "t1", id: "running", group: "g" }, runner);
  await turn();
  const cr = assert.rejects(c.promise, CancelledError);
  const dr = assert.rejects(d.promise, CancelledError);
  c.cancel(); d.cancel();
  await Promise.all([cr, dr]);
  assert.equal(signal.aborted, true);
  gate.resolve();
  await running.drain();
  assert.equal(attempts, 1);
});

test("cancelled execution late completion cannot delete replacement dedupe state", async () => {
  const scheduler = new TaskScheduler({ maxConcurrent: 2, maxPerGroup: 2 });
  const oldGate = deferred();
  const newGate = deferred();
  const calls = [];
  const task = { tenantId: "t1", id: "replace", group: "g", input: { x: 1 } };
  const runner = async (_task, context) => {
    calls.push(context.executionId);
    if (calls.length === 1) { await oldGate.promise; return "old"; }
    await newGate.promise;
    return "new";
  };

  const old = scheduler.submit(task, runner);
  await turn();
  const oldRejected = assert.rejects(old.promise, CancelledError);
  old.cancel();
  await oldRejected;

  const replacement = scheduler.submit(task, runner);
  await turn();
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0], calls[1]);
  const peer = scheduler.submit(task, runner);
  await turn();
  assert.equal(calls.length, 2);

  oldGate.resolve();
  await turn();
  const afterOldFinalizer = scheduler.submit(task, runner);
  await turn();
  assert.equal(calls.length, 2);

  newGate.resolve();
  assert.deepEqual(await Promise.all([
    replacement.promise, peer.promise, afterOldFinalizer.promise
  ]), ["new", "new", "new"]);
});

test("success and final failure resubmit with a new executionId", async () => {
  const scheduler = new TaskScheduler({ maxAttempts: 2 });
  const task = { tenantId: "t1", id: "success", group: "g" };
  const first = await scheduler.submit(task, async (_task, c) => c.executionId).promise;
  const second = await scheduler.submit(task, async (_task, c) => c.executionId).promise;
  assert.notEqual(first, second);

  const failedTask = { tenantId: "t1", id: "failed", group: "g" };
  let failedId;
  const failed = scheduler.submit(failedTask, (_task, c) => {
    failedId = c.executionId;
    throw new Error("permanent");
  });
  await assert.rejects(failed.promise, /permanent/);
  const replacement = await scheduler.submit(failedTask, async (_task, c) => c.executionId).promise;
  assert.notEqual(failedId, replacement);
});

test("retry uses maxAttempts total, keeps executionId/dedupe, and rejects non-transient without retry", async () => {
  const scheduler = new TaskScheduler({ maxAttempts: 3 });
  const ids = [];
  let attempts = 0;
  const transient = new TransientError("again");
  const failed = scheduler.submit({ tenantId: "t1", id: "retry-limit", group: "g" }, async (_t, c) => {
    attempts += 1;
    ids.push(c.executionId);
    throw transient;
  });
  await assert.rejects(failed.promise, (error) => error === transient);
  assert.equal(attempts, 3);
  assert.equal(new Set(ids).size, 1);

  const retryGate = deferred();
  let sharedAttempts = 0;
  const sharedTask = { tenantId: "t1", id: "retry-shared", group: "g" };
  const runner = async (_t, c) => {
    sharedAttempts += 1;
    if (c.attempt === 1) throw new TransientError();
    await retryGate.promise;
    return c.executionId;
  };
  const one = scheduler.submit(sharedTask, runner);
  await turn();
  assert.equal(sharedAttempts, 2);
  const two = scheduler.submit(sharedTask, runner);
  await turn();
  assert.equal(sharedAttempts, 2);
  retryGate.resolve();
  assert.equal(await one.promise, await two.promise);

  let permanentAttempts = 0;
  const permanent = scheduler.submit({ tenantId: "t1", id: "permanent", group: "g" }, async () => {
    permanentAttempts += 1;
    throw new Error("no retry");
  });
  await assert.rejects(permanent.promise, /no retry/);
  assert.equal(permanentAttempts, 1);
});

test("global/per-group concurrency limits are reacquired for retry", async () => {
  const scheduler = new TaskScheduler({ maxConcurrent: 2, maxPerGroup: 1, maxAttempts: 2 });
  const gates = { a1: deferred(), a2: deferred(), b: deferred(), c: deferred() };
  const starts = [];
  let active = 0;
  let maxActive = 0;
  const groupActive = new Map();
  let maxG = 0;
  const runner = async (task, context) => {
    starts.push(`${task.id}:${context.attempt}`);
    active += 1;
    maxActive = Math.max(maxActive, active);
    const ga = (groupActive.get(task.group) ?? 0) + 1;
    groupActive.set(task.group, ga);
    if (task.group === "g") maxG = Math.max(maxG, ga);
    try {
      if (task.id === "a" && context.attempt === 1) {
        await gates.a1.promise;
        throw new TransientError();
      }
      await gates[task.id === "a" ? "a2" : task.id].promise;
      return task.id;
    } finally {
      active -= 1;
      groupActive.set(task.group, (groupActive.get(task.group) ?? 1) - 1);
    }
  };
  const a = scheduler.submit({ tenantId: "t1", id: "a", group: "g" }, runner);
  const b = scheduler.submit({ tenantId: "t1", id: "b", group: "g" }, runner);
  const c = scheduler.submit({ tenantId: "t1", id: "c", group: "h" }, runner);
  await turn();
  assert.deepEqual(starts, ["a:1", "c:1"]);
  gates.a1.resolve();
  await turn();
  assert.deepEqual(starts, ["a:1", "c:1", "a:2"]);
  gates.a2.resolve();
  await turn();
  assert.deepEqual(starts, ["a:1", "c:1", "a:2", "b:1"]);
  gates.b.resolve(); gates.c.resolve();
  await Promise.all([a.promise, b.promise, c.promise]);
  await scheduler.drain();
  assert.equal(maxActive, 2);
  assert.equal(maxG, 1);
  assert.equal(scheduler.runningCount(), 0);
});

test("priority is high-first/FIFO and blocked groups do not cause head-of-line blocking", async () => {
  const fifo = new TaskScheduler({ maxConcurrent: 1, maxPerGroup: 10 });
  const blocker = deferred();
  const order = [];
  fifo.submit({ tenantId: "t1", id: "block", group: "g" }, async () => {
    order.push("block"); await blocker.promise;
  });
  await turn();
  fifo.submit({ tenantId: "t1", id: "low", group: "g", priority: 1 }, async () => { order.push("low"); });
  fifo.submit({ tenantId: "t1", id: "high1", group: "g", priority: 10 }, async () => { order.push("high1"); });
  fifo.submit({ tenantId: "t1", id: "high2", group: "g", priority: 10 }, async () => { order.push("high2"); });
  blocker.resolve();
  await fifo.drain();
  assert.deepEqual(order, ["block", "high1", "high2", "low"]);

  const groups = new TaskScheduler({ maxConcurrent: 2, maxPerGroup: 1 });
  const a1Gate = deferred();
  const bGate = deferred();
  const starts = [];
  groups.submit({ tenantId: "t1", id: "a1", group: "a" }, async () => {
    starts.push("a1"); await a1Gate.promise;
  });
  await turn();
  groups.submit({ tenantId: "t1", id: "a2", group: "a", priority: 100 }, async () => { starts.push("a2"); });
  groups.submit({ tenantId: "t1", id: "b1", group: "b", priority: 1 }, async () => {
    starts.push("b1"); await bGate.promise;
  });
  await turn();
  assert.deepEqual(starts, ["a1", "b1"]);
  a1Gate.resolve();
  await turn();
  assert.deepEqual(starts, ["a1", "b1", "a2"]);
  bGate.resolve();
  await groups.drain();
});

test("drain is live across added work/retry and subsequent lifecycles", async () => {
  const scheduler = new TaskScheduler({ maxConcurrent: 1, maxAttempts: 2 });
  const firstGate = deferred();
  const retryGate = deferred();
  const laterGate = deferred();
  scheduler.submit({ tenantId: "t1", id: "first", group: "g" }, async () => { await firstGate.promise; });
  let drained = false;
  const draining = scheduler.drain().then(() => { drained = true; });
  let attempts = 0;
  const retrying = scheduler.submit({ tenantId: "t1", id: "added", group: "g" }, async () => {
    attempts += 1;
    if (attempts === 1) throw new TransientError();
    await retryGate.promise;
  });
  firstGate.resolve();
  await turn();
  assert.equal(attempts, 2);
  assert.equal(drained, false);
  retryGate.resolve();
  await retrying.promise;
  await draining;
  assert.equal(drained, true);

  scheduler.submit({ tenantId: "t1", id: "later", group: "g" }, async () => { await laterGate.promise; });
  let drainedAgain = false;
  const secondDrain = scheduler.drain().then(() => { drainedAgain = true; });
  await turn();
  assert.equal(drainedAgain, false);
  laterGate.resolve();
  await secondDrain;
  assert.equal(drainedAgain, true);
});

test("drain waits for cancelled running work after dedupe entry is detached", async () => {
  const scheduler = new TaskScheduler();
  const gate = deferred();
  const handle = scheduler.submit({ tenantId: "t1", id: "cancel-drain", group: "g" }, async () => {
    await gate.promise;
  });
  await turn();
  const rejected = assert.rejects(handle.promise, CancelledError);
  handle.cancel();
  await rejected;
  let drained = false;
  const draining = scheduler.drain().then(() => { drained = true; });
  await turn();
  assert.equal(drained, false);
  assert.equal(scheduler.runningCount(), 1);
  gate.resolve();
  await draining;
  assert.equal(scheduler.runningCount(), 0);
});

test("synchronous runner throw releases concurrency slot and dedupe entry", async () => {
  const scheduler = new TaskScheduler({ maxConcurrent: 1, maxPerGroup: 1 });
  let failedId;
  const task = { tenantId: "t1", id: "sync", group: "g" };
  const failed = scheduler.submit(task, (_task, context) => {
    failedId = context.executionId;
    throw new Error("sync boom");
  });
  const failedAssertion = assert.rejects(failed.promise, /sync boom/);
  const next = scheduler.submit({ tenantId: "t1", id: "next", group: "g" }, async () => "next");
  await failedAssertion;
  assert.equal(await next.promise, "next");
  assert.equal(scheduler.runningCount(), 0);
  const replacement = await scheduler.submit(task, async (_task, context) => context.executionId).promise;
  assert.notEqual(replacement, failedId);
  await scheduler.drain();
});
