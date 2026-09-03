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
