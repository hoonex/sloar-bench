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

test("cache and visible state are isolated for users sharing the same document id", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "alice", 1);
  api.seed("u2", "doc", "bob", 7);
  const client = new SyncClient(api);

  client.switchUser("u1");
  await client.load("doc");
  client.switchUser("u2");
  await client.load("doc");
  assert.equal(client.get("doc").text, "bob");

  client.switchUser("u1");
  assert.equal(client.get("doc").text, "alice");
  assert.equal(api.calls.filter((call) => call.type === "fetch").length, 2);
});

test("in-flight reads are isolated by user and a late prior-session response cannot pollute the current user", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "alice", 1);
  api.seed("u2", "doc", "bob", 2);
  api.queueDelay(30);
  const client = new SyncClient(api);

  client.switchUser("u1");
  const aliceLoad = client.load("doc");
  client.switchUser("u2");
  const bobLoad = client.load("doc");

  const bob = await bobLoad;
  assert.equal(bob.text, "bob");
  assert.equal(client.get("doc").text, "bob");

  const alice = await aliceLoad;
  assert.equal(alice.text, "alice");
  assert.equal(client.get("doc").text, "bob");
  assert.equal(api.calls.filter((call) => call.type === "fetch").length, 2);
});

test("a rejected fetch is removed from in-flight state and can be retried", async () => {
  let attempts = 0;
  const api = {
    async fetchDoc({ id }) {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary read failure");
      return { id, text: "recovered", version: 3, deleted: false };
    },
    async mutate() {
      throw new Error("not used");
    }
  };
  const client = new SyncClient(api);
  client.switchUser("u1");

  await assert.rejects(client.load("doc"), /temporary read failure/);
  const value = await client.load("doc");
  assert.equal(value.text, "recovered");
  assert.equal(attempts, 2);
});

test("logout invalidates an in-flight read so its late response cannot revive local or cache state", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "secret", 1);
  api.queueDelay(20);
  const client = new SyncClient(api);
  client.switchUser("u1");

  const pending = client.load("doc");
  client.logout();
  await pending;

  client.switchUser("u1");
  assert.equal(client.get("doc"), null);
  const fresh = await client.load("doc");
  assert.equal(fresh.text, "secret");
  assert.equal(api.calls.filter((call) => call.type === "fetch").length, 2);
});

test("explicit invalidation detaches an old in-flight read and forces a fresh fetch", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "server", 1);
  api.queueDelay(20);
  const client = new SyncClient(api);
  client.switchUser("u1");

  const pending = client.load("doc");
  client.invalidate("doc");
  await pending;
  assert.equal(client.get("doc"), null);

  const fresh = await client.load("doc");
  assert.equal(fresh.text, "server");
  assert.equal(api.calls.filter((call) => call.type === "fetch").length, 2);
});

test("an older mutation response cannot overwrite a newer optimistic edit", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "base", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");
  await client.load("doc");

  api.queueDelay(20);
  api.queueDelay(70);
  client.edit("doc", "first");
  client.edit("doc", "second");

  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(client.get("doc").text, "second");

  await client.flush();
  assert.equal(client.get("doc").text, "second");
  assert.equal(api.read("u1", "doc").text, "second");
});

test("a failed older mutation cannot roll back a newer optimistic edit and the queue remains retryable", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "base", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");
  await client.load("doc");
  client.setOnline(false);

  client.edit("doc", "first");
  client.edit("doc", "second");
  api.failNext("before");
  client.setOnline(true);

  await assert.rejects(client.flush(), /temporary failure before apply/);
  assert.equal(client.get("doc").text, "second");
  assert.equal(client.outbox.pending().length, 2);

  await client.flush();
  assert.equal(client.get("doc").text, "second");
  assert.equal(api.read("u1", "doc").text, "second");
  assert.equal(client.outbox.pending().length, 0);
});

test("retry after an after-apply network error reuses the same mutation id and does not apply twice", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "base", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");
  await client.load("doc");
  client.setOnline(false);

  client.edit("doc", "once");
  const queuedOpId = client.outbox.pending()[0].opId;
  api.failNext("after");
  client.setOnline(true);

  await assert.rejects(client.flush(), /temporary failure after apply/);
  assert.equal(api.read("u1", "doc").version, 2);
  assert.equal(client.outbox.pending().length, 1);

  await client.flush();
  assert.equal(api.read("u1", "doc").version, 2);
  assert.equal(api.read("u1", "doc").text, "once");
  assert.equal(client.outbox.pending().length, 0);
  const mutationCalls = api.calls.filter((call) => call.opId);
  assert.equal(mutationCalls.length, 2);
  assert.equal(mutationCalls[0].opId, queuedOpId);
  assert.equal(mutationCalls[1].opId, queuedOpId);
});

test("rapid distinct edits receive distinct mutation ids even when Date.now is constant", () => {
  const api = new FakeSyncApi();
  const client = new SyncClient(api);
  client.switchUser("u1");
  client.setOnline(false);

  const originalNow = Date.now;
  Date.now = () => 1234567890;
  try {
    client.edit("doc", "first");
    client.edit("doc", "second");
  } finally {
    Date.now = originalNow;
  }

  const [first, second] = client.outbox.pending();
  assert.notEqual(first.opId, second.opId);
});

test("offline operations flush in FIFO order, preserve final state, and empty the queue", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "base", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");
  client.setOnline(false);

  client.edit("doc", "one");
  client.edit("doc", "two");
  client.remove("doc");
  client.edit("doc", "three");
  assert.equal(client.outbox.pending().length, 4);

  await client.reconnect();
  const mutations = api.calls.filter((call) => call.opId);
  assert.deepEqual(
    mutations.map((call) => [call.type, call.text ?? "<delete>"]),
    [
      ["edit", "one"],
      ["edit", "two"],
      ["delete", "<delete>"],
      ["edit", "three"]
    ]
  );
  assert.equal(api.read("u1", "doc").text, "three");
  assert.equal(api.read("u1", "doc").deleted, false);
  assert.equal(api.read("u1", "doc").version, 5);
  assert.equal(client.get("doc").text, "three");
  assert.equal(client.outbox.pending().length, 0);
});

test("a later batch can flush after an earlier flush has completed", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "base", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");
  client.setOnline(false);

  client.edit("doc", "first batch");
  await client.reconnect();
  assert.equal(client.outbox.pending().length, 0);

  client.setOnline(false);
  client.edit("doc", "second batch");
  await client.reconnect();
  assert.equal(api.read("u1", "doc").text, "second batch");
  assert.equal(client.outbox.pending().length, 0);
  assert.equal(api.calls.filter((call) => call.opId).length, 2);
});

test("a delete cannot be resurrected by an earlier load response or an older push event", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "live", 1);
  api.queueDelay(25);
  const client = new SyncClient(api);
  client.switchUser("u1");

  const staleLoad = client.load("doc");
  client.setOnline(false);
  client.remove("doc");

  assert.equal(await staleLoad, null);
  assert.equal(client.get("doc"), null);
  await client.reconnect();
  assert.equal(client.get("doc"), null);
  assert.equal(api.read("u1", "doc").deleted, true);

  client.applyPush({ userId: "u1", id: "doc", text: "old live", version: 1, deleted: false });
  assert.equal(client.get("doc"), null);
});

test("out-of-order push events never let a lower version replace newer state, including delete tombstones", () => {
  const client = new SyncClient(new FakeSyncApi());
  client.switchUser("u1");

  client.applyPush({ userId: "u1", id: "doc", text: "v5", version: 5, deleted: false });
  client.applyPush({ userId: "u1", id: "doc", text: "v4", version: 4, deleted: false });
  assert.equal(client.get("doc").text, "v5");

  client.applyPush({ userId: "u1", id: "doc", version: 6, deleted: true });
  assert.equal(client.get("doc"), null);
  client.applyPush({ userId: "u1", id: "doc", text: "stale", version: 5, deleted: false });
  assert.equal(client.get("doc"), null);
});

test("a stale load response cannot overwrite a newer push version", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "server-v2", 2);
  api.queueDelay(20);
  const client = new SyncClient(api);
  client.switchUser("u1");

  const pending = client.load("doc");
  client.applyPush({ userId: "u1", id: "doc", text: "push-v5", version: 5, deleted: false });

  const loaded = await pending;
  assert.equal(loaded.text, "push-v5");
  assert.equal(client.get("doc").text, "push-v5");
  assert.equal(client.get("doc").version, 5);
});

test("push events for another user do not affect the current user's visible or future cached state", () => {
  const client = new SyncClient(new FakeSyncApi());
  client.switchUser("u1");
  client.applyPush({ userId: "u1", id: "doc", text: "mine", version: 2, deleted: false });

  client.applyPush({ userId: "u2", id: "doc", text: "theirs", version: 99, deleted: false });
  assert.equal(client.get("doc").text, "mine");

  client.switchUser("u2");
  assert.equal(client.get("doc"), null);
});

test("an operation enqueued while an empty flush is settling is not stranded", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "base", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");

  const emptyFlush = client.flush();
  client.edit("doc", "same tick");
  await emptyFlush;
  await client.flush();

  assert.equal(api.read("u1", "doc").text, "same tick");
  assert.equal(client.outbox.pending().length, 0);
});

test("direct cache invalidation also prevents a detached in-flight read from repopulating client state", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "server", 1);
  api.queueDelay(20);
  const client = new SyncClient(api);
  client.switchUser("u1");

  const pending = client.load("doc");
  client.cache.invalidate("u1", "doc");
  assert.equal(await pending, null);
  assert.equal(client.get("doc"), null);

  const fresh = await client.load("doc");
  assert.equal(fresh.text, "server");
  assert.equal(api.calls.filter((call) => call.type === "fetch").length, 2);
});

test("offline queues for different users sharing an id remain isolated while preserving global FIFO send order", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "a0", 1);
  api.seed("u2", "doc", "b0", 1);
  const client = new SyncClient(api);
  client.setOnline(false);

  client.switchUser("u1");
  client.edit("doc", "a1");
  client.switchUser("u2");
  client.edit("doc", "b1");

  await client.reconnect();
  const mutations = api.calls.filter((call) => call.opId);
  assert.deepEqual(mutations.map((call) => [call.userId, call.id, call.text]), [
    ["u1", "doc", "a1"],
    ["u2", "doc", "b1"]
  ]);
  assert.equal(client.get("doc").text, "b1");

  client.switchUser("u1");
  assert.equal(client.get("doc").text, "a1");
  assert.equal(api.read("u1", "doc").text, "a1");
  assert.equal(api.read("u2", "doc").text, "b1");
  assert.equal(client.outbox.pending().length, 0);
});
