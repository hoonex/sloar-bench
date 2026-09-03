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

export function normalizeTreeOptions(options = {}) {
  return {
    angle: Math.min(55, Math.max(10, Number(options.angle ?? 28))),
    depth: Math.min(11, Math.max(2, Math.round(Number(options.depth ?? 7)))),
    length: Math.min(220, Math.max(70, Number(options.length ?? 150))),
    seed: String(options.seed ?? "42"),
    palette: String(options.palette ?? "forest"),
    leaves: Boolean(options.leaves ?? true),
    flowers: Boolean(options.flowers ?? false)
  };
}

export function createTreeModel(options = {}) {
  const normalized = normalizeTreeOptions(options);
  const random = mulberry32(hashSeed(normalized.seed));
  const jitter = (random() - 0.5) * 0.16;
  const angle = ((normalized.angle * Math.PI) / 180) * (1 + jitter);
  const trunk = {
    x1: 0,
    y1: 0,
    x2: 0,
    y2: -normalized.length,
    level: 0
  };
  const previewBranch = {
    x1: 0,
    y1: -normalized.length,
    x2: Math.sin(angle) * normalized.length * 0.64,
    y2: -normalized.length - Math.cos(angle) * normalized.length * 0.64,
    level: 1
  };

  return {
    options: normalized,
    variation: random(),
    branches: [trunk, previewBranch]
  };
}
