import test from "node:test";
import assert from "node:assert/strict";
import {
  createTreeModel,
  createVariationSeed,
  getTreePalette,
  normalizeTreeOptions
} from "../src/tree-model.js";

test("same seed and controls reproduce the complete procedural model", () => {
  const options = { seed: "oak-17", angle: 31, depth: 8, length: 145, leaves: true, flowers: true };
  assert.deepEqual(createTreeModel(options), createTreeModel(options));
});

test("branch angle changes recursive geometry without changing complexity", () => {
  const narrow = createTreeModel({ seed: "angle", angle: 14, depth: 7 });
  const wide = createTreeModel({ seed: "angle", angle: 50, depth: 7 });
  assert.equal(narrow.branches.length, wide.branches.length);
  assert.notEqual(narrow.branches[2].x2, wide.branches[2].x2);
  assert.notEqual(narrow.bounds.width, wide.bounds.width);
});

test("recursion depth changes complexity according to a binary fractal", () => {
  for (const depth of [2, 5, 8, 11]) {
    const model = createTreeModel({ seed: "depth", depth, leaves: false });
    assert.equal(model.branches.length, 2 ** depth - 1);
    assert.equal(model.levels.length, depth);
  }
});

test("branch length scales trunk and overall geometry", () => {
  const short = createTreeModel({ seed: "length", length: 80, depth: 7 });
  const long = createTreeModel({ seed: "length", length: 200, depth: 7 });
  assert.equal(short.branches[0].length, 80);
  assert.equal(long.branches[0].length, 200);
  assert.ok(long.bounds.height > short.bounds.height * 2);
});

test("different seeds create different geometry and regenerate derives a new reproducible seed", () => {
  const nextSeed = createVariationSeed("42", "fixed-entropy");
  assert.notEqual(nextSeed, "42");
  assert.equal(nextSeed, createVariationSeed("42", "fixed-entropy"));
  assert.notDeepEqual(
    createTreeModel({ seed: "42", depth: 7 }).branches,
    createTreeModel({ seed: nextSeed, depth: 7 }).branches
  );
});

test("palette selection resolves to actual distinct rendering colors", () => {
  assert.notEqual(getTreePalette("forest").backgroundTop, getTreePalette("dusk").backgroundTop);
  assert.notEqual(getTreePalette("forest").leaf, getTreePalette("blossom").leaf);
  assert.equal(getTreePalette("missing"), getTreePalette("forest"));
});

test("leaf and flower toggles change generated overlay collections only", () => {
  const base = { seed: "overlay", depth: 8 };
  const bare = createTreeModel({ ...base, leaves: false, flowers: false });
  const leafy = createTreeModel({ ...base, leaves: true, flowers: false });
  const blooming = createTreeModel({ ...base, leaves: false, flowers: true });

  assert.equal(bare.leaves.length, 0);
  assert.equal(bare.flowers.length, 0);
  assert.ok(leafy.leaves.length > 0);
  assert.equal(leafy.flowers.length, 0);
  assert.equal(blooming.leaves.length, 0);
  assert.ok(blooming.flowers.length > 0);
  assert.deepEqual(bare.branches, leafy.branches);
  assert.deepEqual(bare.branches, blooming.branches);
});

test("high recursion depth remains bounded at 2047 branches and capped overlays", () => {
  const model = createTreeModel({ seed: "ultra", depth: 11, leaves: true, flowers: true });
  assert.equal(model.branches.length, 2047);
  assert.ok(model.leaves.length <= 720);
  assert.ok(model.flowers.length <= 220);
});

test("options are clamped and unknown palettes fall back safely", () => {
  const options = normalizeTreeOptions({ depth: 99, length: 10, angle: 1, palette: "unknown" });
  assert.equal(options.depth, 11);
  assert.equal(options.length, 70);
  assert.equal(options.angle, 10);
  assert.equal(options.palette, "forest");
});
