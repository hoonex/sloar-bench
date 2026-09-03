import { branchGrowth, updateAnimatedGeometry } from "./animation.js";
import {
  createTreeModel,
  createVariationSeed,
  getTreePalette
} from "./tree-model.js";

const canvas = document.querySelector("#tree-canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const stage = document.querySelector(".stage");
const regenerateButton = document.querySelector("#regenerate");
const statusText = document.querySelector("#tree-state");
const branchCount = document.querySelector("#branch-count");
const seedBadge = document.querySelector("#seed-badge");
const liveRegion = document.querySelector("#tree-announcement");

const controls = {
  angle: document.querySelector("#angle"),
  depth: document.querySelector("#depth"),
  length: document.querySelector("#length"),
  seed: document.querySelector("#seed"),
  palette: document.querySelector("#palette"),
  leaves: document.querySelector("#leaves"),
  flowers: document.querySelector("#flowers")
};

const outputs = {
  angle: document.querySelector("#angle-value"),
  depth: document.querySelector("#depth-value"),
  length: document.querySelector("#length-value")
};

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const state = {
  model: null,
  modelDirty: true,
  geometry: null,
  width: 1,
  height: 1,
  dpr: 1,
  growthStart: performance.now(),
  growthDuration: 2100,
  reducedMotion: motionQuery.matches,
  frameRequested: false,
  status: ""
};

function readOptions() {
  return {
    angle: controls.angle.value,
    depth: controls.depth.value,
    length: controls.length.value,
    seed: controls.seed.value,
    palette: controls.palette.value,
    leaves: controls.leaves.checked,
    flowers: controls.flowers.checked
  };
}

function syncLabels() {
  outputs.angle.value = `${controls.angle.value}°`;
  outputs.depth.value = controls.depth.value;
  outputs.length.value = controls.length.value;
}

function setStatus(value) {
  if (state.status === value) return;
  state.status = value;
  statusText.textContent = value;
  stage.dataset.motion = value === "Growing" ? "growing" : "wind";
}

function refreshModel() {
  state.model = createTreeModel(readOptions());
  state.geometry = null;
  state.modelDirty = false;

  const palette = getTreePalette(state.model.options.palette);
  document.documentElement.style.setProperty("--palette-accent", palette.accent);
  branchCount.textContent = `${state.model.branches.length.toLocaleString()} branches`;
  seedBadge.textContent = `Seed ${state.model.options.seed || "∅"}`;
  canvas.setAttribute(
    "aria-label",
    `Procedural fractal tree with ${state.model.branches.length} branches, depth ${state.model.options.depth}, angle ${state.model.options.angle} degrees, seed ${state.model.options.seed || "empty"}.`
  );
}

function fitScale(model, width, height) {
  const natural = Math.min(width / 920, height / 850);
  const boundsWidth = Math.max(1, model.bounds.width + 130);
  const boundsHeight = Math.max(1, model.bounds.height + 120);
  const overflowGuard = Math.min(width / boundsWidth, height / boundsHeight);
  return Math.max(0.32, Math.min(natural, overflowGuard));
}

function drawBackground(palette, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, palette.backgroundTop);
  gradient.addColorStop(1, palette.backgroundBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const atmosphere = ctx.createRadialGradient(
    width * 0.48,
    height * 0.32,
    0,
    width * 0.48,
    height * 0.32,
    Math.max(width, height) * 0.72
  );
  atmosphere.addColorStop(0, `${palette.atmosphere}58`);
  atmosphere.addColorStop(0.52, `${palette.atmosphere}18`);
  atmosphere.addColorStop(1, `${palette.backgroundBottom}00`);
  ctx.fillStyle = atmosphere;
  ctx.fillRect(0, 0, width, height);
}

function drawGround(palette, originX, originY, scale) {
  ctx.save();
  ctx.translate(originX, originY + 2 * scale);
  ctx.scale(1, 0.22);
  const ground = ctx.createRadialGradient(0, 0, 0, 0, 0, 210 * scale);
  ground.addColorStop(0, `${palette.atmosphere}48`);
  ground.addColorStop(0.55, `${palette.atmosphere}16`);
  ground.addColorStop(1, `${palette.atmosphere}00`);
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.arc(0, 0, 210 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBranches(model, geometry, palette, scale, growthProgress) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let level = 0; level < model.levels.length; level += 1) {
    const growth = branchGrowth(level, model.options.depth, growthProgress);
    if (growth <= 0) continue;

    ctx.beginPath();
    for (const branchIndex of model.levels[level]) {
      const offset = branchIndex * 5;
      const x1 = geometry[offset];
      const y1 = geometry[offset + 1];
      const x2 = geometry[offset + 2];
      const y2 = geometry[offset + 3];
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + (x2 - x1) * growth, y1 + (y2 - y1) * growth);
    }

    ctx.lineWidth = Math.max(0.82, model.options.length * 0.062 * Math.pow(0.64, level));
    ctx.strokeStyle = level <= 1 ? palette.trunk : palette.branch;
    ctx.globalAlpha = 0.94 - Math.min(0.24, level * 0.018);
    if (level < 3) {
      ctx.shadowColor = `${palette.atmosphere}80`;
      ctx.shadowBlur = 6 / Math.max(0.45, scale);
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawLeaf(leaf, geometry, palette, alpha) {
  const offset = leaf.branchIndex * 5;
  const x = geometry[offset + 2];
  const y = geometry[offset + 3];
  const angle = geometry[offset + 4] + leaf.rotation;
  const size = leaf.size;

  ctx.fillStyle = leaf.alternate ? palette.leafAlt : palette.leaf;
  ctx.globalAlpha = alpha * 0.9;
  ctx.beginPath();
  ctx.ellipse(x, y, size, size * 0.52, angle, 0, Math.PI * 2);
  ctx.fill();
}

function drawFlower(flower, geometry, palette, alpha) {
  const offset = flower.branchIndex * 5;
  const x = geometry[offset + 2];
  const y = geometry[offset + 3];
  const size = flower.size;

  ctx.fillStyle = palette.flower;
  ctx.globalAlpha = alpha * 0.95;
  for (let petal = 0; petal < flower.petals; petal += 1) {
    const angle = flower.rotation + (Math.PI * 2 * petal) / flower.petals;
    ctx.beginPath();
    ctx.arc(
      x + Math.cos(angle) * size * 0.58,
      y + Math.sin(angle) * size * 0.58,
      size * 0.52,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.fillStyle = palette.flowerCenter;
  ctx.beginPath();
  ctx.arc(x, y, size * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

function drawOverlays(model, geometry, palette, growthProgress) {
  const canopyGrowth = branchGrowth(model.options.depth - 1, model.options.depth, growthProgress);
  if (canopyGrowth < 0.66) return;
  const reveal = Math.min(1, (canopyGrowth - 0.66) / 0.34);
  for (const leaf of model.leaves) drawLeaf(leaf, geometry, palette, reveal);
  for (const flower of model.flowers) drawFlower(flower, geometry, palette, reveal);
  ctx.globalAlpha = 1;
}

function drawFrame(time) {
  state.frameRequested = false;
  if (state.modelDirty || !state.model) refreshModel();

  const model = state.model;
  const palette = getTreePalette(model.options.palette);
  const elapsed = Math.max(0, time - state.growthStart);
  const growthProgress = state.reducedMotion ? 1 : Math.min(1, elapsed / state.growthDuration);
  const scale = fitScale(model, state.width, state.height);
  const originX = state.width / 2;
  const originY = state.height * 0.92;

  drawBackground(palette, state.width, state.height);
  drawGround(palette, originX, originY, scale);

  state.geometry = updateAnimatedGeometry(
    model,
    time,
    state.reducedMotion,
    state.geometry
  );

  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(scale, scale);
  drawBranches(model, state.geometry, palette, scale, growthProgress);
  drawOverlays(model, state.geometry, palette, growthProgress);
  ctx.restore();

  if (state.reducedMotion) {
    setStatus("Still mode");
  } else if (growthProgress < 1) {
    setStatus("Growing");
  } else {
    setStatus("Soft wind");
  }

  if (!state.reducedMotion || growthProgress < 1 || state.modelDirty) {
    scheduleFrame();
  }
}

function scheduleFrame() {
  if (state.frameRequested) return;
  state.frameRequested = true;
  requestAnimationFrame(drawFrame);
}

function markModelDirty() {
  state.modelDirty = true;
  scheduleFrame();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const pixelWidth = Math.round(cssWidth * dpr);
  const pixelHeight = Math.round(cssHeight * dpr);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  state.width = cssWidth;
  state.height = cssHeight;
  state.dpr = dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scheduleFrame();
}

for (const key of ["angle", "depth", "length", "seed"]) {
  controls[key].addEventListener("input", () => {
    syncLabels();
    markModelDirty();
  });
}

for (const key of ["palette", "leaves", "flowers"]) {
  controls[key].addEventListener("change", markModelDirty);
}

regenerateButton.addEventListener("click", () => {
  const entropy = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(entropy);
  } else {
    entropy[0] = Date.now() >>> 0;
    entropy[1] = Math.floor(Math.random() * 0xffffffff);
  }
  const nextSeed = createVariationSeed(controls.seed.value, `${entropy[0]}-${entropy[1]}`);
  controls.seed.value = nextSeed;
  state.growthStart = performance.now();
  state.modelDirty = true;
  liveRegion.textContent = `Regenerated tree with seed ${nextSeed}.`;
  scheduleFrame();
});

motionQuery.addEventListener("change", (event) => {
  state.reducedMotion = event.matches;
  state.growthStart = performance.now();
  scheduleFrame();
});

new ResizeObserver(resizeCanvas).observe(canvas);
window.addEventListener("resize", resizeCanvas, { passive: true });

syncLabels();
resizeCanvas();
scheduleFrame();
