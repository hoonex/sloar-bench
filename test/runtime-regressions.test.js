import test from "node:test";
import assert from "node:assert/strict";
import { formatRulerLabel, isPrematureCaptureLoss } from "../src/runtime-fixes.js";

test("subsecond ruler labels remain distinguishable", () => {
  assert.equal(formatRulerLabel(0), "0s");
  assert.equal(formatRulerLabel(0.125), "0.125s");
  assert.equal(formatRulerLabel(0.5), "0.5s");
  assert.equal(formatRulerLabel(1.25), "1.25s");
  assert.equal(formatRulerLabel(12), "12s");
  assert.equal(formatRulerLabel(61), "1:01");
});

test("pointer continuity guard only repairs active unintentional clip capture loss", () => {
  assert.equal(isPrematureCaptureLoss({ active: true, intentional: false, targetIsClip: true }), true);
  assert.equal(isPrematureCaptureLoss({ active: false, intentional: false, targetIsClip: true }), false);
  assert.equal(isPrematureCaptureLoss({ active: true, intentional: true, targetIsClip: true }), false);
  assert.equal(isPrematureCaptureLoss({ active: true, intentional: false, targetIsClip: false }), false);
});
