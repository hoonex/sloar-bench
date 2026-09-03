import test from "node:test";
import assert from "node:assert/strict";
import {
  createScheduleState,
  hydrateScheduleState,
  serializeScheduleState,
  visiblePanels
} from "../src/schedule-state.js";

test("defaults to Today only", () => {
  assert.deepEqual(visiblePanels(createScheduleState()), {
    today: true,
    week: false
  });
});

test("Week selection shows Week only", () => {
  assert.deepEqual(visiblePanels(createScheduleState("week")), {
    today: false,
    week: true
  });
});

test("current persisted format round-trips", () => {
  const raw = serializeScheduleState(createScheduleState("week"));
  assert.equal(hydrateScheduleState(raw).mode, "week");
});
