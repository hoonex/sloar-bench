import { createTreeModel } from "./tree-model.js";

const canvas = document.querySelector("#tree-canvas");
const ctx = canvas.getContext("2d");

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

const palettes = {
  forest: { background: "#101a13", branch: "#b9c6a7" },
  dusk: { background: "#151426", branch: "#c6b6d9" },
  blossom: { background: "#211417", branch: "#d8b9ad" }
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

function draw() {
  const model = createTreeModel(readOptions());
  const palette = palettes[model.options.palette] ?? palettes.forest;
  const { width, height } = canvas;

  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height * 0.9);
  ctx.strokeStyle = palette.branch;
  ctx.lineCap = "round";

  for (const branch of model.branches) {
    ctx.lineWidth = Math.max(2, 12 - branch.level * 2);
    ctx.beginPath();
    ctx.moveTo(branch.x1, branch.y1);
    ctx.lineTo(branch.x2, branch.y2);
    ctx.stroke();
  }
  ctx.restore();
}

function syncLabels() {
  outputs.angle.value = `${controls.angle.value}°`;
  outputs.depth.value = controls.depth.value;
  outputs.length.value = controls.length.value;
}

for (const control of Object.values(controls)) {
  control.addEventListener("input", () => {
    syncLabels();
    draw();
  });
}

document.querySelector("#regenerate").addEventListener("click", () => {
  const current = Number(controls.seed.value) || 0;
  controls.seed.value = String(current + 1);
  draw();
});

syncLabels();
draw();
