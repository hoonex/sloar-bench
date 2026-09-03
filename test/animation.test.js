import test from "node:test";
import assert from "node:assert/strict";
import { branchGrowth, updateAnimatedGeometry, windBend } from "../src/animation.js";
import { createTreeModel } from "../src/tree-model.js";

test("growth lifecycle reveals lower levels before the canopy", () => {
  assert.equal(branchGrowth(0, 8, 0), 0);
  assert.ok(branchGrowth(0, 8, 0.25) > 0);
  assert.equal(branchGrowth(7, 8, 0.25), 0);
  assert.equal(branchGrowth(7, 8, 1), 1);
});

test("wind is time-varying ongoing motion, not a static offset", () => {
  const early = windBend(6, 1.23, 500, false);
  const later = windBend(6, 1.23, 1600, false);
  assert.notEqual(early, later);
});

test("reduced motion disables procedural sway", () => {
  assert.equal(windBend(8, 0.7, 500, true), 0);
  assert.equal(windBend(8, 0.7, 1800, true), 0);
});

test("animated branch geometry stays connected and changes over time", () => {
  const model = createTreeModel({ seed: "wind", depth: 7, leaves: false });
  const first = updateAnimatedGeometry(model, 500, false);
  const second = updateAnimatedGeometry(model, 1600, false);
  const child = model.branches[1];
  const parentOffset = child.parentIndex * 5;
  const childOffset = child.index * 5;

  assert.equal(first[childOffset], first[parentOffset + 2]);
  assert.equal(first[childOffset + 1], first[parentOffset + 3]);
  assert.notEqual(first[childOffset + 2], second[childOffset + 2]);
});

test("reduced-motion geometry is stable across time", () => {
  const model = createTreeModel({ seed: "still", depth: 6, leaves: false });
  assert.deepEqual(
    updateAnimatedGeometry(model, 100, true),
    updateAnimatedGeometry(model, 3000, true)
  );
});
