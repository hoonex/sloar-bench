const $ = (selector) => document.querySelector(selector);
const dom = {
  scroll: $("#arranger-scroll"), grid: $("#arranger-grid"), timeline: $("#timeline"), ruler: $("#ruler"), trackList: $("#track-list"),
  play: $("#play"), playIcon: $("#play-icon"), playLabel: $("#play-label"), stop: $("#stop"), readout: $("#time-readout"),
  loopToggle: $("#loop-toggle"), loopToggleInspector: $("#loop-toggle-inspector"), loopReadout: $("#loop-readout"), loopStart: $("#loop-start"), loopEnd: $("#loop-end"),
  snap: $("#snap"), zoom: $("#zoom"), zoomIn: $("#zoom-in"), zoomOut: $("#zoom-out"), zoomReadout: $("#zoom-readout"),
  add: $("#add"), duplicate: $("#duplicate"), delete: $("#delete"), undo: $("#undo"), redo: $("#redo"),
  projectName: $("#project-name"), projectStatus: $("#project-status"), selectionStatus: $("#selection-status"), interactionStatus: $("#interaction-status"),
  inspectorTitle: $("#inspector-title"), inspectorTrack: $("#inspector-track"), emptyInspector: $("#empty-inspector"), clipForm: $("#clip-form"),
  clipName: $("#clip-name"), clipStart: $("#clip-start"), clipDuration: $("#clip-duration"), clipTrack: $("#clip-track"), clipNotes: $("#clip-notes"),
  inspectorDuplicate: $("#inspector-duplicate"), inspectorDelete: $("#inspector-delete"),
  dialog: $("#project-dialog"), projectJsonButton: $("#project-json"), projectJsonText: $("#project-json-text"), projectError: $("#project-error"),
  refreshJson: $("#refresh-json"), downloadJson: $("#download-json"), importFile: $("#import-file"), loadJson: $("#load-json"), toast: $("#toast")
};

const TRACK_COLORS = {
  coral: "#d87965", amber: "#d2a956", mint: "#76b89a", violet: "#9b88d1", cyan: "#6ca8b4", rose: "#c98291"
};
const history = new History(HISTORY_LIMIT);
let project = createProject({ name: "Night grid", duration: 16, bpm: 112, zoom: 88, snap: 0.5 });
addClip(project, "drums", 0, 2, "Dust kick", { notes: "Foundation groove" });
addClip(project, "drums", 4, 2, "Break fill");
addClip(project, "bass", 1, 3, "Low pulse");
addClip(project, "bass", 8, 4, "Bass answer");
addClip(project, "texture", 5, 2.5, "Room wash");
addClip(project, "texture", 11, 3, "Tape air");
addClip(project, "voice", 2, 2, "Glass motif");
addClip(project, "voice", 12, 2.5, "Upper phrase");

let selectedClipId = null;
let interaction = null;
let transportLast = null;
let toastTimer = 0;
let playheadNode = null;
let loopNode = null;

function laneHeight() {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--lane-height")) || 76;
}
function timelineWidth() { return timeToX(projectDuration(project), project.zoom); }
function clipCount() { return project.tracks.reduce((sum, track) => sum + track.clips.length, 0); }
function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`;
}
function trackColor(track) { return TRACK_COLORS[track.color] || track.color || "#a8a384"; }
function isEditableTarget(target) {
  return target instanceof HTMLElement && Boolean(target.closest("input,textarea,select,[contenteditable='true'],dialog"));
}
function showToast(message) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => dom.toast.classList.remove("visible"), 1800);
}
function setInteractionStatus(message = "Ready") { dom.interactionStatus.textContent = message; }

function validSelection() {
  if (selectedClipId && !findClip(project, selectedClipId)) selectedClipId = null;
  return selectedClipId ? findClip(project, selectedClipId) : null;
}

function renderRuler() {
  const width = timelineWidth();
  dom.ruler.replaceChildren();
  dom.ruler.style.width = `${width}px`;
  const major = project.zoom >= 150 ? 1 : project.zoom >= 80 ? 2 : 4;
  const minor = project.zoom >= 150 ? 0.25 : project.zoom >= 80 ? 0.5 : 1;
  const duration = projectDuration(project);
  const fragment = document.createDocumentFragment();
  for (let time = 0; time <= duration + 1e-9; time += minor) {
    const normalized = Number(time.toFixed(6));
    const isMajor = Math.abs(normalized / major - Math.round(normalized / major)) < 1e-6;
    const tick = document.createElement("span");
    tick.className = `ruler-tick ${isMajor ? "major" : "minor"}`;
    tick.style.left = `${timeToX(normalized, project.zoom)}px`;
    fragment.append(tick);
    if (isMajor) {
      const label = document.createElement("span");
      label.className = "ruler-label";
      label.style.left = `${timeToX(normalized, project.zoom)}px`;
      label.textContent = `${normalized.toFixed(normalized % 1 ? 1 : 0)}s`;
      fragment.append(label);
    }
  }
  dom.ruler.append(fragment);
}

function renderTracks() {
  const fragment = document.createDocumentFragment();
  dom.trackList.replaceChildren();
  for (const track of project.tracks) {
    const head = document.createElement("div");
    head.className = "track-head";
    head.dataset.trackId = track.id;
    head.style.setProperty("--track-color", trackColor(track));
    head.innerHTML = `<span class="track-color" aria-hidden="true"></span><span class="track-copy"><span class="track-name"></span><span class="track-kind"></span></span><button class="track-mute" type="button" aria-label="Mute ${escapeHtml(track.name)}" aria-pressed="${track.muted}">M</button>`;
    head.querySelector(".track-name").textContent = track.name;
    head.querySelector(".track-kind").textContent = track.instrument || "track";
    fragment.append(head);
  }
  dom.trackList.append(fragment);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function makeClipNode(track, clip, trackIndex) {
  const element = document.createElement("div");
  element.className = "clip";
  element.dataset.clipId = clip.id;
  element.tabIndex = 0;
  element.setAttribute("role", "option");
  element.setAttribute("aria-label", `${clip.label}, ${track.name}, ${clip.start.toFixed(2)} seconds, duration ${clip.duration.toFixed(2)} seconds`);
  element.setAttribute("aria-selected", String(clip.id === selectedClipId));
  element.style.setProperty("--clip-color", trackColor(track));
  element.innerHTML = `<span class="resize-handle left" data-edge="left" aria-hidden="true"></span><span class="clip-body"><span class="clip-name"></span><span class="clip-time"></span></span><span class="clip-texture" aria-hidden="true"></span><span class="resize-handle right" data-edge="right" aria-hidden="true"></span>`;
  element.querySelector(".clip-name").textContent = clip.label;
  updateClipGeometry(element, track, clip, trackIndex);
  return element;
}

function updateClipGeometry(element, track, clip, trackIndex) {
  element.style.transform = `translate(${timeToX(clip.start, project.zoom)}px, ${trackIndex * laneHeight() + 12}px)`;
  element.style.width = `${timeToX(clip.duration, project.zoom)}px`;
  element.style.setProperty("--clip-color", trackColor(track));
  element.setAttribute("aria-label", `${clip.label}, ${track.name}, ${clip.start.toFixed(2)} seconds, duration ${clip.duration.toFixed(2)} seconds`);
  const name = element.querySelector(".clip-name");
  const time = element.querySelector(".clip-time");
  if (name) name.textContent = clip.label;
  if (time) time.textContent = `${clip.start.toFixed(2)} → ${(clip.start + clip.duration).toFixed(2)}s`;
}

function renderTimeline() {
  const width = timelineWidth();
  const height = project.tracks.length * laneHeight();
  dom.timeline.replaceChildren();
  dom.timeline.style.width = `${width}px`;
  dom.timeline.style.height = `${height}px`;
  dom.timeline.style.setProperty("--major-grid", `${Math.max(1, project.zoom * (project.zoom >= 80 ? 2 : 4))}px`);
  dom.timeline.style.setProperty("--minor-grid", `${Math.max(1, project.zoom * (project.zoom >= 150 ? 0.25 : project.zoom >= 80 ? 0.5 : 1))}px`);

  const fragment = document.createDocumentFragment();
  project.tracks.forEach((track, trackIndex) => {
    const lane = document.createElement("div");
    lane.className = "lane-band";
    lane.dataset.trackId = track.id;
    lane.style.top = `${trackIndex * laneHeight()}px`;
    lane.style.setProperty("--track-color", trackColor(track));
    fragment.append(lane);
  });

  loopNode = document.createElement("div");
  loopNode.className = "loop-region";
  loopNode.hidden = !project.loop.enabled;
  fragment.append(loopNode);

  project.tracks.forEach((track, trackIndex) => {
    for (const clip of track.clips) fragment.append(makeClipNode(track, clip, trackIndex));
  });

  playheadNode = document.createElement("div");
  playheadNode.className = "playhead";
  fragment.append(playheadNode);
  dom.timeline.append(fragment);
  updateLoopGeometry();
  updatePlayheadOnly();
}

function updateClipOnly(clipId) {
  const found = findClip(project, clipId);
  const element = dom.timeline.querySelector(`.clip[data-clip-id="${CSS.escape(clipId)}"]`);
  if (!found || !element) return;
  updateClipGeometry(element, found.track, found.clip, found.trackIndex);
  element.setAttribute("aria-selected", String(clipId === selectedClipId));
}

function updateLoopGeometry() {
  if (!loopNode) return;
  loopNode.hidden = !project.loop.enabled;
  loopNode.style.transform = `translateX(${timeToX(project.loop.start, project.zoom)}px)`;
  loopNode.style.width = `${timeToX(project.loop.end - project.loop.start, project.zoom)}px`;
}

function updatePlayheadOnly() {
  if (playheadNode) playheadNode.style.transform = `translateX(${timeToX(project.playhead, project.zoom)}px)`;
  dom.readout.textContent = formatTime(project.playhead);
}

function renderInspector() {
  const found = validSelection();
  dom.duplicate.disabled = !found;
  dom.delete.disabled = !found;
  dom.emptyInspector.hidden = Boolean(found);
  dom.clipForm.hidden = !found;
  if (!found) {
    dom.inspectorTitle.textContent = "Nothing selected";
    dom.inspectorTrack.textContent = "—";
    dom.selectionStatus.textContent = "No clip selected";
  } else {
    dom.inspectorTitle.textContent = found.clip.label;
    dom.inspectorTrack.textContent = found.track.name;
    dom.selectionStatus.textContent = `${found.track.name} / ${found.clip.label} · ${found.clip.start.toFixed(2)}–${(found.clip.start + found.clip.duration).toFixed(2)}s`;
    dom.clipName.value = found.clip.label;
    dom.clipStart.value = String(found.clip.start);
    dom.clipDuration.value = String(found.clip.duration);
    dom.clipNotes.value = found.clip.notes || "";
    dom.clipTrack.replaceChildren(...project.tracks.map((track) => new Option(track.name, track.id, false, track.id === found.track.id)));
  }
  dom.loopToggle.setAttribute("aria-pressed", String(project.loop.enabled));
  dom.loopToggleInspector.setAttribute("aria-pressed", String(project.loop.enabled));
  dom.loopToggleInspector.textContent = project.loop.enabled ? "On" : "Off";
  dom.loopStart.value = String(project.loop.start);
  dom.loopEnd.value = String(project.loop.end);
  dom.loopStart.max = String(projectDuration(project));
  dom.loopEnd.max = String(projectDuration(project));
  dom.loopReadout.textContent = `${project.loop.start.toFixed(1)}–${project.loop.end.toFixed(1)}`;
}

function renderChrome() {
  dom.projectName.textContent = project.name;
  dom.snap.value = String(project.snap);
  dom.zoom.value = String(project.zoom);
  dom.zoomReadout.textContent = `${Math.round(project.zoom)} px/s`;
  dom.projectStatus.textContent = `${projectDuration(project).toFixed(1)}s · ${project.tracks.length} tracks · ${clipCount()} clips`;
  dom.play.setAttribute("aria-label", project.playing ? "Pause" : "Play");
  dom.playIcon.textContent = project.playing ? "Ⅱ" : "▶";
  dom.playLabel.textContent = project.playing ? "Pause" : "Play";
  dom.undo.disabled = history.undoStack.length === 0;
  dom.redo.disabled = history.redoStack.length === 0;
}

function renderAll({ preserveScroll = true } = {}) {
  const scrollLeft = dom.scroll.scrollLeft;
  const scrollTop = dom.scroll.scrollTop;
  validSelection();
  renderRuler();
  renderTracks();
  renderTimeline();
  renderInspector();
  renderChrome();
  if (preserveScroll) {
    dom.scroll.scrollLeft = scrollLeft;
    dom.scroll.scrollTop = scrollTop;
  }
}

function selectClip(clipId, { focus = false } = {}) {
  selectedClipId = clipId && findClip(project, clipId) ? clipId : null;
  dom.timeline.querySelectorAll(".clip[aria-selected='true']").forEach((node) => node.setAttribute("aria-selected", "false"));
  if (selectedClipId) {
    const node = dom.timeline.querySelector(`.clip[data-clip-id="${CSS.escape(selectedClipId)}"]`);
    node?.setAttribute("aria-selected", "true");
    if (focus) node?.focus({ preventScroll: true });
  }
  renderInspector();
  renderChrome();
}

function replaceProject(nextProject, { clearHistory = false } = {}) {
  project = nextProject;
  project.playing = false;
  transportLast = null;
  interaction = null;
  if (clearHistory) history.clear();
  if (selectedClipId && !findClip(project, selectedClipId)) selectedClipId = null;
  renderAll({ preserveScroll: false });
}
