import test from "node:test";
import assert from "node:assert/strict";
import {
  FIXED_DT,
  MAX_FRAME_DELTA,
  advanceBiome,
  applyGust,
  applyRain,
  averageMoisture,
  createBiome,
  getGeometrySignature,
  gustInfluenceAt,
  loadSnapshot,
  moistureAt,
  normalizeOptions,
  plantBend,
  resetBiome,
  saveSnapshot,
  setDensity,
  setPaused,
  setSeason,
  setTimeOfDay,
  setWind,
  stepBiome
} from "../src/simulation.js";

function simulate(world, seconds, fps = 60) {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i += 1) advanceBiome(world, 1 / fps);
  return world;
}

function meanGrowth(world, ids = null) {
  const allowed = ids ? new Set(ids) : null;
  let total = 0;
  let count = 0;
  for (const plant of world.plants) {
    if (allowed && !allowed.has(plant.id)) continue;
    total += plant.growth;
    count += 1;
  }
  return total / count;
}

function variance(values) {
  let total = 0;
  for (const value of values) total += value;
  const mean = total / values.length;
  let squares = 0;
  for (const value of values) squares += (value - mean) ** 2;
  return squares / values.length;
}

test("same seed and settings create the same complete initial biome", () => {
  const options = { seed: "same", density: 320, wind: 0.4, season: "summer", timeOfDay: 18.25 };
  assert.deepEqual(saveSnapshot(createBiome(options)), saveSnapshot(createBiome(options)));
});

test("density controls actual population and supports multiple vegetation forms", () => {
  const sparse = createBiome({ seed: "forms", density: 300 });
  const dense = createBiome({ seed: "forms", density: 1800 });
  assert.equal(sparse.plants.length, 300);
  assert.equal(dense.plants.length, 1800);
  assert.deepEqual(new Set(dense.plants.map((plant) => plant.species)), new Set(["grass", "flower", "stem"]));
});

test("30/60/120 FPS render chunking produces equivalent deterministic state", () => {
  function run(fps) {
    const world = createBiome({ seed: "chunking", density: 180, wind: 0.52 });
    applyRain(world, 0.34, 0.72, 1.1, 0.13);
    applyGust(world, 0.42, 0.69, 1.05, 1, -0.12);
    simulate(world, 2, fps);
    return saveSnapshot(world);
  }
  assert.deepEqual(run(30), run(60));
  assert.deepEqual(run(60), run(120));
});

test("large render stalls are bounded without simulation explosion", () => {
  const world = createBiome({ density: 80 });
  const result = advanceBiome(world, 8);
  assert.equal(result.acceptedDelta, MAX_FRAME_DELTA);
  assert.equal(result.steps, Math.round(MAX_FRAME_DELTA / FIXED_DT));
  assert.equal(world.time, MAX_FRAME_DELTA);
});

test("pause freezes time, growth, moisture, gust decay and rain lifetime", () => {
  const world = createBiome({ seed: "pause", density: 120 });
  applyGust(world, 0.5, 0.7, 1, 1, 0);
  applyRain(world, 0.5, 0.7, 1, 0.12);
  stepBiome(world, 0.5);
  setPaused(world, true);
  const frozen = saveSnapshot(world);
  advanceBiome(world, 10);
  assert.deepEqual(saveSnapshot(world), frozen);
});

test("resume discards paused wall time instead of accumulating a giant delta", () => {
  const world = createBiome({ density: 80 });
  setPaused(world, true);
  advanceBiome(world, 10);
  setPaused(world, false);
  advanceBiome(world, 1 / 60);
  assert.equal(world.time, 1 / 60);
});

test("plants visibly begin as sprouts and grow over simulation time", () => {
  const world = createBiome({ seed: "sprout", density: 120 });
  const before = meanGrowth(world);
  assert.ok(before < 0.14);
  simulate(world, 5, 60);
  assert.ok(meanGrowth(world) > before + 0.16);
});

test("ambient wind is plant-specific rather than perfectly synchronized", () => {
  const world = createBiome({ seed: "wind", density: 160, wind: 1 });
  stepBiome(world, 0.8);
  const bends = world.plants.slice(0, 20).map((plant) => plantBend(world, plant).toFixed(5));
  assert.ok(new Set(bends).size > 12);
});

test("local gust is spatially bounded", () => {
  const world = createBiome({ wind: 0, density: 80 });
  applyGust(world, 0.5, 0.7, 1.2, 1, 0);
  const near = gustInfluenceAt(world, 0.5, 0.7);
  const far = gustInfluenceAt(world, 0.05, 0.08);
  assert.ok(near > 0.6);
  assert.equal(far, 0);
});

test("gust propagates, expands, decays and is eventually removed", () => {
  const world = createBiome({ wind: 0, density: 80 });
  applyGust(world, 0.4, 0.7, 1, 1, 0);
  const initial = { ...world.gusts[0] };
  simulate(world, 0.8, 120);
  assert.ok(world.gusts[0].x > initial.x);
  assert.ok(world.gusts[0].radius > initial.radius);
  assert.ok(world.gusts[0].strength < initial.strength);
  simulate(world, 3, 120);
  assert.equal(world.gusts.length, 0);
});

test("rain increases local soil moisture without globally watering the world", () => {
  const world = createBiome({ seed: "rain-local", density: 100 });
  const nearBefore = moistureAt(world, 0.5, 0.7);
  const farBefore = moistureAt(world, 0.05, 0.05);
  applyRain(world, 0.5, 0.7, 1.25, 0.11);
  const nearAfter = moistureAt(world, 0.5, 0.7);
  const farAfter = moistureAt(world, 0.05, 0.05);
  assert.ok(nearAfter > nearBefore + 0.25);
  assert.equal(farAfter, farBefore);
});

test("moisture diffuses and evaporates over time", () => {
  const world = createBiome({ seed: "diffusion", density: 80, season: "summer" });
  applyRain(world, 0.52, 0.73, 1.4, 0.08);
  const varianceAfterRain = variance(world.moisture.cells);
  const averageAfterRain = averageMoisture(world);
  simulate(world, 6, 120);
  assert.ok(variance(world.moisture.cells) < varianceAfterRain);
  assert.ok(averageMoisture(world) < averageAfterRain);
});

test("locally wetter plants grow faster than the same plants in a dry continuation", () => {
  const dry = createBiome({ seed: "growth-water", density: 360, season: "spring" });
  const wet = createBiome({ seed: "growth-water", density: 360, season: "spring" });
  const ids = wet.plants.filter((plant) => Math.hypot(plant.x - 0.5, plant.y - 0.72) < 0.16).map((plant) => plant.id);
  assert.ok(ids.length > 8);
  applyRain(wet, 0.5, 0.72, 1.5, 0.2);
  simulate(dry, 6, 60);
  simulate(wet, 6, 60);
  assert.ok(meanGrowth(wet, ids) > meanGrowth(dry, ids) + 0.035);
});

test("snapshot is deeply independent from later live-world mutation", () => {
  const world = createBiome({ seed: "snapshot", density: 90 });
  applyRain(world, 0.5, 0.7, 1, 0.12);
  applyGust(world, 0.4, 0.7, 1, 1, 0);
  const snapshot = saveSnapshot(world);
  const preserved = structuredClone(snapshot);
  world.plants[0].growth = 0.999;
  world.moisture.cells[0] = 1.4;
  world.gusts[0].strength = 0.01;
  world.options.wind = 0;
  assert.deepEqual(snapshot, preserved);
});

test("loading restores actual simulation state without retaining snapshot aliases", () => {
  const world = createBiome({ seed: "restore", density: 90 });
  applyRain(world, 0.3, 0.74, 1.1, 0.12);
  applyGust(world, 0.5, 0.7, 0.9, -1, 0.1);
  simulate(world, 0.7, 60);
  const snapshot = saveSnapshot(world);
  const restored = loadSnapshot(snapshot);
  assert.deepEqual(saveSnapshot(restored), snapshot);
  restored.plants[0].growth = 0.91;
  restored.moisture.cells[0] = 1.3;
  assert.notEqual(restored.plants[0].growth, snapshot.plants[0].growth);
  assert.notEqual(restored.moisture.cells[0], snapshot.moisture.cells[0]);
});

test("save -> evolve -> load -> continue matches deterministic reference continuation", () => {
  const world = createBiome({ seed: "continue", density: 140, wind: 0.42 });
  applyRain(world, 0.4, 0.75, 1, 0.1);
  simulate(world, 1.1, 60);
  const snapshot = saveSnapshot(world);
  simulate(world, 2.2, 30);
  applyGust(world, 0.75, 0.72, 1.2, -1, 0);

  const restored = loadSnapshot(snapshot);
  const reference = loadSnapshot(snapshot);
  applyGust(restored, 0.62, 0.68, 0.85, 1, 0.05);
  applyGust(reference, 0.62, 0.68, 0.85, 1, 0.05);
  simulate(restored, 1.8, 30);
  simulate(reference, 1.8, 120);
  assert.deepEqual(saveSnapshot(restored), saveSnapshot(reference));
});

test("same ordered events and simulated time replay deterministically", () => {
  function replay(fps) {
    const world = createBiome({ seed: "replay", density: 110, wind: 0.38 });
    applyGust(world, 0.25, 0.68, 0.8, 1, 0.2);
    simulate(world, 0.5, fps);
    applyRain(world, 0.63, 0.74, 1.1, 0.12);
    simulate(world, 0.8, fps);
    applyGust(world, 0.7, 0.69, 1.1, -1, -0.1);
    simulate(world, 1.2, fps);
    return saveSnapshot(world);
  }
  assert.deepEqual(replay(30), replay(120));
});

test("reset returns the current seed/settings to a reproducible clean baseline", () => {
  const world = createBiome({ seed: "reset", density: 130, wind: 0.6, season: "autumn", timeOfDay: 21 });
  applyRain(world, 0.5, 0.7, 1.4, 0.13);
  applyGust(world, 0.5, 0.7, 1.1, 1, 0);
  simulate(world, 2, 60);
  assert.deepEqual(saveSnapshot(resetBiome(world)), saveSnapshot(createBiome(world.options)));
});

test("a genuinely new seed creates a different geometry", () => {
  const a = createBiome({ seed: "variation-a", density: 120 });
  const b = createBiome({ seed: "variation-b", density: 120 });
  assert.notDeepEqual(getGeometrySignature(a), getGeometrySignature(b));
});

test("season, time and wind controls preserve procedural geometry identity", () => {
  const world = createBiome({ seed: "geometry", density: 220 });
  const geometry = getGeometrySignature(world);
  setSeason(world, "winter");
  setTimeOfDay(world, 2.5);
  setWind(world, 0.9);
  assert.deepEqual(getGeometrySignature(world), geometry);
});

test("density adjustment changes population while preserving surviving plant geometry/state", () => {
  const world = createBiome({ seed: "density-live", density: 300 });
  const preserved = new Map(world.plants.slice(0, 40).map((plant) => [plant.id, plant]));
  setDensity(world, 1800);
  assert.equal(world.plants.length, 1800);
  for (const [id, plant] of preserved) assert.equal(world.plants.find((candidate) => candidate.id === id), plant);
});


test("transient visual/interaction effects stay bounded under dense input streams", () => {
  const world = createBiome({ seed: "bounded-effects", density: 120 });
  for (let i = 0; i < 80; i += 1) {
    applyGust(world, (i % 10) / 10, 0.7, 0.8, 1, 0);
    applyRain(world, (i % 12) / 12, 0.72, 0.7, 0.08);
  }
  assert.ok(world.gusts.length <= 24);
  assert.ok(world.rainBursts.length <= 20);
});

test("high-density world is structurally valid at the supported ceiling", () => {
  const world = createBiome({ seed: "high-density", density: 2400 });
  assert.equal(world.plants.length, 2400);
  assert.equal(new Set(world.plants.map((plant) => plant.id)).size, 2400);
  assert.ok(world.plants.every((plant) => plant.x >= 0 && plant.x <= 1 && plant.y >= 0.34 && plant.y < 1));
  assert.deepEqual(new Set(world.plants.map((plant) => plant.species)), new Set(["grass", "flower", "stem"]));
});

test("simulation stepping mutates cached plant state in place instead of rebuilding the world", () => {
  const world = createBiome({ seed: "identity", density: 100 });
  const plant = world.plants[0];
  stepBiome(world, 0.5);
  assert.equal(world.plants[0], plant);
});

test("options clamp to product limits", () => {
  const options = normalizeOptions({ density: 9999, wind: 4, season: "desert", timeOfDay: 99 });
  assert.equal(options.density, 2400);
  assert.equal(options.wind, 1);
  assert.equal(options.season, "spring");
  assert.equal(options.timeOfDay, 24);
});
