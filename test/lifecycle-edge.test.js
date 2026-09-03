import test from "node:test";
import assert from "node:assert/strict";
import { SyncClient } from "../src/sync-client.js";
import { FakeSyncApi } from "../src/fake-api.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("delete tombstone version survives invalidation and rejects an older resurrection push", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "live", 4);
  const client = new SyncClient(api);
  client.switchUser("u1");
  await client.load("doc");
  client.setOnline(false);
  client.remove("doc");
  await client.reconnect();
  assert.equal(api.read("u1", "doc").version, 5);
  assert.equal(client.get("doc"), null);

  client.invalidate("doc");
  client.applyPush({ userId: "u1", id: "doc", text: "stale", version: 4, deleted: false });
  assert.equal(client.get("doc"), null);
});

test("an invalidated old mutation cannot clear pending status for a newer edit and expose it to push overwrite", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "base", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");
  await client.load("doc");
  client.setOnline(false);

  client.edit("doc", "invalidated-old");
  client.invalidate("doc");
  client.edit("doc", "latest-local");

  const firstRelease = deferred();
  const secondStarted = deferred();
  const secondRelease = deferred();
  const originalMutate = api.mutate.bind(api);
  let callNumber = 0;
  api.mutate = async (operation) => {
    callNumber += 1;
    if (callNumber === 1) await firstRelease.promise;
    if (callNumber === 2) {
      secondStarted.resolve();
      await secondRelease.promise;
    }
    return originalMutate(operation);
  };

  const draining = client.reconnect();
  firstRelease.resolve();
  await secondStarted.promise;
  client.applyPush({ userId: "u1", id: "doc", text: "invalidated-old", version: 2, deleted: false });
  assert.equal(client.get("doc").text, "latest-local");

  secondRelease.resolve();
  await draining;
  assert.equal(client.get("doc").text, "latest-local");
  assert.equal(api.read("u1", "doc").text, "latest-local");
});

test("going offline during a flush stops before sending the next queued operation", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "base", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");
  client.setOnline(false);
  client.edit("doc", "one");
  client.edit("doc", "two");
  client.edit("doc", "three");

  const firstStarted = deferred();
  const firstRelease = deferred();
  const originalMutate = api.mutate.bind(api);
  let calls = 0;
  api.mutate = async (operation) => {
    calls += 1;
    if (calls === 1) {
      firstStarted.resolve();
      await firstRelease.promise;
    }
    return originalMutate(operation);
  };

  const draining = client.reconnect();
  await firstStarted.promise;
  client.setOnline(false);
  firstRelease.resolve();
  await draining;

  assert.equal(calls, 1);
  assert.equal(client.outbox.pending().length, 2);
  assert.equal(client.get("doc").text, "three");

  await client.reconnect();
  assert.equal(calls, 3);
  assert.equal(client.outbox.pending().length, 0);
  assert.equal(api.read("u1", "doc").text, "three");
});
