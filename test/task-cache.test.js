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

test("defaulted and explicit equivalent requests share one request", async () => {
  const api = createTaskApi();
  const cache = new TaskCache(api);

  const [a, b] = await Promise.all([
    cache.load({ workspaceId: "w1" }),
    cache.load({ workspaceId: "w1", status: "all", sort: "updated", page: 1 })
  ]);

  assert.deepEqual(a, b);
  assert.equal(api.calls.length, 1);
});

test("different filters in one workspace use different cache entries", async () => {
  const api = createTaskApi();
  const cache = new TaskCache(api);

  const open = await cache.load({ workspaceId: "w1", status: "open" });
  const done = await cache.load({ workspaceId: "w1", status: "done" });
  await cache.load({ workspaceId: "w1", status: "open" });

  assert.notDeepEqual(open, done);
  assert.equal(api.calls.length, 2);
});

test("different pages and sorts use different cache entries", async () => {
  const api = createTaskApi();
  const cache = new TaskCache(api);

  const updatedPage1 = await cache.load({
    workspaceId: "w1",
    status: "open",
    sort: "updated",
    page: 1
  });
  const updatedPage2 = await cache.load({
    workspaceId: "w1",
    status: "open",
    sort: "updated",
    page: 2
  });
  const createdPage1 = await cache.load({
    workspaceId: "w1",
    status: "open",
    sort: "created",
    page: 1
  });

  assert.notDeepEqual(updatedPage1, updatedPage2);
  assert.notDeepEqual(updatedPage1, createdPage1);
  assert.equal(api.calls.length, 3);
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

test("failed requests are evicted so the same request can retry", async () => {
  const api = createTaskApi();
  const cache = new TaskCache(api);
  const params = { workspaceId: "w1", status: "open", sort: "updated", page: 1 };
  api.failNext(params);

  const first = cache.load(params);
  const duplicate = cache.load(params);

  await assert.rejects(first, /temporary failure/);
  await assert.rejects(duplicate, /temporary failure/);
  assert.equal(api.calls.length, 1);

  const result = await cache.load(params);
  assert.deepEqual(result.items.map((item) => item.id), [
    "w1-open-updated-p1-a",
    "w1-open-updated-p1-b"
  ]);
  assert.equal(api.calls.length, 2);

  await cache.load(params);
  assert.equal(api.calls.length, 2);
});

test("invalidating a workspace removes all of its variants only", async () => {
  const api = createTaskApi();
  const cache = new TaskCache(api);
  const w1Open = { workspaceId: "w1", status: "open" };
  const w1Done = { workspaceId: "w1", status: "done", page: 2 };
  const w2Open = { workspaceId: "w2", status: "open" };
  const w2Done = { workspaceId: "w2", status: "done", page: 2 };

  await Promise.all([
    cache.load(w1Open),
    cache.load(w1Done),
    cache.load(w2Open),
    cache.load(w2Done)
  ]);
  assert.equal(api.calls.length, 4);

  cache.invalidateWorkspace("w1");

  await Promise.all([
    cache.load(w1Open),
    cache.load(w1Done),
    cache.load(w2Open),
    cache.load(w2Done)
  ]);

  assert.equal(api.calls.length, 6);
  assert.deepEqual(
    api.calls.slice(4).map(({ workspaceId, status, page }) => ({
      workspaceId,
      status,
      page
    })),
    [
      { workspaceId: "w1", status: "open", page: 1 },
      { workspaceId: "w1", status: "done", page: 2 }
    ]
  );
});

test("invalidating during an in-flight request does not let it remove a newer entry", async () => {
  const resolvers = [];
  const fetchPage = () =>
    new Promise((resolve, reject) => {
      resolvers.push({ resolve, reject });
    });
  const cache = new TaskCache(fetchPage);
  const params = { workspaceId: "w1", status: "open" };

  const stale = cache.load(params);
  await Promise.resolve();
  cache.invalidateWorkspace("w1");
  const fresh = cache.load(params);
  await Promise.resolve();

  resolvers[0].reject(new Error("stale failure"));
  await assert.rejects(stale, /stale failure/);

  resolvers[1].resolve({ items: [{ id: "fresh" }] });
  assert.deepEqual(await fresh, { items: [{ id: "fresh" }] });
  assert.strictEqual(cache.load(params), fresh);
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

test("controller keeps the latest requested view when older loads finish later", async () => {
  const pending = new Map();
  const fetchPage = ({ status }) =>
    new Promise((resolve) => {
      pending.set(status, resolve);
    });
  const controller = new TaskBoardController(new TaskCache(fetchPage));

  const open = controller.show({ workspaceId: "w1", status: "open" });
  const done = controller.show({ workspaceId: "w1", status: "done" });
  await Promise.resolve();

  pending.get("done")({ items: [{ id: "done" }] });
  assert.deepEqual(await done, [{ id: "done" }]);

  pending.get("open")({ items: [{ id: "open" }] });
  assert.deepEqual(await open, [{ id: "open" }]);
  assert.deepEqual(controller.getVisibleIds(), ["done"]);
});
