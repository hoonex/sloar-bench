import test from "node:test";
import assert from "node:assert/strict";
import { TaskCache } from "../src/task-cache.js";
import { TaskBoardController } from "../src/controller.js";
import { createTaskApi } from "../src/fake-api.js";

test("identical concurrent loads share one request", async () => {
  const api = createTaskApi();
  const cache = new TaskCache(api);
  const params = { workspaceId: "w1", status: "open", sort: "updated", page: 1 };

  const [a, b] = await Promise.all([cache.load(params), cache.load(params)]);

  assert.deepEqual(a, b);
  assert.equal(api.calls.length, 1);
});

test("requests with equivalent default params share one request", async () => {
  const api = createTaskApi();
  const cache = new TaskCache(api);

  const [a, b] = await Promise.all([
    cache.load({ workspaceId: "w1" }),
    cache.load({ workspaceId: "w1", status: "all", sort: "updated", page: 1 })
  ]);

  assert.strictEqual(a, b);
  assert.equal(api.calls.length, 1);
});

test("different workspaces do not share cached data", async () => {
  const api = createTaskApi();
  const cache = new TaskCache(api);

  const [a, b] = await Promise.all([
    cache.load({ workspaceId: "w1", status: "open" }),
    cache.load({ workspaceId: "w2", status: "open" })
  ]);

  assert.notDeepEqual(a, b);
  assert.equal(api.calls.length, 2);
});

test("changing status in one workspace loads the matching result", async () => {
  const api = createTaskApi();
  const controller = new TaskBoardController(new TaskCache(api));

  await controller.show({ workspaceId: "w1", status: "open" });
  await controller.show({ workspaceId: "w1", status: "done" });

  assert.deepEqual(controller.getVisibleIds(), [
    "w1-done-updated-p1-a",
    "w1-done-updated-p1-b"
  ]);
  assert.equal(api.calls.length, 2);
});

test("page and sort are distinct cache variants", async () => {
  const api = createTaskApi();
  const cache = new TaskCache(api);

  const page1 = await cache.load({ workspaceId: "w1", status: "open", sort: "updated", page: 1 });
  const page2 = await cache.load({ workspaceId: "w1", status: "open", sort: "updated", page: 2 });
  const sorted = await cache.load({ workspaceId: "w1", status: "open", sort: "created", page: 1 });

  assert.equal(page1.items[0].id, "w1-open-updated-p1-a");
  assert.equal(page2.items[0].id, "w1-open-updated-p2-a");
  assert.equal(sorted.items[0].id, "w1-open-created-p1-a");
  assert.equal(api.calls.length, 3);
});

test("a failed request is evicted so the same load can retry", async () => {
  const api = createTaskApi();
  const cache = new TaskCache(api);
  const params = { workspaceId: "w1", status: "open", sort: "updated", page: 1 };
  api.failNext(params);

  await assert.rejects(cache.load(params), /temporary failure/);
  const result = await cache.load(params);

  assert.equal(result.items[0].id, "w1-open-updated-p1-a");
  assert.equal(api.calls.length, 2);
});

test("invalidating a workspace removes all its variants but keeps other workspaces", async () => {
  const api = createTaskApi();
  const cache = new TaskCache(api);

  const w1Open = { workspaceId: "w1", status: "open" };
  const w1Done = { workspaceId: "w1", status: "done", page: 2 };
  const w2Open = { workspaceId: "w2", status: "open" };

  await cache.load(w1Open);
  await cache.load(w1Done);
  const w2Before = await cache.load(w2Open);

  cache.invalidateWorkspace("w1");

  await cache.load(w1Open);
  await cache.load(w1Done);
  const w2After = await cache.load(w2Open);

  assert.strictEqual(w2After, w2Before);
  assert.equal(api.calls.length, 5);
});

test("a stale failed request cannot evict a replacement after invalidation", async () => {
  const api = createTaskApi();
  const cache = new TaskCache(api);
  const params = { workspaceId: "w1", status: "open" };
  api.failNext(params);

  const failed = cache.load(params);
  cache.invalidateWorkspace("w1");
  const replacement = cache.load(params);

  await assert.rejects(failed, /temporary failure/);
  const result = await replacement;
  const cached = await cache.load(params);

  assert.strictEqual(cached, result);
  assert.equal(api.calls.length, 2);
});

test("invalidating a workspace causes its next load to refetch", async () => {
  const api = createTaskApi();
  const cache = new TaskCache(api);
  const params = { workspaceId: "w1", status: "open" };

  await cache.load(params);
  cache.invalidateWorkspace("w1");
  await cache.load(params);

  assert.equal(api.calls.length, 2);
});

test("controller exposes ids from the loaded page", async () => {
  const api = createTaskApi();
  const controller = new TaskBoardController(new TaskCache(api));

  await controller.show({ workspaceId: "w1", status: "open", page: 1 });

  assert.deepEqual(controller.getVisibleIds(), [
    "w1-open-updated-p1-a",
    "w1-open-updated-p1-b"
  ]);
});
