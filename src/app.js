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
  movePointerSession
} from "./interaction.js";

const canvas = document.querySelector("#biome");
const ctx = canvas.getContext("2d", { alpha: false });
const density = document.querySelector("#density");
const densityValue = document.querySelector("#density-value");
const wind = document.querySelector("#wind");
const windValue = document.querySelector("#wind-value");
const time = document.querySelector("#time");
const timeValue = document.querySelector("#time-value");
const seed = document.querySelector("#seed");
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
let interactionMode = "wind";
let world = createBiome(readOptions());
let lastFrameTime = performance.now();
let lastHudUpdate = 0;

const PALETTES = {
  spring: {
    daySkyTop: "#88b7c6", daySkyBottom: "#d9d7aa", nightSkyTop: "#07101d", nightSkyBottom: "#17251f",
    dayGroundTop: "#557044", dayGroundBottom: "#182d20", nightGroundTop: "#233326", nightGroundBottom: "#09130d",
    stems: ["#698b47", "#789b50", "#52783f", "#86a55a"], flowers: ["#f1d9b4", "#d8a7c4", "#f3e49b", "#d7d8ee"], seedHeads: ["#c7c18b", "#b9ac70", "#dfd5a3", "#afa877"]
  },
  summer: {
    daySkyTop: "#72a8bd", daySkyBottom: "#dccb93", nightSkyTop: "#06111b", nightSkyBottom: "#16271e",
    dayGroundTop: "#5e7740", dayGroundBottom: "#17321d", nightGroundTop: "#263a24", nightGroundBottom: "#08140b",
    stems: ["#66833b", "#759447", "#4d7137", "#8ba05a"], flowers: ["#efc36b", "#e2a7a0", "#f0df8a", "#c9dca4"], seedHeads: ["#d3bd75", "#b99f61", "#e5cf8b", "#a8945d"]
  },
  autumn: {
    daySkyTop: "#9ca89a", daySkyBottom: "#d6bd87", nightSkyTop: "#0d1018", nightSkyBottom: "#2a2119",
    dayGroundTop: "#74643d", dayGroundBottom: "#35281a", nightGroundTop: "#382f22", nightGroundBottom: "#130e0a",
    stems: ["#8a7544", "#9b8249", "#6f6638", "#ab8750"], flowers: ["#d69b62", "#c87857", "#d9b477", "#b98a68"], seedHeads: ["#c3a064", "#a78551", "#d1ad69", "#947247"]
  },
  winter: {
    daySkyTop: "#9eafb8", daySkyBottom: "#ced2c7", nightSkyTop: "#08101c", nightSkyBottom: "#1b2428",
    dayGroundTop: "#687568", dayGroundBottom: "#29362f", nightGroundTop: "#303c37", nightGroundBottom: "#0e1714",
    stems: ["#71806c", "#7e8b74", "#5f7060", "#8f987d"], flowers: ["#d6d8d0", "#c3c9cb", "#e1ddc9", "#b9c3cc"], seedHeads: ["#b9b5a0", "#a7a28e", "#ccc7af", "#979684"]
  }
};

function readOptions() {
  return {
    seed: seed?.value || "meadow-42",
    density: density?.value || 1500,
    wind: wind?.value || 0.34,
    season: season?.value || "spring",
    timeOfDay: time?.value || 15.5
  };
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

function formatTime(hours) {
  const totalMinutes = Math.round(Number(hours) * 60) % (24 * 60);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
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
  const skyBottom = height * 0.59;
  const gradient = ctx.createLinearGradient(0, 0, 0, skyBottom);
  gradient.addColorStop(0, mixColor(palette.nightSkyTop, palette.daySkyTop, daylight));
  gradient.addColorStop(1, mixColor(palette.nightSkyBottom, palette.daySkyBottom, daylight));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, skyBottom + 2);

  const night = 1 - daylight;
  if (night > 0.1) {
    ctx.save();
    ctx.globalAlpha = night * 0.82;
    ctx.fillStyle = "#e9efdc";
    for (let i = 0; i < world.stars.length; i += 1) {
      const star = world.stars[i];
      const twinkle = 0.72 + Math.sin(world.time * 0.8 * motionScale + star.phase) * 0.28;
      ctx.globalAlpha = night * (0.32 + twinkle * 0.55);
      ctx.beginPath();
      ctx.arc(star.x * width, star.y * skyBottom, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const sunAlpha = Math.max(0, daylight - 0.15) * 0.36;
  if (sunAlpha > 0) {
    const sunX = width * (0.15 + (world.options.timeOfDay / 24) * 0.7);
    const sunY = height * (0.19 + Math.abs(world.options.timeOfDay - 12) * 0.007);
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.min(width, height) * 0.18);
    glow.addColorStop(0, `rgb(255 238 184 / ${sunAlpha})`);
    glow.addColorStop(1, "rgb(255 238 184 / 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, skyBottom);
  }
}

function ridgeY(x, baseline, amplitude, phase, frequency) {
  return baseline + Math.sin(x * frequency + phase) * amplitude + Math.sin(x * frequency * 0.47 + phase * 1.7) * amplitude * 0.43;
}

function drawRidge(palette, daylight, baseline, amplitude, phase, frequency, alpha, colorDay, colorNight) {
  const { width, height } = viewport;
  ctx.beginPath();
  ctx.moveTo(0, height);
  const segments = 28;
  for (let i = 0; i <= segments; i += 1) {
    const nx = i / segments;
    ctx.lineTo(nx * width, ridgeY(nx, baseline, amplitude, phase, frequency) * height);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = mixColor(colorNight, colorDay, daylight);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawGround(palette, daylight) {
  const { width, height } = viewport;
  drawRidge(palette, daylight, 0.47, 0.025, world.terrain.ridgeA, 7.2, 0.76, "#718269", "#1b2a28");
  drawRidge(palette, daylight, 0.515, 0.035, world.terrain.ridgeB, 5.1, 0.9, "#465e45", "#16221c");

  const groundTop = height * 0.54;
  const gradient = ctx.createLinearGradient(0, groundTop, 0, height);
  gradient.addColorStop(0, mixColor(palette.nightGroundTop, palette.dayGroundTop, daylight));
  gradient.addColorStop(1, mixColor(palette.nightGroundBottom, palette.dayGroundBottom, daylight));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, groundTop, width, height - groundTop);

  const haze = ctx.createLinearGradient(0, height * 0.51, 0, height * 0.7);
  haze.addColorStop(0, `rgb(222 226 204 / ${(0.035 + world.terrain.haze * 0.04) * daylight})`);
  haze.addColorStop(1, "rgb(222 226 204 / 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, height * 0.5, width, height * 0.22);
}

function buildPlantColors(palette, daylight) {
  const stems = new Array(4);
  const flowers = new Array(4);
  const seedHeads = new Array(4);
  for (let i = 0; i < 4; i += 1) {
    stems[i] = mixColor("#26372e", palette.stems[i], 0.34 + daylight * 0.66);
    flowers[i] = mixColor("#62656a", palette.flowers[i], 0.27 + daylight * 0.73);
    seedHeads[i] = mixColor("#555447", palette.seedHeads[i], 0.3 + daylight * 0.7);
  }
  return { stems, flowers, seedHeads };
}

function drawLeaf(x, y, bend, size, side, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + side * size * 0.7 + bend * size * 0.2, y - size * 0.55, x + side * size, y - size * 0.08);
  ctx.quadraticCurveTo(x + side * size * 0.58, y + size * 0.14, x, y);
  ctx.fill();
}

function drawPlant(plant, colors, motionScale, daylight) {
  const { width, height } = viewport;
  const x = plant.x * width;
  const baseY = plant.y * height;
  const growth = plant.growth;
  const plantHeight = Math.max(1.4, plant.baseHeight * height * growth);
  const vigor = Math.max(0.2, Math.min(1.15, plant.vigor));
  const bend = plantBend(world, plant) * (reducedMotion.matches ? 0.35 : motionScale);
  const tipX = x + bend * plantHeight;
  const tipY = baseY - plantHeight;
  const midX = x + bend * plantHeight * 0.34;
  const midY = baseY - plantHeight * 0.52;
  const variant = plant.variant & 3;
  const stemColor = colors.stems[variant];
  const perspective = 0.55 + plant.y * 0.65;

  ctx.strokeStyle = stemColor;
  ctx.lineWidth = Math.max(0.55, plant.width * perspective * (0.62 + vigor * 0.34));
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.54 + daylight * 0.26 + vigor * 0.16;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(midX, midY, tipX, tipY);
  ctx.stroke();

  if (plant.species === "grass") {
    if (plant.variant % 2 === 0 && growth > 0.24) {
      ctx.globalAlpha *= 0.65;
      ctx.beginPath();
      ctx.moveTo(x + plant.width * 0.7, baseY);
      ctx.quadraticCurveTo(x - bend * plantHeight * 0.13, baseY - plantHeight * 0.42, x - plant.lean * plantHeight * 0.7, baseY - plantHeight * (0.52 + plant.variant * 0.03));
      ctx.stroke();
    }
  } else if (plant.species === "flower") {
    if (growth > 0.38) {
      const leafY = baseY - plantHeight * 0.46;
      drawLeaf(midX * 0.55 + x * 0.45, leafY, bend, Math.max(2, plantHeight * 0.13) * vigor, plant.leafSide, stemColor);
    }
    if (growth > 0.66) {
      const bloom = Math.max(1.3, Math.min(5.5, plant.headSize * perspective * (1.2 + growth * 1.65))) * vigor;
      const petalColor = colors.flowers[variant];
      ctx.fillStyle = petalColor;
      ctx.globalAlpha = 0.5 + daylight * 0.42;
      for (let p = 0; p < plant.petals; p += 1) {
        const angle = (p / plant.petals) * Math.PI * 2 + plant.phase * 0.13;
        ctx.beginPath();
        ctx.ellipse(tipX + Math.cos(angle) * bloom * 0.72, tipY + Math.sin(angle) * bloom * 0.55, bloom * 0.58, bloom * 0.31, angle, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = colors.seedHeads[(variant + 1) & 3];
      ctx.globalAlpha = 0.88;
      ctx.beginPath();
      ctx.arc(tipX, tipY, Math.max(0.8, bloom * 0.36), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    if (growth > 0.3) {
      const leafSize = Math.max(2, plantHeight * 0.11) * vigor;
      drawLeaf(midX, midY + plantHeight * 0.11, bend, leafSize, plant.leafSide, stemColor);
      if (growth > 0.48) drawLeaf(midX, midY - plantHeight * 0.05, bend, leafSize * 0.78, -plant.leafSide, stemColor);
    }
    if (growth > 0.58) {
      ctx.fillStyle = colors.seedHeads[variant];
      ctx.globalAlpha = 0.5 + daylight * 0.34;
      const head = Math.max(1.2, plant.headSize * perspective * 2.4 * growth);
      ctx.beginPath();
      ctx.ellipse(tipX, tipY, head * 0.72, head * 1.55, bend * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawMoistureAndRain(daylight, motionScale) {
  const { width, height } = viewport;
  for (let i = 0; i < world.rainBursts.length; i += 1) {
    const burst = world.rainBursts[i];
    const life = 1 - burst.age / burst.life;
    const x = burst.x * width;
    const y = burst.y * height;
    const radius = burst.radius * Math.max(width, height) * (0.7 + burst.age * 0.4);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `rgb(111 158 169 / ${life * 0.12})`);
    glow.addColorStop(1, "rgb(111 158 169 / 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

    const dropCount = reducedMotion.matches ? 4 : 11;
    ctx.strokeStyle = mixColor("#758996", "#c8dde0", daylight);
    ctx.lineWidth = 0.75;
    ctx.globalAlpha = life * 0.38;
    for (let d = 0; d < dropCount; d += 1) {
      const phase = ((burst.id * 17 + d * 23) % 97) / 97;
      const offsetX = (phase - 0.5) * radius * 1.35;
      const travel = ((burst.age * (1.7 + d * 0.03) * motionScale + phase) % 1) * radius * 1.25;
      const dropX = x + offsetX;
      const dropY = y - radius * 0.75 + travel;
      ctx.beginPath();
      ctx.moveTo(dropX, dropY - 5);
      ctx.lineTo(dropX - 1.2, dropY + 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function drawFireflies(daylight, motionScale) {
  const night = 1 - daylight;
  if (night < 0.42) return;
  const { width, height } = viewport;
  ctx.fillStyle = "#d8e99b";
  for (let i = 0; i < 18; i += 1) {
    const source = world.stars[i];
    const drift = reducedMotion.matches ? 0.15 : motionScale;
    const x = ((source.x + Math.sin(world.time * 0.09 * drift + source.phase) * 0.018 + 1) % 1) * width;
    const y = (0.58 + source.y * 0.55 + Math.cos(world.time * 0.12 * drift + source.phase) * 0.018) * height;
    const pulse = 0.35 + Math.sin(world.time * 1.1 * drift + source.phase) * 0.3;
    ctx.globalAlpha = Math.max(0, night * pulse);
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + source.size * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function renderScene() {
  const palette = PALETTES[world.options.season];
  const daylight = daylightFor(world.options.timeOfDay);
  const motionScale = reducedMotion.matches ? 0.28 : 1;
  drawSky(palette, daylight, motionScale);
  drawGround(palette, daylight);
  drawMoistureAndRain(daylight, motionScale);
  const colors = buildPlantColors(palette, daylight);
  for (let i = 0; i < world.plants.length; i += 1) drawPlant(world.plants[i], colors, motionScale, daylight);
  drawFireflies(daylight, motionScale);
}

function updateHud(now) {
  if (now - lastHudUpdate < 180) return;
  lastHudUpdate = now;
  populationValue.textContent = world.plants.length.toLocaleString();
  moistureValue.textContent = `${Math.round(averageMoisture(world) * 100)}%`;
  simValue.textContent = `${world.time.toFixed(1)}s`;
  stateValue.textContent = world.paused ? "paused" : "growing";
}

function animationFrame(now) {
  const currentDpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  if (Math.abs(currentDpr - viewport.dpr) > 0.01) resizeCanvas();
  const frameDelta = Math.max(0, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  advanceBiome(world, frameDelta, MAX_FRAME_DELTA);
  renderScene();
  updateHud(now);
  requestAnimationFrame(animationFrame);
}

function applyInteraction(action) {
  if (!action) return;
  if (action.mode === "rain") {
    applyRain(world, action.x, action.y, action.intensity, 0.105);
  } else {
    const dx = Math.abs(action.dx) + Math.abs(action.dy) < 1e-5 ? 1 : action.dx;
    applyGust(world, action.x, action.y, action.intensity, dx, action.dy);
  }
}

function pointForEvent(event) {
  return clientToBiomePoint(canvas.getBoundingClientRect(), event.clientX, event.clientY);
}

function finishPointer(event, cancelled = false) {
  const ended = cancelled ? cancelPointerSession(pointerSession, event.pointerId) : endPointerSession(pointerSession, event.pointerId);
  if (!ended) return;
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  canvas.classList.remove("is-interacting");
}

canvas.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary && event.pointerType !== "mouse") return;
  event.preventDefault();
  try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic events may not be capturable */ }
  canvas.classList.add("is-interacting");
  applyInteraction(beginPointerSession(pointerSession, event.pointerId, interactionMode, pointForEvent(event)));
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerSession.active) return;
  event.preventDefault();
  applyInteraction(movePointerSession(pointerSession, event.pointerId, pointForEvent(event)));
});

canvas.addEventListener("pointerup", (event) => finishPointer(event, false));
canvas.addEventListener("pointercancel", (event) => finishPointer(event, true));
canvas.addEventListener("pointerleave", (event) => {
  if (pointerSession.active && !canvas.hasPointerCapture?.(event.pointerId)) finishPointer(event, true);
});
canvas.addEventListener("lostpointercapture", (event) => {
  cancelPointerSession(pointerSession, event.pointerId);
  canvas.classList.remove("is-interacting");
});

function setInteractionMode(mode) {
  interactionMode = mode === "rain" ? "rain" : "wind";
  modeWind.setAttribute("aria-pressed", String(interactionMode === "wind"));
  modeRain.setAttribute("aria-pressed", String(interactionMode === "rain"));
  canvas.dataset.mode = interactionMode;
  message.textContent = interactionMode === "rain" ? "Paint rain into the soil. Moist areas grow faster." : "Drag through the meadow to send a local gust.";
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
season.addEventListener("change", () => setSeason(world, season.value));
time.addEventListener("input", () => {
  timeValue.value = formatTime(time.value);
  setTimeOfDay(world, time.value);
});

pause.addEventListener("click", () => {
  setPaused(world, !world.paused);
  lastFrameTime = performance.now();
  syncControlsFromWorld();
});

reset.addEventListener("click", () => {
  const requested = readOptions();
  world = createBiome(requested);
  message.textContent = `Reset ${world.options.seed} to its deterministic baseline.`;
  syncControlsFromWorld();
});

regenerate.addEventListener("click", () => {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  seed.value = `meadow-${values[0].toString(36)}${values[1].toString(36)}`;
  world = createBiome(readOptions());
  message.textContent = `New variation: ${world.options.seed}`;
  syncControlsFromWorld();
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
  URL.revokeObjectURL(url);
  message.textContent = `Snapshot exported at simulation ${world.time.toFixed(1)}s.`;
});

load.addEventListener("click", () => loadFile.click());
loadFile.addEventListener("change", async () => {
  const file = loadFile.files?.[0];
  if (!file) return;
  try {
    world = loadSnapshot(JSON.parse(await file.text()));
    syncControlsFromWorld();
    lastFrameTime = performance.now();
    message.textContent = `Snapshot restored: ${world.options.seed} at ${world.time.toFixed(1)}s.`;
  } catch (error) {
    message.textContent = `Could not load snapshot: ${error.message}`;
  } finally {
    loadFile.value = "";
  }
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
    setMode: setInteractionMode
  })
});

syncControlsFromWorld();
setInteractionMode("wind");
resizeCanvas();
requestAnimationFrame(animationFrame);
