import {
  MAX_FRAME_DELTA,
  advanceBiome,
  applyGust,
  applyRain,
  averageMoisture,
  createBiome,
  loadSnapshot,
  plantBend,
  resetBiome,
  saveSnapshot,
  setDensity,
  setPaused,
  setSeason,
  setTimeOfDay,
  setWind
} from "./simulation.js";
import {
  backingStoreSize,
  beginPointerSession,
  cancelPointerSession,
  clientToBiomePoint,
  createPointerSession,
  endPointerSession,
  movePointerSession,
  resetPointerSession
} from "./interaction.js";

const canvas = document.querySelector("#biome");
const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
const density = document.querySelector("#density");
const densityValue = document.querySelector("#density-value");
const wind = document.querySelector("#wind");
const windValue = document.querySelector("#wind-value");
const time = document.querySelector("#time");
const timeValue = document.querySelector("#time-value");
const seed = document.querySelector("#seed");
const applySeed = document.querySelector("#apply-seed");
const season = document.querySelector("#season");
const reset = document.querySelector("#reset");
const regenerate = document.querySelector("#regenerate");
const pause = document.querySelector("#pause");
const save = document.querySelector("#save");
const load = document.querySelector("#load");
const loadFile = document.querySelector("#load-file");
const modeWind = document.querySelector("#mode-wind");
const modeRain = document.querySelector("#mode-rain");
const populationValue = document.querySelector("#population-value");
const moistureValue = document.querySelector("#moisture-value");
const simValue = document.querySelector("#sim-value");
const stateValue = document.querySelector("#state-value");
const message = document.querySelector("#message");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const pointerSession = createPointerSession();
const viewport = { width: 1, height: 1, dpr: 1 };
const frameMetrics = { fps: 0, renderMs: 0, frames: 0, droppedWallSeconds: 0 };
let interactionMode = "wind";
let world = createBiome(readInitialOptions());
let lastFrameTime = performance.now();
let lastHudUpdate = 0;
let metricWindowStart = lastFrameTime;
let metricWindowFrames = 0;

const PALETTES = {
  spring: {
    daySkyTop: "#83b4c3", daySkyBottom: "#ddd8aa", nightSkyTop: "#07101d", nightSkyBottom: "#16251f",
    dayGroundTop: "#5b7547", dayGroundBottom: "#172d20", nightGroundTop: "#253527", nightGroundBottom: "#08120d",
    hillFarDay: "#84957b", hillFarNight: "#1c2a29", hillNearDay: "#4b6548", hillNearNight: "#14211b",
    stems: ["#6f9149", "#7f9f54", "#557d42", "#8aa95d"], flowers: ["#f1d9b4", "#dba8c5", "#f2e29b", "#d8d9ed"], seedHeads: ["#c7bf87", "#b8aa6d", "#ddd19a", "#afa474"]
  },
  summer: {
    daySkyTop: "#70a8bd", daySkyBottom: "#dfcd94", nightSkyTop: "#06111b", nightSkyBottom: "#14271e",
    dayGroundTop: "#627b42", dayGroundBottom: "#16311d", nightGroundTop: "#263923", nightGroundBottom: "#07140b",
    hillFarDay: "#879272", hillFarNight: "#1c2b27", hillNearDay: "#53673f", hillNearNight: "#14231a",
    stems: ["#68863b", "#789648", "#4f7438", "#8ea25b"], flowers: ["#f0c46c", "#e2a59c", "#f0dd88", "#c8dca2"], seedHeads: ["#d1b970", "#b69c5e", "#e3ca84", "#a58f58"]
  },
  autumn: {
    daySkyTop: "#9ca79a", daySkyBottom: "#d8bd87", nightSkyTop: "#0d1018", nightSkyBottom: "#292019",
    dayGroundTop: "#76653e", dayGroundBottom: "#34271a", nightGroundTop: "#382f22", nightGroundBottom: "#120e0a",
    hillFarDay: "#91816b", hillFarNight: "#2b2623", hillNearDay: "#67563c", hillNearNight: "#251b15",
    stems: ["#8b7644", "#9c8248", "#706638", "#ac8750"], flowers: ["#d69a62", "#c87756", "#d9b278", "#b98968"], seedHeads: ["#c29f62", "#a88450", "#d0ac68", "#947146"]
  },
  winter: {
    daySkyTop: "#9eadb7", daySkyBottom: "#ced2c8", nightSkyTop: "#08101c", nightSkyBottom: "#1a2428",
    dayGroundTop: "#687568", dayGroundBottom: "#29362f", nightGroundTop: "#303c37", nightGroundBottom: "#0d1714",
    hillFarDay: "#89928d", hillFarNight: "#263032", hillNearDay: "#59675f", hillNearNight: "#1b2723",
    stems: ["#71806c", "#7f8c74", "#5f7060", "#90987d"], flowers: ["#d6d8d0", "#c3c9cb", "#e1ddc9", "#b9c3cc"], seedHeads: ["#b9b5a0", "#a7a28e", "#ccc7af", "#979684"]
  }
};

function readInitialOptions() {
  return {
    seed: seed?.value || "meadow-42",
    density: density?.value || 1500,
    wind: wind?.value || 0.34,
    season: season?.value || "spring",
    timeOfDay: time?.value || 15.5
  };
}

function formatTime(hours) {
  const totalMinutes = ((Math.round(Number(hours) * 60) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function syncControlsFromWorld() {
  seed.value = world.options.seed;
  density.value = String(world.options.density);
  densityValue.value = String(world.options.density);
  wind.value = String(world.options.wind);
  windValue.value = Number(world.options.wind).toFixed(2);
  season.value = world.options.season;
  time.value = String(world.options.timeOfDay);
  timeValue.value = formatTime(world.options.timeOfDay);
  pause.textContent = world.paused ? "Resume" : "Pause";
  pause.setAttribute("aria-pressed", String(world.paused));
}

function announce(text) {
  message.textContent = text;
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mixColor(a, b, amount) {
  const aa = hexToRgb(a);
  const bb = hexToRgb(b);
  const t = Math.max(0, Math.min(1, amount));
  const r = Math.round(aa[0] + (bb[0] - aa[0]) * t);
  const g = Math.round(aa[1] + (bb[1] - aa[1]) * t);
  const bl = Math.round(aa[2] + (bb[2] - aa[2]) * t);
  return `rgb(${r} ${g} ${bl})`;
}

function daylightFor(hours) {
  const phase = ((hours - 6) / 12) * Math.PI;
  return Math.max(0, Math.min(1, Math.sin(phase) * 1.08));
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const target = backingStoreSize(rect.width, rect.height, window.devicePixelRatio || 1);
  viewport.width = Math.max(1, rect.width);
  viewport.height = Math.max(1, rect.height);
  viewport.dpr = target.dpr;
  if (canvas.width !== target.width || canvas.height !== target.height) {
    canvas.width = target.width;
    canvas.height = target.height;
  }
  ctx.setTransform(target.dpr, 0, 0, target.dpr, 0, 0);
}

function drawSky(palette, daylight, motionScale) {
  const { width, height } = viewport;
  const horizon = height * 0.57;
  const gradient = ctx.createLinearGradient(0, 0, 0, horizon);
  gradient.addColorStop(0, mixColor(palette.nightSkyTop, palette.daySkyTop, daylight));
  gradient.addColorStop(1, mixColor(palette.nightSkyBottom, palette.daySkyBottom, daylight));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, horizon + 2);

  const night = 1 - daylight;
  if (night > 0.08) {
    ctx.save();
    ctx.fillStyle = "#edf2df";
    for (let i = 0; i < world.stars.length; i += 1) {
      const star = world.stars[i];
      const twinkle = reducedMotion.matches ? 0.72 : 0.72 + Math.sin(world.time * 0.75 * motionScale + star.phase) * 0.28;
      ctx.globalAlpha = night * (0.28 + twinkle * 0.5);
      ctx.beginPath();
      ctx.arc(star.x * width, star.y * horizon, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const sunAlpha = Math.max(0, daylight - 0.12);
  if (sunAlpha > 0) {
    const dayProgress = Math.max(0, Math.min(1, (world.options.timeOfDay - 6) / 12));
    const sunX = width * (0.12 + dayProgress * 0.76);
    const arc = Math.sin(dayProgress * Math.PI);
    const sunY = height * (0.3 - arc * 0.17);
    const radius = Math.min(width, height) * 0.19;
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, radius);
    glow.addColorStop(0, `rgb(255 238 184 / ${sunAlpha * 0.32})`);
    glow.addColorStop(1, "rgb(255 238 184 / 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - radius, sunY - radius, radius * 2, radius * 2);
  } else if (night > 0.42) {
    const moonX = width * 0.78;
    const moonY = height * 0.17;
    ctx.fillStyle = `rgb(224 231 216 / ${night * 0.48})`;
    ctx.beginPath();
    ctx.arc(moonX, moonY, Math.max(4, Math.min(width, height) * 0.008), 0, Math.PI * 2);
    ctx.fill();
  }
}

function ridgeY(nx, baseline, amplitude, phase, frequency) {
  return baseline + Math.sin(nx * frequency + phase) * amplitude + Math.sin(nx * frequency * 0.47 + phase * 1.7) * amplitude * 0.43;
}

function drawRidge(baseline, amplitude, phase, frequency, color, alpha = 1) {
  const { width, height } = viewport;
  ctx.beginPath();
  ctx.moveTo(0, height);
  const segments = 34;
  for (let i = 0; i <= segments; i += 1) {
    const nx = i / segments;
    ctx.lineTo(nx * width, ridgeY(nx, baseline, amplitude, phase, frequency) * height);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawGround(palette, daylight) {
  const { width, height } = viewport;
  drawRidge(0.46, 0.022, world.terrain.ridgeA, 7.4, mixColor(palette.hillFarNight, palette.hillFarDay, daylight), 0.78);
  drawRidge(0.505, 0.033, world.terrain.ridgeB, 5.2, mixColor(palette.hillNearNight, palette.hillNearDay, daylight), 0.93);

  const groundTop = height * 0.535;
  const gradient = ctx.createLinearGradient(0, groundTop, 0, height);
  gradient.addColorStop(0, mixColor(palette.nightGroundTop, palette.dayGroundTop, daylight));
  gradient.addColorStop(1, mixColor(palette.nightGroundBottom, palette.dayGroundBottom, daylight));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, groundTop, width, height - groundTop);

  const haze = ctx.createLinearGradient(0, height * 0.5, 0, height * 0.68);
  haze.addColorStop(0, `rgb(229 231 207 / ${(0.025 + world.terrain.haze * 0.04) * daylight})`);
  haze.addColorStop(1, "rgb(229 231 207 / 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, height * 0.49, width, height * 0.2);
}

function drawSoilMoisture(daylight) {
  const { width, height } = viewport;
  const grid = world.moisture;
  const cellWidth = width / grid.width;
  const cellHeight = height / grid.height;
  ctx.save();
  ctx.fillStyle = daylight > 0.38 ? "#5d8990" : "#426b75";
  for (let y = Math.floor(grid.height * 0.52); y < grid.height; y += 1) {
    const row = y * grid.width;
    for (let x = 0; x < grid.width; x += 1) {
      const moisture = grid.cells[row + x];
      const wet = Math.max(0, Math.min(1, (moisture - 0.24) / 0.72));
      if (wet < 0.025) continue;
      ctx.globalAlpha = wet * (0.045 + daylight * 0.025);
      ctx.fillRect(x * cellWidth - 1, y * cellHeight - 1, cellWidth + 2, cellHeight + 2);
    }
  }
  ctx.restore();
}

function buildPlantColors(palette, daylight) {
  const stems = new Array(4);
  const flowers = new Array(4);
  const seedHeads = new Array(4);
  for (let i = 0; i < 4; i += 1) {
    stems[i] = mixColor("#26372e", palette.stems[i], 0.31 + daylight * 0.69);
    flowers[i] = mixColor("#5d6165", palette.flowers[i], 0.25 + daylight * 0.75);
    seedHeads[i] = mixColor("#505047", palette.seedHeads[i], 0.29 + daylight * 0.71);
  }
  return { stems, flowers, seedHeads };
}

function drawLeaf(x, y, bend, size, side, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + side * size * 0.65 + bend * size * 0.18, y - size * 0.58, x + side * size, y - size * 0.08);
  ctx.quadraticCurveTo(x + side * size * 0.57, y + size * 0.14, x, y);
  ctx.fill();
}

function drawPlant(plant, colors, motionScale, daylight, detailed) {
  const { width, height } = viewport;
  const x = plant.x * width;
  const baseY = plant.y * height;
  const growth = plant.growth;
  const plantHeight = Math.max(1.2, plant.baseHeight * height * growth);
  const vigor = Math.max(0.18, Math.min(1.16, plant.vigor));
  const bend = plantBend(world, plant) * motionScale;
  const tipX = x + bend * plantHeight;
  const tipY = baseY - plantHeight;
  const midX = x + bend * plantHeight * 0.34;
  const midY = baseY - plantHeight * 0.52;
  const variant = plant.variant & 3;
  const stemColor = colors.stems[variant];
  const perspective = 0.53 + plant.y * 0.69;

  ctx.strokeStyle = stemColor;
  ctx.lineWidth = Math.max(0.52, plant.width * perspective * (0.57 + vigor * 0.38));
  ctx.lineCap = "round";
  ctx.globalAlpha = Math.max(0.36, Math.min(0.94, 0.48 + daylight * 0.28 + vigor * 0.17));
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(midX, midY, tipX, tipY);
  ctx.stroke();

  if (plant.species === "grass") {
    if (growth > 0.21 && plant.variant !== 1 && (detailed || plant.variant === 0)) {
      ctx.globalAlpha *= 0.67;
      const side = plant.leafSide;
      ctx.beginPath();
      ctx.moveTo(x + side * plant.width * 0.45, baseY);
      ctx.quadraticCurveTo(x - bend * plantHeight * 0.09, baseY - plantHeight * 0.34, x + side * plant.lean * plantHeight * 0.62, baseY - plantHeight * (0.48 + variant * 0.035));
      ctx.stroke();
    }
    if (growth > 0.52 && variant === 3) {
      ctx.globalAlpha *= 0.68;
      ctx.beginPath();
      ctx.moveTo(midX, midY + plantHeight * 0.08);
      ctx.quadraticCurveTo(tipX - plant.leafSide * plantHeight * 0.08, tipY + plantHeight * 0.18, tipX - plant.leafSide * plantHeight * 0.025, tipY + plantHeight * 0.04);
      ctx.stroke();
    }
  } else if (plant.species === "flower") {
    if (growth > 0.35) {
      const leafY = baseY - plantHeight * 0.45;
      drawLeaf(midX * 0.55 + x * 0.45, leafY, bend, Math.max(2, plantHeight * 0.13) * vigor, plant.leafSide, stemColor);
    }
    if (growth > 0.64) {
      const bloom = Math.max(1.25, Math.min(5.8, plant.headSize * perspective * (1.12 + growth * 1.72))) * vigor;
      ctx.fillStyle = colors.flowers[variant];
      ctx.globalAlpha = (0.47 + daylight * 0.45) * Math.min(1, (growth - 0.58) * 4.5);
      if (detailed) {
        for (let p = 0; p < plant.petals; p += 1) {
          const angle = (p / plant.petals) * Math.PI * 2 + plant.phase * 0.13;
          ctx.beginPath();
          ctx.ellipse(tipX + Math.cos(angle) * bloom * 0.72, tipY + Math.sin(angle) * bloom * 0.55, bloom * 0.57, bloom * 0.3, angle, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.beginPath();
        ctx.arc(tipX, tipY, bloom * 0.78, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = colors.seedHeads[(variant + 1) & 3];
      ctx.globalAlpha = 0.86;
      ctx.beginPath();
      ctx.arc(tipX, tipY, Math.max(0.75, bloom * 0.35), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    if (growth > 0.29) {
      const leafSize = Math.max(2, plantHeight * 0.11) * vigor;
      drawLeaf(midX, midY + plantHeight * 0.12, bend, leafSize, plant.leafSide, stemColor);
      if (detailed && growth > 0.47) drawLeaf(midX, midY - plantHeight * 0.045, bend, leafSize * 0.77, -plant.leafSide, stemColor);
    }
    if (growth > 0.57) {
      ctx.fillStyle = colors.seedHeads[variant];
      ctx.globalAlpha = 0.46 + daylight * 0.36;
      const head = Math.max(1.15, plant.headSize * perspective * 2.45 * growth);
      ctx.beginPath();
      ctx.ellipse(tipX, tipY, head * 0.7, head * 1.55, bend * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawGusts(daylight, motionScale) {
  if (world.gusts.length === 0) return;
  const { width, height } = viewport;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 0.85;
  ctx.strokeStyle = daylight > 0.35 ? "#dce6d1" : "#b7c8c4";
  for (let i = 0; i < world.gusts.length; i += 1) {
    const gust = world.gusts[i];
    const x = gust.x * width;
    const y = gust.y * height;
    const radius = gust.radius * Math.max(width, height);
    const dx = gust.dirX;
    const dy = gust.dirY * 0.6;
    const px = -dy;
    const py = dx;
    const life = Math.max(0, Math.min(1, gust.strength / Math.max(0.001, gust.initialStrength)));
    ctx.globalAlpha = life * (reducedMotion.matches ? 0.08 : 0.14);
    for (let line = -1; line <= 1; line += 1) {
      const lane = line * radius * 0.18;
      const travel = reducedMotion.matches ? 0 : Math.sin((gust.age * 3.2 + gust.id * 0.17 + line) * motionScale) * radius * 0.05;
      const startX = x - dx * radius * 0.46 + px * lane;
      const startY = y - dy * radius * 0.46 + py * lane;
      const endX = x + dx * radius * 0.48 + px * lane;
      const endY = y + dy * radius * 0.48 + py * lane;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(x + px * (lane + travel), y + py * (lane + travel), endX, endY);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawRain(daylight, motionScale) {
  const { width, height } = viewport;
  for (let i = 0; i < world.rainBursts.length; i += 1) {
    const burst = world.rainBursts[i];
    const life = Math.max(0, 1 - burst.age / burst.life);
    const x = burst.x * width;
    const y = burst.y * height;
    const radius = burst.radius * Math.max(width, height) * (0.72 + burst.age * 0.34);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `rgb(111 158 169 / ${life * 0.13})`);
    glow.addColorStop(1, "rgb(111 158 169 / 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

    const dropCount = reducedMotion.matches ? 4 : 10;
    ctx.strokeStyle = mixColor("#758996", "#c8dde0", daylight);
    ctx.lineWidth = 0.75;
    ctx.globalAlpha = life * 0.38;
    for (let d = 0; d < dropCount; d += 1) {
      const phase = ((burst.id * 17 + d * 23) % 97) / 97;
      const offsetX = (phase - 0.5) * radius * 1.3;
      const travel = ((burst.age * (1.7 + d * 0.03) * motionScale + phase) % 1) * radius * 1.2;
      const dropX = x + offsetX;
      const dropY = y - radius * 0.72 + travel;
      ctx.beginPath();
      ctx.moveTo(dropX, dropY - 5);
      ctx.lineTo(dropX - 1.15, dropY + 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function drawFireflies(daylight, motionScale) {
  const night = 1 - daylight;
  if (night < 0.42) return;
  const { width, height } = viewport;
  ctx.fillStyle = "#dbe99d";
  for (let i = 0; i < 18; i += 1) {
    const source = world.stars[i];
    const drift = reducedMotion.matches ? 0.12 : motionScale;
    const x = ((source.x + Math.sin(world.time * 0.09 * drift + source.phase) * 0.018 + 1) % 1) * width;
    const y = (0.59 + source.y * 0.53 + Math.cos(world.time * 0.12 * drift + source.phase) * 0.016) * height;
    const pulse = reducedMotion.matches ? 0.48 : 0.35 + Math.sin(world.time * 1.1 * drift + source.phase) * 0.3;
    ctx.globalAlpha = Math.max(0, night * pulse);
    ctx.beginPath();
    ctx.arc(x, y, 0.75 + source.size * 0.43, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function renderScene() {
  const palette = PALETTES[world.options.season];
  const daylight = daylightFor(world.options.timeOfDay);
  const motionScale = reducedMotion.matches ? 0.34 : 1;
  drawSky(palette, daylight, motionScale);
  drawGround(palette, daylight);
  drawSoilMoisture(daylight);
  drawGusts(daylight, motionScale);
  drawRain(daylight, motionScale);
  const colors = buildPlantColors(palette, daylight);
  const detailed = world.plants.length <= 1800;
  for (let i = 0; i < world.plants.length; i += 1) drawPlant(world.plants[i], colors, motionScale, daylight, detailed);
  drawFireflies(daylight, motionScale);
}

function updateHud(now) {
  if (now - lastHudUpdate < 180) return;
  lastHudUpdate = now;
  populationValue.textContent = world.plants.length.toLocaleString();
  moistureValue.textContent = `${Math.round(averageMoisture(world) * 100)}%`;
  simValue.textContent = `${world.time.toFixed(1)}s`;
  stateValue.textContent = world.paused ? "paused" : "growing";
  stateValue.dataset.paused = String(world.paused);
}

function updateFrameMetrics(now, renderMs, droppedDelta) {
  metricWindowFrames += 1;
  frameMetrics.frames += 1;
  frameMetrics.renderMs = frameMetrics.renderMs === 0 ? renderMs : frameMetrics.renderMs * 0.9 + renderMs * 0.1;
  frameMetrics.droppedWallSeconds += droppedDelta;
  const elapsed = now - metricWindowStart;
  if (elapsed >= 900) {
    frameMetrics.fps = (metricWindowFrames * 1000) / elapsed;
    metricWindowFrames = 0;
    metricWindowStart = now;
  }
}

function animationFrame(now) {
  const currentDpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  if (Math.abs(currentDpr - viewport.dpr) > 0.01) resizeCanvas();
  const frameDelta = Math.max(0, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  const stepResult = advanceBiome(world, frameDelta, MAX_FRAME_DELTA);
  const renderStart = performance.now();
  renderScene();
  const renderMs = performance.now() - renderStart;
  updateFrameMetrics(now, renderMs, stepResult.droppedDelta || 0);
  updateHud(now);
  requestAnimationFrame(animationFrame);
}

function pointForEvent(event) {
  return clientToBiomePoint(canvas.getBoundingClientRect(), event.clientX, event.clientY);
}

function abortPointerGesture() {
  if (!pointerSession.active) {
    canvas.classList.remove("is-interacting");
    return false;
  }
  const pointerId = pointerSession.pointerId;
  resetPointerSession(pointerSession);
  try {
    if (pointerId !== null && canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
  } catch {
    // The browser may already have released capture during cancellation/navigation.
  }
  canvas.classList.remove("is-interacting");
  return true;
}

function finishPointer(event, cancelled = false) {
  const ended = cancelled ? cancelPointerSession(pointerSession, event.pointerId) : endPointerSession(pointerSession, event.pointerId);
  if (!ended) return false;
  try {
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  } catch {
    // Synthetic and already-cancelled pointers may not be releasable.
  }
  canvas.classList.remove("is-interacting");
  return true;
}

function applyInteraction(action) {
  if (!action || world.paused) return;
  if (action.mode === "rain") {
    applyRain(world, action.x, action.y, action.intensity, 0.105);
  } else {
    const directionX = Math.abs(action.dx) + Math.abs(action.dy) < 1e-5 ? 1 : action.dx;
    applyGust(world, action.x, action.y, action.intensity, directionX, action.dy);
  }
}

canvas.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary && event.pointerType !== "mouse") return;
  const action = beginPointerSession(pointerSession, event.pointerId, interactionMode, pointForEvent(event));
  if (!action) return;
  event.preventDefault();
  try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic events may not be capturable */ }
  canvas.classList.add("is-interacting");
  applyInteraction(action);
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerSession.active || pointerSession.pointerId !== event.pointerId) return;
  event.preventDefault();
  applyInteraction(movePointerSession(pointerSession, event.pointerId, pointForEvent(event)));
});

canvas.addEventListener("pointerup", (event) => finishPointer(event, false));
canvas.addEventListener("pointercancel", (event) => finishPointer(event, true));
canvas.addEventListener("pointerleave", (event) => {
  if (pointerSession.active && pointerSession.pointerId === event.pointerId && !canvas.hasPointerCapture?.(event.pointerId)) finishPointer(event, true);
});
canvas.addEventListener("lostpointercapture", (event) => {
  cancelPointerSession(pointerSession, event.pointerId);
  canvas.classList.remove("is-interacting");
});

function setInteractionMode(mode) {
  abortPointerGesture();
  interactionMode = mode === "rain" ? "rain" : "wind";
  modeWind.setAttribute("aria-pressed", String(interactionMode === "wind"));
  modeRain.setAttribute("aria-pressed", String(interactionMode === "rain"));
  canvas.dataset.mode = interactionMode;
  announce(interactionMode === "rain" ? "Paint rain into the soil. Wet ground diffuses, then plants grow with the moisture." : "Drag through the meadow to send a directional local gust.");
}

function replaceWorld(nextWorld, announcement) {
  abortPointerGesture();
  world = nextWorld;
  lastFrameTime = performance.now();
  syncControlsFromWorld();
  updateHud(lastFrameTime + 1000);
  if (announcement) announce(announcement);
}

modeWind.addEventListener("click", () => setInteractionMode("wind"));
modeRain.addEventListener("click", () => setInteractionMode("rain"));

density.addEventListener("input", () => {
  densityValue.value = density.value;
  setDensity(world, density.value);
});
wind.addEventListener("input", () => {
  windValue.value = Number(wind.value).toFixed(2);
  setWind(world, wind.value);
});
season.addEventListener("change", () => {
  setSeason(world, season.value);
  announce(`${season.options[season.selectedIndex].text} palette applied without moving the seeded geometry.`);
});
time.addEventListener("input", () => {
  timeValue.value = formatTime(time.value);
  setTimeOfDay(world, time.value);
});

pause.addEventListener("click", () => {
  abortPointerGesture();
  setPaused(world, !world.paused);
  lastFrameTime = performance.now();
  syncControlsFromWorld();
  announce(world.paused ? "Simulation paused. Growth, moisture and gust decay are frozen." : "Simulation resumed from the same fixed-step state.");
});

reset.addEventListener("click", () => {
  const next = resetBiome(world);
  replaceWorld(next, `Reset ${next.options.seed} to its deterministic baseline.`);
});

function generateSeed() {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return `meadow-${values[0].toString(36)}${values[1].toString(36)}`;
}

regenerate.addEventListener("click", () => {
  const nextSeed = generateSeed();
  replaceWorld(createBiome({ ...world.options, seed: nextSeed }), `New variation: ${nextSeed}`);
});

function useTypedSeed() {
  const requestedSeed = seed.value.trim() || "meadow-42";
  replaceWorld(createBiome({ ...world.options, seed: requestedSeed }), `Loaded deterministic seed: ${requestedSeed}`);
}
applySeed.addEventListener("click", useTypedSeed);
seed.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  useTypedSeed();
});

save.addEventListener("click", () => {
  const snapshot = saveSnapshot(world);
  const serialized = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([serialized], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `living-meadow-${world.options.seed}.json`;
  anchor.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
  announce(`Snapshot exported at simulation ${world.time.toFixed(1)}s.`);
});

load.addEventListener("click", () => {
  abortPointerGesture();
  loadFile.click();
});
loadFile.addEventListener("change", async () => {
  const file = loadFile.files?.[0];
  if (!file) return;
  try {
    const restored = loadSnapshot(JSON.parse(await file.text()));
    replaceWorld(restored, `Snapshot restored: ${restored.options.seed} at ${restored.time.toFixed(1)}s.`);
  } catch (error) {
    announce(`Could not load snapshot: ${error.message}`);
  } finally {
    loadFile.value = "";
  }
});

window.addEventListener("blur", abortPointerGesture);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) abortPointerGesture();
  lastFrameTime = performance.now();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") abortPointerGesture();
});

new ResizeObserver(resizeCanvas).observe(canvas);
window.addEventListener("resize", resizeCanvas, { passive: true });

Object.defineProperty(window, "__biomeTest", {
  configurable: false,
  enumerable: false,
  value: Object.freeze({
    getWorld: () => world,
    snapshot: () => saveSnapshot(world),
    pointerSession: () => ({ ...pointerSession }),
    viewport: () => ({ ...viewport }),
    metrics: () => ({ ...frameMetrics }),
    setMode: setInteractionMode,
    loadSnapshot: (snapshot) => replaceWorld(loadSnapshot(snapshot), null),
    resetPointer: abortPointerGesture
  })
});

syncControlsFromWorld();
setInteractionMode("wind");
resizeCanvas();
requestAnimationFrame(animationFrame);
