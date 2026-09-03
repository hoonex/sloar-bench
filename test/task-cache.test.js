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
