function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function branchGrowth(level, depth, progress) {
  const p = clamp01(progress);
  if (p === 0) return 0;
  if (p === 1) return 1;
  const denominator = Math.max(1, depth - 1);
  const start = (level / denominator) * 0.68;
  const duration = 0.34;
  return smoothstep((p - start) / duration);
}

export function windBend(level, phase, timeMs, reducedMotion = false) {
  if (reducedMotion) return 0;
  const time = timeMs * 0.00062;
  const primary = Math.sin(time + phase);
  const secondary = Math.sin(time * 0.43 + phase * 1.61);
  const flexibility = 0.32 + Math.min(10, level) * 0.18;
  return (primary * 0.011 + secondary * 0.0055) * flexibility;
}

export function updateAnimatedGeometry(model, timeMs, reducedMotion = false, buffer) {
  const needed = model.branches.length * 5;
  const geometry = buffer?.length === needed ? buffer : new Float32Array(needed);

  for (const branch of model.branches) {
    const offset = branch.index * 5;
    let x1 = 0;
    let y1 = 0;
    let parentAngle = -Math.PI / 2;

    if (branch.parentIndex >= 0) {
      const parentOffset = branch.parentIndex * 5;
      x1 = geometry[parentOffset + 2];
      y1 = geometry[parentOffset + 3];
      parentAngle = geometry[parentOffset + 4];
    }

    const sway = windBend(branch.level, branch.windPhase, timeMs, reducedMotion);
    const angle = branch.parentIndex < 0
      ? -Math.PI / 2 + sway * 0.35
      : parentAngle + branch.turn + sway;
    const x2 = x1 + Math.cos(angle) * branch.length;
    const y2 = y1 + Math.sin(angle) * branch.length;

    geometry[offset] = x1;
    geometry[offset + 1] = y1;
    geometry[offset + 2] = x2;
    geometry[offset + 3] = y2;
    geometry[offset + 4] = angle;
  }

  return geometry;
}
