import test from "node:test";
import assert from "node:assert/strict";
import { SyncClient } from "../src/sync-client.js";
import { FakeSyncApi } from "../src/fake-api.js";

test("loads a document for the signed-in user", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "hello", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");

  const value = await client.load("doc");
  assert.equal(value.text, "hello");
  assert.equal(client.get("doc").text, "hello");
});

test("identical concurrent reads share one fetch", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "hello", 1);
  api.queueDelay(10);
  const client = new SyncClient(api);
  client.switchUser("u1");

  const [a, b] = await Promise.all([client.load("doc"), client.load("doc")]);
  assert.deepEqual(a, b);
  assert.equal(api.calls.filter((call) => call.type === "fetch").length, 1);
});

test("a single edit is optimistic and eventually persists", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "old", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");
  await client.load("doc");

  const optimistic = client.edit("doc", "new");
  assert.equal(optimistic.text, "new");
  assert.equal(client.get("doc").text, "new");

  await client.flush();
  assert.equal(api.read("u1", "doc").text, "new");
});

test("an offline edit flushes after reconnect", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "old", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");
  client.setOnline(false);

  client.edit("doc", "offline");
  assert.equal(api.calls.filter((call) => call.type === "mutate").length, 0);

  await client.reconnect();
  assert.equal(api.read("u1", "doc").text, "offline");
});

test("a newer push updates the visible document", async () => {
  const api = new FakeSyncApi();
  const client = new SyncClient(api);
  client.switchUser("u1");

  client.applyPush({ userId: "u1", id: "doc", text: "remote", version: 5, deleted: false });
  assert.equal(client.get("doc").text, "remote");
});
