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

async function turn() {
  await new Promise((resolve) => setImmediate(resolve));
}

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

test("same document id is isolated across users and late user A load cannot contaminate user B", async () => {
  const aFetch = deferred();
  const calls = [];
  const api = {
    fetchDoc({ userId, id }) {
      calls.push({ userId, id });
      if (userId === "u1") return aFetch.promise;
      return Promise.resolve({ id, text: "bravo", version: 1, deleted: false });
    },
    async mutate() {
      throw new Error("not used");
    }
  };
  const client = new SyncClient(api);

  client.switchUser("u1");
  const aLoad = client.load("doc");
  await turn();

  client.switchUser("u2");
  const bLoad = client.load("doc");
  await turn();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.userId), ["u1", "u2"]);
  assert.equal((await bLoad).text, "bravo");
  assert.equal(client.get("doc").text, "bravo");

  aFetch.resolve({ id: "doc", text: "alpha", version: 1, deleted: false });
  assert.equal((await aLoad).text, "alpha");
  assert.equal(client.get("doc").text, "bravo");

  client.switchUser("u1");
  assert.equal(client.get("doc").text, "alpha");
});

test("entity keys do not collide even when user/document strings contain delimiters", async () => {
  const api = new FakeSyncApi();
  api.seed("a:b", "c", "first", 1);
  api.seed("a", "b:c", "second", 1);
  const client = new SyncClient(api);

  client.switchUser("a:b");
  assert.equal((await client.load("c")).text, "first");
  client.switchUser("a");
  assert.equal((await client.load("b:c")).text, "second");
  assert.equal(client.get("b:c").text, "second");
});

test("failed fetch is evicted from in-flight cache and can be retried", async () => {
  let attempts = 0;
  const api = {
    async fetchDoc({ id }) {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary fetch failure");
      return { id, text: "recovered", version: 2, deleted: false };
    },
    async mutate() {
      throw new Error("not used");
    }
  };
  const client = new SyncClient(api);
  client.switchUser("u1");

  await assert.rejects(client.load("doc"), /temporary fetch failure/);
  const value = await client.load("doc");
  assert.equal(value.text, "recovered");
  assert.equal(attempts, 2);
});

test("logout invalidates and fences an older in-flight load", async () => {
  const firstFetch = deferred();
  let calls = 0;
  const api = {
    fetchDoc({ id }) {
      calls += 1;
      if (calls === 1) return firstFetch.promise;
      return Promise.resolve({ id, text: "fresh", version: 2, deleted: false });
    },
    async mutate() {
      throw new Error("not used");
    }
  };
  const client = new SyncClient(api);
  client.switchUser("u1");

  const staleLoad = client.load("doc");
  await turn();
  client.logout();
  firstFetch.resolve({ id: "doc", text: "stale", version: 1, deleted: false });
  assert.equal((await staleLoad).text, "stale");

  client.switchUser("u1");
  assert.equal(client.get("doc"), null);
  assert.equal((await client.load("doc")).text, "fresh");
  assert.equal(calls, 2);
});

test("older mutation success cannot overwrite a newer optimistic edit", async () => {
  const pending = [];
  const api = {
    async fetchDoc({ id }) {
      return { id, text: "old", version: 1, deleted: false };
    },
    mutate(operation) {
      const gate = deferred();
      pending.push({ operation, gate });
      return gate.promise;
    }
  };
  const client = new SyncClient(api);
  client.switchUser("u1");
  await client.load("doc");
  client.setOnline(false);
  client.edit("doc", "first");
  client.edit("doc", "second");

  const flushing = client.reconnect();
  await turn();
  assert.equal(pending.length, 1);
  pending[0].gate.resolve({ id: "doc", text: "first", version: 2, deleted: false });
  await turn();
  assert.equal(client.get("doc").text, "second");
  assert.equal(pending.length, 2);

  pending[1].gate.resolve({ id: "doc", text: "second", version: 3, deleted: false });
  await flushing;
  assert.equal(client.get("doc").text, "second");
  assert.equal(client.outbox.pending().length, 0);
});

test("failure rollback from an older mutation cannot overwrite a newer edit", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "old", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");
  await client.load("doc");
  client.setOnline(false);
  client.edit("doc", "first");
  client.edit("doc", "second");
  api.failNext("before");

  await assert.rejects(client.reconnect(), /temporary failure before apply/);
  assert.equal(client.get("doc").text, "second");
  assert.equal(client.outbox.pending().length, 2);

  await client.flush();
  assert.equal(api.read("u1", "doc").text, "second");
  assert.equal(client.get("doc").text, "second");
  assert.equal(client.outbox.pending().length, 0);
});

test("retry after network failure-after-apply reuses one mutation id and does not double apply", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "old", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");
  await client.load("doc");
  client.setOnline(false);
  client.edit("doc", "once");
  const [queued] = client.outbox.pending();
  api.failNext("after");

  await assert.rejects(client.reconnect(), /temporary failure after apply/);
  assert.equal(api.read("u1", "doc").version, 2);
  assert.equal(client.outbox.pending().length, 1);

  await client.flush();
  const mutationCalls = api.calls.filter((call) => call.type === "mutate");
  assert.equal(mutationCalls.length, 2);
  assert.equal(mutationCalls[0].opId, queued.opId);
  assert.equal(mutationCalls[1].opId, queued.opId);
  assert.equal(api.appliedOps.size, 1);
  assert.equal(api.read("u1", "doc").version, 2);
  assert.equal(api.read("u1", "doc").text, "once");
  assert.equal(client.outbox.pending().length, 0);
});

test("offline queue preserves operation order and final state across reconnect", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "old", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");
  await client.load("doc");
  client.setOnline(false);

  client.edit("doc", "one");
  client.edit("doc", "two");
  client.remove("doc");
  client.edit("doc", "three");
  assert.equal(client.get("doc").text, "three");

  await client.reconnect();
  const mutations = api.calls.filter((call) => call.type === "mutate");
  assert.deepEqual(
    mutations.map((call) => call.operationType === "delete" ? "delete" : call.text),
    ["one", "two", "delete", "three"]
  );
  assert.equal(api.read("u1", "doc").text, "three");
  assert.equal(api.read("u1", "doc").deleted, false);
  assert.equal(api.read("u1", "doc").version, 5);
  assert.equal(client.get("doc").text, "three");
  assert.equal(client.outbox.pending().length, 0);
});

test("outbox can flush again after an earlier flush completed", async () => {
  const api = new FakeSyncApi();
  api.seed("u1", "doc", "old", 1);
  const client = new SyncClient(api);
  client.switchUser("u1");
  await client.load("doc");
  client.setOnline(false);

  client.edit("doc", "first");
  await client.reconnect();
  assert.equal(client.outbox.pending().length, 0);

  client.edit("doc", "second");
  await client.flush();
  assert.equal(api.read("u1", "doc").text, "second");
  assert.equal(api.read("u1", "doc").version, 3);
  assert.equal(client.outbox.pending().length, 0);
});

test("delete tombstone is not revived by an older in-flight load", async () => {
  const fetchGate = deferred();
  const api = {
    fetchDoc() {
      return fetchGate.promise;
    },
    async mutate(operation) {
      return { id: operation.id, text: "old", version: 2, deleted: true };
    }
  };
  const client = new SyncClient(api);
  client.switchUser("u1");

  const load = client.load("doc");
  await turn();
  client.setOnline(false);
  client.remove("doc");
  fetchGate.resolve({ id: "doc", text: "old", version: 1, deleted: false });
  await load;

  assert.equal(client.get("doc"), null);
  client.applyPush({ userId: "u1", id: "doc", text: "old", version: 1, deleted: false });
  assert.equal(client.get("doc"), null);
});

test("out-of-order push events never let a lower version overwrite newer state or revive a delete", () => {
  const api = new FakeSyncApi();
  const client = new SyncClient(api);
  client.switchUser("u1");

  assert.equal(client.applyPush({ userId: "u1", id: "doc", text: "v5", version: 5, deleted: false }), true);
  assert.equal(client.applyPush({ userId: "u1", id: "doc", text: "v3", version: 3, deleted: false }), false);
  assert.equal(client.get("doc").text, "v5");

  assert.equal(client.applyPush({ userId: "u1", id: "doc", text: "v5", version: 6, deleted: true }), true);
  assert.equal(client.get("doc"), null);
  assert.equal(client.applyPush({ userId: "u1", id: "doc", text: "revive", version: 5, deleted: false }), false);
  assert.equal(client.get("doc"), null);
});

test("push for another user cannot affect current visible state or populate that user's state", () => {
  const api = new FakeSyncApi();
  const client = new SyncClient(api);
  client.switchUser("u2");
  client.applyPush({ userId: "u2", id: "doc", text: "bravo", version: 2, deleted: false });

  assert.equal(client.applyPush({ userId: "u1", id: "doc", text: "alpha", version: 99, deleted: false }), false);
  assert.equal(client.get("doc").text, "bravo");

  client.switchUser("u1");
  assert.equal(client.get("doc"), null);
});

test("newer push fences an older in-flight load response", async () => {
  const fetchGate = deferred();
  const api = {
    fetchDoc() {
      return fetchGate.promise;
    },
    async mutate() {
      throw new Error("not used");
    }
  };
  const client = new SyncClient(api);
  client.switchUser("u1");

  const load = client.load("doc");
  await turn();
  client.applyPush({ userId: "u1", id: "doc", text: "push-v5", version: 5, deleted: false });
  fetchGate.resolve({ id: "doc", text: "load-v3", version: 3, deleted: false });

  assert.equal((await load).text, "push-v5");
  assert.equal(client.get("doc").text, "push-v5");
});

test("newer push is preserved behind an optimistic edit and becomes rollback target on failure", async () => {
  const mutationGate = deferred();
  const api = {
    async fetchDoc({ id }) {
      return { id, text: "base", version: 1, deleted: false };
    },
    mutate() {
      return mutationGate.promise;
    }
  };
  const client = new SyncClient(api);
  client.switchUser("u1");
  await client.load("doc");
  client.setOnline(false);
  client.edit("doc", "optimistic");

  const flushing = client.reconnect();
  await turn();
  client.applyPush({ userId: "u1", id: "doc", text: "remote-v2", version: 2, deleted: false });
  assert.equal(client.get("doc").text, "optimistic");

  mutationGate.reject(new Error("mutation failed"));
  await assert.rejects(flushing, /mutation failed/);
  assert.equal(client.get("doc").text, "remote-v2");
});

test("rapid edits in the same millisecond still get distinct idempotency keys", () => {
  const originalNow = Date.now;
  Date.now = () => 1234567890;
  try {
    const api = new FakeSyncApi();
    const client = new SyncClient(api);
    client.switchUser("u1");
    client.setOnline(false);
    client.edit("doc", "one");
    client.edit("doc", "two");

    const [first, second] = client.outbox.pending();
    assert.notEqual(first.opId, second.opId);
  } finally {
    Date.now = originalNow;
  }
});

test("logout fences an in-flight mutation response from repopulating invalidated state", async () => {
  const mutationGate = deferred();
  const api = {
    async fetchDoc({ id }) {
      return { id, text: "base", version: 1, deleted: false };
    },
    mutate() {
      return mutationGate.promise;
    }
  };
  const client = new SyncClient(api);
  client.switchUser("u1");
  await client.load("doc");
  client.setOnline(false);
  client.edit("doc", "pending");

  const flushing = client.reconnect();
  await turn();
  client.logout();
  mutationGate.resolve({ id: "doc", text: "pending", version: 2, deleted: false });
  await flushing;

  client.switchUser("u1");
  assert.equal(client.get("doc"), null);
});

test("a fresh load started after logout invalidation is not stolen or cleared by the older request", async () => {
  const staleGate = deferred();
  const freshGate = deferred();
  let calls = 0;
  const api = {
    fetchDoc() {
      calls += 1;
      return calls === 1 ? staleGate.promise : freshGate.promise;
    },
    async mutate() {
      throw new Error("not used");
    }
  };
  const client = new SyncClient(api);
  client.switchUser("u1");

  const staleLoad = client.load("doc");
  await turn();
  client.logout();
  client.switchUser("u1");
  const freshLoad = client.load("doc");
  await turn();
  assert.equal(calls, 2);

  staleGate.resolve({ id: "doc", text: "stale", version: 1, deleted: false });
  await staleLoad;
  assert.equal(client.get("doc"), null);

  freshGate.resolve({ id: "doc", text: "fresh", version: 2, deleted: false });
  assert.equal((await freshLoad).text, "fresh");
  assert.equal(client.get("doc").text, "fresh");
});
