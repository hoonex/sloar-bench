import test from "node:test";
import assert from "node:assert/strict";
import {
  createRelayState,
  hydrateRelayState,
  selectAgent,
  selectedChangeCount,
  serializeRelayState,
  toggleChange
} from "../src/relay-state.js";

test("starts on the minimal proposal with two selected changes", () => {
  const state = createRelayState();
  assert.equal(state.activeAgent, "a");
  assert.equal(selectedChangeCount(state), 2);
});

test("switching proposals preserves each proposal's independent selection", () => {
  let state = createRelayState();
  state = toggleChange(state, 2);
  assert.equal(selectedChangeCount(state), 3);
  state = selectAgent(state, "b");
  assert.equal(selectedChangeCount(state), 2);
  state = selectAgent(state, "a");
  assert.equal(selectedChangeCount(state), 3);
});

test("serialized demo state round-trips", () => {
  let state = selectAgent(createRelayState(), "c");
  state = toggleChange(state, 1);
  const hydrated = hydrateRelayState(serializeRelayState(state));
  assert.equal(hydrated.activeAgent, "c");
  assert.equal(selectedChangeCount(hydrated), 2);
});

test("invalid persisted state falls back safely", () => {
  const state = hydrateRelayState("not-json");
  assert.equal(state.activeAgent, "a");
  assert.equal(selectedChangeCount(state), 2);
});
