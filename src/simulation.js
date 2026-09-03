export const FIXED_DT = 1 / 120;
export const MAX_FRAME_DELTA = 0.25;
export const MOISTURE_WIDTH = 32;
export const MOISTURE_HEIGHT = 18;

const EPSILON = 1e-12;
const SEASONS = new Set(["spring", "summer", "autumn", "winter"]);
const SPECIES = ["grass", "flower", "stem"];
const MAX_GUSTS = 24;
const MAX_RAIN_BURSTS = 20;
const RANDOM_MODEL = "stateless-seeded-v1";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteInteger(value, fallback) {
  return Math.round(finiteNumber(value, fallback));
}

export function hashSeed(seed) {
  const text = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mix32(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFor(seedHash, salt) {
  return mulberry32(mix32(seedHash ^ Math.imul(salt + 1, 0x9e3779b1)));
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeOptions(options = {}) {
  return {
    seed: String(options.seed ?? "meadow-42"),
    density: clamp(finiteInteger(options.density, 1500), 60, 2400),
    wind: clamp(finiteNumber(options.wind, 0.34), 0, 1),
    season: SEASONS.has(options.season) ? options.season : "spring",
    timeOfDay: clamp(finiteNumber(options.timeOfDay, 15.5), 0, 24)
  };
}

function createPlant(seedHash, index) {
  const random = randomFor(seedHash, index);
  const speciesRoll = random();
  const species = speciesRoll < 0.67 ? "grass" : speciesRoll < 0.87 ? "flower" : "stem";
  const y = 0.34 + Math.pow(random(), 0.72) * 0.645;
  const perspective = 0.58 + y * 0.58;
  const speciesScale = species === "grass" ? 0.82 + random() * 0.55 : species === "flower" ? 0.8 + random() * 0.45 : 0.95 + random() * 0.5;
  const initialGrowth = 0.035 + random() * 0.09;
  const x = random();
  const soilIndex = Math.floor(y * MOISTURE_HEIGHT) * MOISTURE_WIDTH + Math.floor(x * MOISTURE_WIDTH);

  return {
    id: index,
    species,
    x,
    y,
    soilIndex,
    baseHeight: (0.035 + random() * 0.092) * perspective * speciesScale,
    width: 0.55 + random() * 1.45,
    phase: random() * Math.PI * 2,
    frequency: 0.68 + random() * 0.82,
    lean: (random() - 0.5) * 0.26,
    variant: Math.floor(random() * 4),
    petals: 4 + Math.floor(random() * 4),
    headSize: 0.75 + random() * 0.75,
    leafSide: random() > 0.5 ? 1 : -1,
    growth: initialGrowth,
    vigor: 0.38 + random() * 0.18
  };
}

function createMoisture(seedHash) {
  const cells = new Float64Array(MOISTURE_WIDTH * MOISTURE_HEIGHT);
  const random = randomFor(seedHash, 0x51f15e);
  for (let i = 0; i < cells.length; i += 1) cells[i] = 0.16 + random() * 0.11;
  return {
    width: MOISTURE_WIDTH,
    height: MOISTURE_HEIGHT,
    cells,
    scratch: new Float64Array(cells.length)
  };
}

function createTerrain(seedHash) {
  const random = randomFor(seedHash, 0x2ab43f);
  return {
    ridgeA: random() * Math.PI * 2,
    ridgeB: random() * Math.PI * 2,
    ridgeC: random() * Math.PI * 2,
    haze: 0.35 + random() * 0.45
  };
}

function createStars(seedHash) {
  const random = randomFor(seedHash, 0x71a2c9);
  return Array.from({ length: 72 }, (_, id) => ({
    id,
    x: random(),
    y: 0.03 + random() * 0.5,
    size: 0.4 + random() * 1.25,
    phase: random() * Math.PI * 2
  }));
}

export function createBiome(options = {}) {
  const normalized = normalizeOptions(options);
  const seedHash = hashSeed(normalized.seed);
  const plants = Array.from({ length: normalized.density }, (_, index) => createPlant(seedHash, index));
  plants.sort((a, b) => a.y - b.y || a.id - b.id);

  return {
    version: 3,
    randomModel: RANDOM_MODEL,
    options: normalized,
    seedHash,
    tick: 0,
    time: 0,
    accumulator: 0,
    paused: false,
    eventSerial: 0,
    plants,
    moisture: createMoisture(seedHash),
    gusts: [],
    rainBursts: [],
    terrain: createTerrain(seedHash),
    stars: createStars(seedHash)
  };
}

function moistureIndex(grid, x, y) {
  const cx = clamp(Math.floor(clamp(x, 0, 0.999999) * grid.width), 0, grid.width - 1);
  const cy = clamp(Math.floor(clamp(y, 0, 0.999999) * grid.height), 0, grid.height - 1);
  return cy * grid.width + cx;
}

export function moistureAt(world, x, y) {
  return world.moisture.cells[moistureIndex(world.moisture, x, y)];
}

export function averageMoisture(world) {
  const cells = world.moisture.cells;
  let total = 0;
  for (let i = 0; i < cells.length; i += 1) total += cells[i];
  return total / cells.length;
}

function updateMoisture(world, dt) {
  const grid = world.moisture;
  const cells = grid.cells;
  const next = grid.scratch;
  const diffusion = 0.82;
  const evaporation = world.options.season === "summer" ? 0.032 : world.options.season === "winter" ? 0.011 : 0.02;
  const floor = 0.055;

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const index = y * grid.width + x;
      const value = cells[index];
      let sum = 0;
      let count = 0;
      if (x > 0) { sum += cells[index - 1]; count += 1; }
      if (x + 1 < grid.width) { sum += cells[index + 1]; count += 1; }
      if (y > 0) { sum += cells[index - grid.width]; count += 1; }
      if (y + 1 < grid.height) { sum += cells[index + grid.width]; count += 1; }
      const neighborAverage = count ? sum / count : value;
      const diffused = value + (neighborAverage - value) * diffusion * dt;
      next[index] = clamp(diffused - Math.max(0, diffused - floor) * evaporation * dt, floor, 1.5);
    }
  }

  grid.cells = next;
  grid.scratch = cells;
}

function updatePlants(world, dt) {
  const seasonGrowth = world.options.season === "spring" ? 1.08 : world.options.season === "summer" ? 0.96 : world.options.season === "autumn" ? 0.75 : 0.48;
  for (let i = 0; i < world.plants.length; i += 1) {
    const plant = world.plants[i];
    const localMoisture = world.moisture.cells[plant.soilIndex];
    const targetVigor = clamp(0.2 + localMoisture * 1.18, 0.18, 1.16);
    plant.vigor += (targetVigor - plant.vigor) * Math.min(1, dt * 0.92);
    const speciesRate = plant.species === "grass" ? 0.3 : plant.species === "flower" ? 0.245 : 0.215;
    const moistureBoost = 0.38 + clamp(localMoisture, 0, 1.2) * 1.35;
    const growthRate = speciesRate * seasonGrowth * moistureBoost;
    plant.growth = clamp(plant.growth + (1 - plant.growth) * growthRate * dt, 0, 1);
  }
}

function updateGusts(world, dt) {
  let write = 0;
  for (let read = 0; read < world.gusts.length; read += 1) {
    const gust = world.gusts[read];
    gust.age += dt;
    gust.x += gust.dirX * gust.speed * dt;
    gust.y += gust.dirY * gust.speed * dt * 0.55;
    gust.radius = Math.min(0.42, gust.baseRadius + gust.age * 0.11);
    gust.strength *= Math.exp(-2.55 * dt);
    if (gust.age < gust.life && gust.strength > 0.012 && gust.x > -0.5 && gust.x < 1.5 && gust.y > -0.5 && gust.y < 1.5) {
      world.gusts[write] = gust;
      write += 1;
    }
  }
  world.gusts.length = write;
}

function updateRainBursts(world, dt) {
  let write = 0;
  for (let read = 0; read < world.rainBursts.length; read += 1) {
    const burst = world.rainBursts[read];
    burst.age += dt;
    if (burst.age < burst.life) {
      world.rainBursts[write] = burst;
      write += 1;
    }
  }
  world.rainBursts.length = write;
}

function simulateFixedStep(world) {
  updateGusts(world, FIXED_DT);
  updateRainBursts(world, FIXED_DT);
  updateMoisture(world, FIXED_DT);
  updatePlants(world, FIXED_DT);
  world.tick += 1;
  world.time = world.tick * FIXED_DT;
}

export function advanceBiome(world, frameDeltaSeconds, maxFrameDelta = MAX_FRAME_DELTA) {
  const rawDelta = Math.max(0, finiteNumber(frameDeltaSeconds, 0));
  if (world.paused || rawDelta === 0) return { acceptedDelta: 0, droppedDelta: 0, steps: 0 };

  const safeMaxDelta = Math.max(0, finiteNumber(maxFrameDelta, MAX_FRAME_DELTA));
  const acceptedDelta = Math.min(rawDelta, safeMaxDelta);
  const droppedDelta = rawDelta - acceptedDelta;
  world.accumulator += acceptedDelta;
  const steps = Math.floor((world.accumulator + EPSILON) / FIXED_DT);
  if (steps > 0) {
    world.accumulator -= steps * FIXED_DT;
    if (Math.abs(world.accumulator) < EPSILON) world.accumulator = 0;
    for (let i = 0; i < steps; i += 1) simulateFixedStep(world);
  }
  return { acceptedDelta, droppedDelta, steps };
}

export function stepBiome(world, dtSeconds) {
  advanceBiome(world, dtSeconds, Number.POSITIVE_INFINITY);
  return world;
}

export function setPaused(world, paused) {
  world.paused = Boolean(paused);
  return world;
}

export function setWind(world, wind) {
  world.options.wind = clamp(finiteNumber(wind, world.options.wind), 0, 1);
  return world;
}

export function setSeason(world, season) {
  if (SEASONS.has(season)) world.options.season = season;
  return world;
}

export function setTimeOfDay(world, timeOfDay) {
  world.options.timeOfDay = clamp(finiteNumber(timeOfDay, world.options.timeOfDay), 0, 24);
  return world;
}

export function setDensity(world, density) {
  const target = clamp(finiteInteger(density, world.options.density), 60, 2400);
  if (target === world.options.density) return world;
  const byId = new Map(world.plants.map((plant) => [plant.id, plant]));
  const plants = new Array(target);
  for (let id = 0; id < target; id += 1) plants[id] = byId.get(id) ?? createPlant(world.seedHash, id);
  plants.sort((a, b) => a.y - b.y || a.id - b.id);
  world.plants = plants;
  world.options.density = target;
  return world;
}

export function applyGust(world, x, y, strength = 1, directionX = 1, directionY = 0) {
  const px = clamp(finiteNumber(x, 0), 0, 1);
  const py = clamp(finiteNumber(y, 0), 0, 1);
  const rawX = finiteNumber(directionX, 0);
  const rawY = finiteNumber(directionY, 0);
  const magnitude = Math.hypot(rawX, rawY);
  const dirX = magnitude > 1e-6 ? rawX / magnitude : 1;
  const dirY = magnitude > 1e-6 ? rawY / magnitude : 0;
  const normalizedStrength = clamp(finiteNumber(strength, 0), 0, 1.5);
  const id = world.eventSerial;
  world.eventSerial += 1;
  if (world.gusts.length >= MAX_GUSTS) world.gusts.splice(0, world.gusts.length - MAX_GUSTS + 1);
  world.gusts.push({
    id,
    x: px,
    y: py,
    dirX,
    dirY,
    strength: normalizedStrength,
    initialStrength: normalizedStrength,
    speed: 0.075 + normalizedStrength * 0.105,
    baseRadius: 0.105 + normalizedStrength * 0.035,
    radius: 0.105 + normalizedStrength * 0.035,
    age: 0,
    life: 2.6
  });
  return world;
}

function smoothFalloff(distance, radius) {
  if (radius <= 0 || distance >= radius) return 0;
  const t = 1 - distance / radius;
  return t * t * (3 - 2 * t);
}

export function gustVectorAt(world, x, y) {
  let influenceX = 0;
  let influenceY = 0;
  for (let i = 0; i < world.gusts.length; i += 1) {
    const gust = world.gusts[i];
    const dx = x - gust.x;
    const dy = y - gust.y;
    const radiusSquared = gust.radius * gust.radius;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= radiusSquared) continue;
    const falloff = smoothFalloff(Math.sqrt(distanceSquared), gust.radius);
    const pulse = 0.94 + Math.sin(gust.age * 8 + gust.id * 0.91) * 0.06;
    const strength = gust.strength * falloff * pulse;
    influenceX += gust.dirX * strength;
    influenceY += gust.dirY * strength;
  }
  return {
    x: clamp(influenceX, -1.25, 1.25),
    y: clamp(influenceY, -1.25, 1.25)
  };
}

export function gustInfluenceAt(world, x, y) {
  return clamp(gustVectorAt(world, x, y).x * 0.78, -0.92, 0.92);
}

export function applyRain(world, x, y, intensity = 1, radius = 0.105) {
  const px = clamp(finiteNumber(x, 0), 0, 1);
  const py = clamp(finiteNumber(y, 0), 0, 1);
  const normalizedIntensity = clamp(finiteNumber(intensity, 0), 0, 1.5);
  const normalizedRadius = clamp(finiteNumber(radius, 0.105), 0.035, 0.28);
  const grid = world.moisture;
  const minX = clamp(Math.floor((px - normalizedRadius) * grid.width), 0, grid.width - 1);
  const maxX = clamp(Math.floor((px + normalizedRadius) * grid.width), 0, grid.width - 1);
  const minY = clamp(Math.floor((py - normalizedRadius) * grid.height), 0, grid.height - 1);
  const maxY = clamp(Math.floor((py + normalizedRadius) * grid.height), 0, grid.height - 1);

  for (let cy = minY; cy <= maxY; cy += 1) {
    const gy = (cy + 0.5) / grid.height;
    for (let cx = minX; cx <= maxX; cx += 1) {
      const gx = (cx + 0.5) / grid.width;
      const distance = Math.hypot(gx - px, gy - py);
      const falloff = smoothFalloff(distance, normalizedRadius);
      if (falloff === 0) continue;
      const index = cy * grid.width + cx;
      grid.cells[index] = clamp(grid.cells[index] + normalizedIntensity * 0.64 * falloff, 0, 1.5);
    }
  }

  const id = world.eventSerial;
  world.eventSerial += 1;
  if (world.rainBursts.length >= MAX_RAIN_BURSTS) world.rainBursts.splice(0, world.rainBursts.length - MAX_RAIN_BURSTS + 1);
  world.rainBursts.push({ id, x: px, y: py, intensity: normalizedIntensity, radius: normalizedRadius, age: 0, life: 0.92 });
  return world;
}

export function plantBend(world, plant) {
  const ambientA = Math.sin(world.time * plant.frequency * 1.65 + plant.phase + plant.x * 3.4);
  const ambientB = Math.sin(world.time * 0.47 + plant.phase * 0.43 + plant.y * 5.2);
  const ambient = (ambientA * 0.68 + ambientB * 0.32) * world.options.wind * 0.19;
  let localX = 0;
  let localY = 0;
  for (let i = 0; i < world.gusts.length; i += 1) {
    const gust = world.gusts[i];
    const dx = plant.x - gust.x;
    const dy = plant.y - gust.y;
    const distanceSquared = dx * dx + dy * dy;
    const radiusSquared = gust.radius * gust.radius;
    if (distanceSquared >= radiusSquared) continue;
    const falloff = smoothFalloff(Math.sqrt(distanceSquared), gust.radius);
    const pulse = 0.94 + Math.sin(gust.age * 8 + gust.id * 0.91) * 0.06;
    const strength = gust.strength * falloff * pulse;
    localX += gust.dirX * strength;
    localY += gust.dirY * strength;
  }
  const local = clamp(localX, -1.25, 1.25) * 0.78 + clamp(localY, -1.25, 1.25) * plant.lean * 0.2;
  return plant.lean * 0.08 + ambient + local;
}

export function getGeometrySignature(world) {
  return world.plants.map((plant) => [
    plant.id,
    plant.species,
    plant.x,
    plant.y,
    plant.baseHeight,
    plant.width,
    plant.phase,
    plant.frequency,
    plant.lean,
    plant.variant,
    plant.petals,
    plant.headSize,
    plant.leafSide
  ]);
}

export function resetBiome(world) {
  return createBiome({ ...world.options });
}

export function saveSnapshot(world) {
  return {
    snapshotVersion: 3,
    version: world.version,
    randomModel: world.randomModel,
    options: { ...world.options },
    seedHash: world.seedHash,
    tick: world.tick,
    time: world.time,
    accumulator: world.accumulator,
    paused: world.paused,
    eventSerial: world.eventSerial,
    plants: world.plants.map((plant) => ({ ...plant })),
    moisture: {
      width: world.moisture.width,
      height: world.moisture.height,
      cells: Array.from(world.moisture.cells)
    },
    gusts: world.gusts.map((gust) => ({ ...gust })),
    rainBursts: world.rainBursts.map((burst) => ({ ...burst })),
    terrain: { ...world.terrain },
    stars: world.stars.map((star) => ({ ...star }))
  };
}

export function loadSnapshot(snapshot) {
  const source = clonePlain(snapshot);
  if (!source || source.snapshotVersion !== 3 || !source.options || !Array.isArray(source.plants)) {
    throw new Error("Unsupported or invalid biome snapshot");
  }
  const options = normalizeOptions(source.options);
  const canonicalSeedHash = hashSeed(options.seed);
  const tick = Math.max(0, Math.floor(finiteNumber(source.tick, 0)));
  const expectedTime = tick * FIXED_DT;
  const snapshotTime = finiteNumber(source.time, expectedTime);
  const accumulator = finiteNumber(source.accumulator, 0);
  const moistureCells = Float64Array.from(source.moisture?.cells ?? []);
  if (source.randomModel !== RANDOM_MODEL || (source.seedHash >>> 0) !== canonicalSeedHash) {
    throw new Error("Snapshot deterministic identity is invalid");
  }
  if (Math.abs(snapshotTime - expectedTime) > EPSILON || accumulator < 0 || accumulator >= FIXED_DT + EPSILON) {
    throw new Error("Snapshot simulation clock is invalid");
  }
  if (source.moisture?.width !== MOISTURE_WIDTH || source.moisture?.height !== MOISTURE_HEIGHT || moistureCells.length !== MOISTURE_WIDTH * MOISTURE_HEIGHT || !Array.from(moistureCells).every(Number.isFinite)) {
    throw new Error("Snapshot moisture grid is invalid");
  }
  if (source.plants.length !== options.density || source.plants.some((plant) => {
    if (!SPECIES.includes(plant.species) || !Number.isFinite(plant.x) || !Number.isFinite(plant.y) || !Number.isFinite(plant.growth)) return true;
    const expectedSoilIndex = moistureIndex({ width: MOISTURE_WIDTH, height: MOISTURE_HEIGHT }, plant.x, plant.y);
    return plant.soilIndex !== expectedSoilIndex;
  })) {
    throw new Error("Snapshot plant population is invalid");
  }
  if ((source.gusts ?? []).length > MAX_GUSTS || (source.rainBursts ?? []).length > MAX_RAIN_BURSTS) {
    throw new Error("Snapshot transient effects exceed product bounds");
  }

  return {
    version: 3,
    randomModel: RANDOM_MODEL,
    options,
    seedHash: canonicalSeedHash,
    tick,
    time: expectedTime,
    accumulator: clamp(accumulator, 0, FIXED_DT - EPSILON),
    paused: Boolean(source.paused),
    eventSerial: Math.max(0, Math.floor(finiteNumber(source.eventSerial, 0))),
    plants: source.plants.map((plant) => ({ ...plant })),
    moisture: {
      width: MOISTURE_WIDTH,
      height: MOISTURE_HEIGHT,
      cells: moistureCells,
      scratch: new Float64Array(moistureCells.length)
    },
    gusts: (source.gusts ?? []).map((gust) => ({ ...gust })),
    rainBursts: (source.rainBursts ?? []).map((burst) => ({ ...burst })),
    terrain: { ...source.terrain },
    stars: (source.stars ?? []).map((star) => ({ ...star }))
  };
}
