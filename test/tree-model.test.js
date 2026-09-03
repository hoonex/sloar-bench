import test from "node:test";
import assert from "node:assert/strict";
import { createTreeModel, normalizeTreeOptions } from "../src/tree-model.js";

test("the same seed and controls produce the same starter model", () => {
  assert.deepEqual(
    createTreeModel({ seed: 17, angle: 30, depth: 7, length: 140 }),
    createTreeModel({ seed: 17, angle: 30, depth: 7, length: 140 })
  );
});

test("branch angle changes the preview geometry", () => {
  const narrow = createTreeModel({ seed: 5, angle: 14 });
  const wide = createTreeModel({ seed: 5, angle: 50 });
  assert.notEqual(narrow.branches[1].x2, wide.branches[1].x2);
});

test("depth and length controls are clamped to the documented starter range", () => {
  const options = normalizeTreeOptions({ depth: 99, length: 10, angle: 1 });
  assert.equal(options.depth, 11);
  assert.equal(options.length, 70);
  assert.equal(options.angle, 10);
});

test("overlay and palette controls remain part of the model state", () => {
  const model = createTreeModel({ palette: "dusk", leaves: false, flowers: true });
  assert.equal(model.options.palette, "dusk");
  assert.equal(model.options.leaves, false);
  assert.equal(model.options.flowers, true);
});
