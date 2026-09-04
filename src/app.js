import {
  addClip,
  createProject,
  moveClip,
  timeToX,
  xToTime
} from "./model.js";

const timeline = document.querySelector("#timeline");
const ruler = document.querySelector("#ruler");
const trackList = document.querySelector("#track-list");
const play = document.querySelector("#play");
const stop = document.querySelector("#stop");
const readout = document.querySelector("#time-readout");
const snap = document.querySelector("#snap");
const zoom = document.querySelector("#zoom");
const add = document.querySelector("#add");

const project = createProject();
addClip(project, "drums", 0, 2, "Kick idea");
addClip(project, "bass", 2, 3, "Bass sketch");
addClip(project, "texture", 5, 2.5, "Room tone");

let lastFrame = performance.now();
let drag = null;

function renderRuler() {
  ruler.innerHTML = "";
  ruler.style.width = `${timeToX(project.length, project.zoom)}px`;
  for (let second = 0; second <= project.length; second += 1) {
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.style.left = `${timeToX(second, project.zoom)}px`;
    tick.textContent = `${second}s`;
    ruler.append(tick);
  }
}

function renderTracks() {
  trackList.innerHTML = "";
  for (const track of project.tracks) {
    const row = document.createElement("div");
    row.className = "track-label";
    row.textContent = track.name;
    trackList.append(row);
  }
}

function renderTimeline() {
  timeline.innerHTML = "";
  timeline.style.width = `${timeToX(project.length, project.zoom)}px`;
  timeline.style.height = `${project.tracks.length * 68}px`;

  project.tracks.forEach((track, trackIndex) => {
    track.clips.forEach((clip) => {
      const element = document.createElement("div");
      element.className = "clip";
      element.dataset.clipId = clip.id;
      element.style.left = `${timeToX(clip.start, project.zoom)}px`;
      element.style.top = `${trackIndex * 68 + 10}px`;
      element.style.width = `${Math.max(36, timeToX(clip.duration, project.zoom))}px`;
      element.innerHTML = `<strong>${clip.label}</strong><small>${clip.start.toFixed(1)}–${(clip.start + clip.duration).toFixed(1)}s</small>`;
      timeline.append(element);
    });
  });

  const playhead = document.createElement("div");
  playhead.className = "playhead";
  playhead.style.left = `${timeToX(project.playhead, project.zoom)}px`;
  timeline.append(playhead);
}

function render() {
  renderRuler();
  renderTracks();
  renderTimeline();
  readout.textContent = `${project.playhead.toFixed(2)}s`;
}

function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (project.playing) {
    project.playhead += dt;
    if (project.playhead >= project.length) {
      project.playhead = 0;
      project.playing = false;
    }
    renderTimeline();
    readout.textContent = `${project.playhead.toFixed(2)}s`;
  }
  requestAnimationFrame(frame);
}

play.addEventListener("click", () => { project.playing = !project.playing; });
stop.addEventListener("click", () => { project.playing = false; project.playhead = 0; renderTimeline(); readout.textContent = "0.00s"; });
snap.addEventListener("change", () => { project.snap = Number(snap.value); });
zoom.addEventListener("input", () => { project.zoom = Number(zoom.value); render(); });
add.addEventListener("click", () => { addClip(project, "voice", project.playhead, 2, "Voice note"); renderTimeline(); });

timeline.addEventListener("pointerdown", (event) => {
  const clip = event.target.closest(".clip");
  if (!clip) {
    const rect = timeline.getBoundingClientRect();
    project.playhead = Math.min(project.length, xToTime(event.clientX - rect.left, project.zoom));
    renderTimeline();
    return;
  }
  drag = {
    pointerId: event.pointerId,
    clipId: clip.dataset.clipId,
    originX: event.clientX,
    originStart: project.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clip.dataset.clipId)?.start ?? 0
  };
  clip.setPointerCapture?.(event.pointerId);
});

timeline.addEventListener("pointermove", (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const delta = xToTime(event.clientX - drag.originX, project.zoom);
  moveClip(project, drag.clipId, drag.originStart + delta);
  renderTimeline();
});

function endDrag(event) {
  if (drag?.pointerId === event.pointerId) drag = null;
}
timeline.addEventListener("pointerup", endDrag);
timeline.addEventListener("pointercancel", endDrag);

render();
requestAnimationFrame(frame);
