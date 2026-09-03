import test from "node:test";
import assert from "node:assert/strict";
import { DraftStore } from "../src/drafts.js";
import { createRemoteSaver } from "../src/remote.js";

test("a saved draft remains readable locally", async () => {
  const remote = createRemoteSaver([1]);
  const store = new DraftStore(remote);

  await store.update("note-1", "hello");
  assert.equal(store.get("note-1"), "hello");
});

test("different drafts do not interfere with each other", async () => {
  const remote = createRemoteSaver([10, 1]);
  const store = new DraftStore(remote);

  await Promise.all([
    store.update("a", "alpha"),
    store.update("b", "beta")
  ]);

  assert.equal(store.get("a"), "alpha");
  assert.equal(store.get("b"), "beta");
});

test("an older save acknowledgement never rolls back newer local input", async () => {
  const remote = createRemoteSaver([1, 20]);
  const store = new DraftStore(remote);

  const first = store.update("note-1", "first");
  const latest = store.update("note-1", "latest");

  assert.equal(store.get("note-1"), "latest");
  await first;
  assert.equal(store.get("note-1"), "latest");
  await latest;
  assert.equal(store.get("note-1"), "latest");
});

test("the latest update remains the final local and remote value", async () => {
  const remote = createRemoteSaver([20, 1]);
  const store = new DraftStore(remote);

  await Promise.all([
    store.update("note-1", "first"),
    store.update("note-1", "latest")
  ]);

  assert.equal(store.get("note-1"), "latest");
  assert.equal(remote.read("note-1"), "latest");
});
