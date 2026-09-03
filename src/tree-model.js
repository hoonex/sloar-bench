const TAU = Math.PI * 2;

export const TREE_PALETTES = Object.freeze({
  forest: Object.freeze({
    name: "Forest floor",
    backgroundTop: "#18251d",
    backgroundBottom: "#08100c",
    atmosphere: "#345542",
    trunk: "#c4b49b",
    branch: "#9eb58f",
    leaf: "#7cc27b",
    leafAlt: "#b1d884",
    flower: "#f2d9a7",
    flowerCenter: "#e8b35e",
    accent: "#a7cf9c"
  }),
  dusk: Object.freeze({
    name: "Blue hour",
    backgroundTop: "#1e2233",
    backgroundBottom: "#090b16",
    atmosphere: "#555f86",
    trunk: "#d1bdad",
    branch: "#b7b2d7",
    leaf: "#86aab0",
    leafAlt: "#a7c7bd",
    flower: "#e4c1dd",
    flowerCenter: "#f0d49a",
    accent: "#b9b8e5"
  }),
  blossom: Object.freeze({
    name: "Spring bloom",
    backgroundTop: "#2b1e20",
    backgroundBottom: "#120a0c",
    atmosphere: "#70454d",
    trunk: "#d0b7a5",
    branch: "#c99391",
    leaf: "#95b88f",
    leafAlt: "#bdd09c",
    flower: "#f2b8c0",
    flowerCenter: "#f3d59a",
    accent: "#edb1ba"
  })
});

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
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

export function getTreePalette(name) {
  return TREE_PALETTES[name] ?? TREE_PALETTES.forest;
}

export function normalizeTreeOptions(options = {}) {
  const palette = String(options.palette ?? "forest");
  return {
    angle: clamp(options.angle ?? 28, 10, 55, 28),
    depth: Math.round(clamp(options.depth ?? 7, 2, 11, 7)),
    length: clamp(options.length ?? 150, 70, 220, 150),
    seed: String(options.seed ?? "42"),
    palette: Object.hasOwn(TREE_PALETTES, palette) ? palette : "forest",
    leaves: options.leaves === undefined ? true : Boolean(options.leaves),
    flowers: options.flowers === undefined ? false : Boolean(options.flowers)
  };
}

export function createVariationSeed(currentSeed, entropy = Date.now()) {
  const hash = hashSeed(`${String(currentSeed)}:${String(entropy)}`);
  return `tree-${hash.toString(36).padStart(7, "0")}`;
}

function sampleBranchTips(terminals, limit, random) {
  if (terminals.length <= limit) return terminals;
  const selected = [];
  const step = terminals.length / limit;
  const offset = random() * step;
  for (let i = 0; i < limit; i += 1) {
    selected.push(terminals[Math.min(terminals.length - 1, Math.floor(offset + i * step))]);
  }
  return selected;
}

export function createTreeModel(options = {}) {
  const normalized = normalizeTreeOptions(options);
  const geometryRandom = mulberry32(hashSeed(`${normalized.seed}:geometry`));
  const leafRandom = mulberry32(hashSeed(`${normalized.seed}:leaves`));
  const flowerRandom = mulberry32(hashSeed(`${normalized.seed}:flowers`));
  const baseSpread = (normalized.angle * Math.PI) / 180;
  const branches = [];
  const levels = Array.from({ length: normalized.depth }, () => []);
  const terminals = [];
  const bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  function includePoint(x, y) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
  }

  function grow(x1, y1, heading, length, level, parentIndex, turn) {
    const x2 = x1 + Math.cos(heading) * length;
    const y2 = y1 + Math.sin(heading) * length;
    const index = branches.length;
    const terminal = level === normalized.depth - 1;
    const branch = {
      index,
      parentIndex,
      level,
      x1,
      y1,
      x2,
      y2,
      heading,
      length,
      turn,
      terminal,
      windPhase: geometryRandom() * TAU,
      tone: geometryRandom()
    };

    branches.push(branch);
    levels[level].push(index);
    includePoint(x2, y2);
    if (terminal) {
      terminals.push(index);
      return;
    }

    const levelT = level / Math.max(1, normalized.depth - 1);
    const decayCenter = 0.735 - levelT * 0.025;
    const leftDecay = decayCenter + (geometryRandom() - 0.5) * 0.065;
    const rightDecay = decayCenter + (geometryRandom() - 0.5) * 0.065;
    const asymmetry = (geometryRandom() - 0.5) * 0.055;
    const leftTurn = -baseSpread * (0.88 + geometryRandom() * 0.24) + asymmetry;
    const rightTurn = baseSpread * (0.88 + geometryRandom() * 0.24) + asymmetry;

    grow(x2, y2, heading + leftTurn, length * leftDecay, level + 1, index, leftTurn);
    grow(x2, y2, heading + rightTurn, length * rightDecay, level + 1, index, rightTurn);
  }

  grow(0, 0, -Math.PI / 2, normalized.length, 0, -1, 0);

  const leaves = [];
  if (normalized.leaves) {
    for (const branchIndex of sampleBranchTips(terminals, 720, leafRandom)) {
      leaves.push({
        branchIndex,
        size: 5.5 + leafRandom() * 5.5,
        rotation: (leafRandom() - 0.5) * 1.15,
        alternate: leafRandom() > 0.58
      });
    }
  }

  const flowers = [];
  if (normalized.flowers && terminals.length) {
    const flowerTarget = Math.min(220, Math.max(1, Math.round(terminals.length * 0.28)));
    for (const branchIndex of sampleBranchTips(terminals, flowerTarget, flowerRandom)) {
      flowers.push({
        branchIndex,
        size: 3.6 + flowerRandom() * 3.8,
        rotation: flowerRandom() * TAU,
        petals: flowerRandom() > 0.35 ? 5 : 4
      });
    }
  }

  return {
    options: normalized,
    seedHash: hashSeed(normalized.seed),
    variation: geometryRandom(),
    branches,
    levels,
    leaves,
    flowers,
    bounds: {
      ...bounds,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY
    }
  };
}
