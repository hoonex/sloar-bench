import test from "node:test";
import assert from "node:assert/strict";
import { applyGust, createBiome, normalizeOptions, plantBend, stepBiome } from "../src/simulation.js";

test("same seed and options create the same initial biome", () => {
  assert.deepEqual(
    createBiome({ seed: "same", density: 80, wind: 0.4 }),
    createBiome({ seed: "same", density: 80, wind: 0.4 })
  );
});

test("density controls actual plant count", () => {
  assert.equal(createBiome({ density: 30 }).plants.length, 30);
  assert.equal(createBiome({ density: 450 }).plants.length, 450);
});

test("simulation time advances and pause freezes it", () => {
  const world = createBiome();
  stepBiome(world, 0.5);
  assert.equal(world.time, 0.5);
  world.paused = true;
  stepBiome(world, 1);
  assert.equal(world.time, 0.5);
});

test("wind contributes to visible plant bend", () => {
  const world = createBiome({ wind: 1, density: 30 });
  world.time = 0.75;
  assert.notEqual(plantBend(world, world.plants[0]), 0);
});

test("local gust affects nearby plants", () => {
  const world = createBiome({ wind: 0, density: 30 });
  const plant = world.plants[0];
  applyGust(world, plant.x, plant.y, 1);
  assert.ok(plantBend(world, plant) > 0.5);
});

test("options are clamped to fixture limits", () => {
  const options = normalizeOptions({ density: 9999, wind: 4, season: "winter" });
  assert.equal(options.density, 1200);
  assert.equal(options.wind, 1);
  assert.equal(options.season, "spring");
});
