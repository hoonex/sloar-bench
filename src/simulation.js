function hashSeed(seed) {
  const text = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeOptions(options = {}) {
  return {
    seed: String(options.seed ?? "meadow-42"),
    density: Math.max(30, Math.min(1200, Math.round(Number(options.density ?? 120)))),
    wind: Math.max(0, Math.min(1, Number(options.wind ?? 0.35))),
    season: ["spring", "summer", "autumn"].includes(options.season) ? options.season : "spring"
  };
}

export function createBiome(options = {}) {
  const normalized = normalizeOptions(options);
  const random = mulberry32(hashSeed(normalized.seed));
  const plants = Array.from({ length: normalized.density }, (_, index) => ({
    id: index,
    x: random(),
    y: 0.45 + random() * 0.52,
    height: 0.035 + random() * 0.11,
    phase: random() * Math.PI * 2,
    flower: random() > 0.86
  }));

  return {
    options: normalized,
    time: 0,
    paused: false,
    gust: null,
    plants
  };
}

export function stepBiome(world, dtSeconds) {
  if (!world.paused) world.time += Math.max(0, Number(dtSeconds) || 0);
  return world;
}

export function applyGust(world, x, y, strength = 1) {
  world.gust = {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    strength: Math.max(0, Math.min(1, strength))
  };
  return world;
}

export function plantBend(world, plant) {
  const globalWind = Math.sin(world.time * 1.7 + plant.phase) * world.options.wind * 0.18;
  if (!world.gust) return globalWind;
  const dx = plant.x - world.gust.x;
  const dy = plant.y - world.gust.y;
  const distance = Math.hypot(dx, dy);
  const local = Math.max(0, 1 - distance * 4) * world.gust.strength * 0.55;
  return globalWind + local;
}
