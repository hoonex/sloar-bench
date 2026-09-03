import { applyGust, createBiome, plantBend, stepBiome } from "./simulation.js";

const canvas = document.querySelector("#biome");
const ctx = canvas.getContext("2d");
const density = document.querySelector("#density");
const wind = document.querySelector("#wind");
const seed = document.querySelector("#seed");
const season = document.querySelector("#season");
const densityValue = document.querySelector("#density-value");
const windValue = document.querySelector("#wind-value");
const regenerate = document.querySelector("#regenerate");
const pause = document.querySelector("#pause");

let world;
let lastTime = performance.now();

function readOptions() {
  return { density: density.value, wind: wind.value, seed: seed.value, season: season.value };
}

function rebuild() {
  world = createBiome(readOptions());
  densityValue.value = density.value;
  windValue.value = wind.value;
}

function palette() {
  if (world.options.season === "autumn") return ["#0b1510", "#7a6a37", "#b37b3e"];
  if (world.options.season === "summer") return ["#0a1710", "#4f8b50", "#a8d26d"];
  return ["#0b1711", "#619a61", "#d7df91"];
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function render(now) {
  const rect = canvas.getBoundingClientRect();
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  stepBiome(world, dt);
  const [background, stem, flower] = palette();

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.lineCap = "round";

  for (const plant of world.plants) {
    const x = plant.x * rect.width;
    const baseY = plant.y * rect.height;
    const height = plant.height * rect.height;
    const bend = plantBend(world, plant);
    const tipX = x + bend * height;
    const tipY = baseY - height;

    ctx.strokeStyle = stem;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.quadraticCurveTo(x + bend * height * 0.35, baseY - height * 0.45, tipX, tipY);
    ctx.stroke();

    if (plant.flower) {
      ctx.fillStyle = flower;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  requestAnimationFrame(render);
}

for (const control of [density, wind, seed, season]) control.addEventListener("input", rebuild);
regenerate.addEventListener("click", () => {
  seed.value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  rebuild();
});
pause.addEventListener("click", () => {
  world.paused = !world.paused;
  pause.textContent = world.paused ? "Resume" : "Pause";
});

canvas.addEventListener("pointermove", (event) => {
  if (!(event.buttons & 1)) return;
  const rect = canvas.getBoundingClientRect();
  applyGust(world, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, 1);
});

new ResizeObserver(resize).observe(canvas);
rebuild();
resize();
requestAnimationFrame(render);
