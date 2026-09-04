import {
  MIN_CLIP_DURATION,
  addClip,
  advancePlayhead,
  assertProjectInvariants,
  createHistory,
  createProject,
  deleteClip,
  duplicateClip,
  findClip,
  historyCommit,
  historyRedo,
  historyUndo,
  moveClip,
  normalizeProjectSnapshot,
  renameClip,
  replaceHistoryPresent,
  resizeClip,
  resizeClipLeft,
  resizeClipRight,
  serializeProject,
  setLoop,
  snapTime,
  timeToX,
  viewportXToTime,
  zoomScrollForAnchor
} from "./model.js";

const RULER_HEIGHT = 40;
const LANE_HEIGHT = 74;
const DEFAULT_ZOOM = 88;

const dom = {
  timelineViewport: document.querySelector("#timeline-viewport"),
  timelineContent: document.querySelector("#timeline-content"),
  ruler: document.querySelector("#ruler"),
  laneStack: document.querySelector("#lane-stack"),
  trackList: document.querySelector("#track-list"),
  trackCount: document.querySelector("#track-count"),
  playhead: document.querySelector("#playhead"),
  loopRegion: document.querySelector("#loop-region"),
  play: document.querySelector("#play"),
  pause: document.querySelector("#pause"),
  stop: document.querySelector("#stop"),
  readout: document.querySelector("#time-readout"),
  snap: document.querySelector("#snap"),
  zoom: document.querySelector("#zoom"),
  zoomIn: document.querySelector("#zoom-in"),
  zoomOut: document.querySelector("#zoom-out"),
  add: document.querySelector("#add"),
  undo: document.querySelector("#undo"),
  redo: document.querySelector("#redo"),
  export: document.querySelector("#export"),
  importTrigger: document.querySelector("#import-trigger"),
  importFile: document.querySelector("#import-file"),
  loopEnabled: document.querySelector("#loop-enabled"),
  loopStart: document.querySelector("#loop-start"),
  loopEnd: document.querySelector("#loop-end"),
  loopToPlayhead: document.querySelector("#loop-to-playhead"),
  status: document.querySelector("#status-message"),
  viewReadout: document.querySelector("#view-readout"),
  inspectorEmpty: document.querySelector("#inspector-empty"),
  inspectorForm: document.querySelector("#inspector-form"),
  inspectorTitle: document.querySelector("#inspector-title"),
  clipName: document.querySelector("#clip-name"),
  clipStart: document.querySelector("#clip-start"),
  clipDuration: document.querySelector("#clip-duration"),
  clipTrack: document.querySelector("#clip-track"),
  clipEnd: document.querySelector("#clip-end"),
  clipId: document.querySelector("#clip-id"),
  duplicate: document.querySelector("#duplicate"),
  delete: document.querySelector("#delete")
};

let project = createProject();
addClip(project, "drums", 0, 2, "Kick lattice");
addClip(project, "drums", 4, 1.5, "Hat lift");
addClip(project, "bass", 2, 3, "Low orbit");
addClip(project, "texture", 5, 2.5, "Room tone");
addClip(project, "voice", 9, 3.5, "Vocal chop");
let history = createHistory(project);

const editor = {
  selectedClipId: null,
  gesture: null,
  view: { zoom: DEFAULT_ZOOM },
  transport: { playing: false, playhead: 0, lastClock: performance.now() },
  clipElements: new Map(),
  laneElements: new Map(),
  statusTimer: 0
};

function formatTime(seconds, precise = true) {
  const safe = Math.max(0, Number(seconds) || 0);
  const wholeMinutes = Math.floor(safe / 60);
  const rest = safe - wholeMinutes * 60;
  if (!precise) return `${wholeMinutes}:${Math.floor(rest).toString().padStart(2, "0")}`;
  return `${wholeMinutes.toString().padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`;
}

function setStatus(message, temporary = false) {
  dom.status.textContent = message;
  clearTimeout(editor.statusTimer);
  if (temporary) {
    editor.statusTimer = window.setTimeout(() => {
      dom.status.textContent = `Ready · ${project.snap}s snap`;
    }, 2200);
  }
}

function timelineWidth() {
  return Math.max(dom.timelineViewport.clientWidth, timeToX(project.length, editor.view.zoom));
}

function clipGeometry(clip) {
  return {
    left: timeToX(clip.start, editor.view.zoom),
    width: Math.max(10, timeToX(clip.duration, editor.view.zoom))
  };
}

function getTrackColor(trackId) {
  return project.tracks.find((track) => track.id === trackId)?.color ?? "#aaa";
}

function applyClipGeometry(element, preview) {
  const geometry = clipGeometry(preview);
  element.style.left = `${geometry.left}px`;
  element.style.width = `${geometry.width}px`;
  const meta = element.querySelector(".clip-time");
  if (meta) meta.textContent = `${preview.start.toFixed(2)} — ${(preview.start + preview.duration).toFixed(2)}`;
}

function renderRuler() {
  dom.ruler.replaceChildren();
  const zoom = editor.view.zoom;
  const candidates = [0.125, 0.25, 0.5, 1, 2, 4, 8];
  const minorStep = candidates.find((step) => step * zoom >= 16) ?? 8;
  const labelEvery = Math.max(1, Math.ceil(64 / (minorStep * zoom)));
  const tickCount = Math.ceil(project.length / minorStep);
  const fragment = document.createDocumentFragment();

  for (let index = 0; index <= tickCount; index += 1) {
    const time = Math.min(project.length, index * minorStep);
    const tick = document.createElement("span");
    const major = index % labelEvery === 0;
    tick.className = `tick ${major ? "major" : "minor"}`;
    tick.style.left = `${timeToX(time, zoom)}px`;
    tick.dataset.time = String(time);
    if (major) {
      const label = document.createElement("b");
      label.textContent = formatTime(time, false);
      tick.append(label);
    }
    fragment.append(tick);
  }
  dom.ruler.append(fragment);
}

function createTrackLabel(track, index) {
  const row = document.createElement("div");
  row.className = "track-label";
  row.dataset.trackId = track.id;
  row.style.setProperty("--track-color", track.color);
  row.innerHTML = `
    <span class="track-index">${String(index + 1).padStart(2, "0")}</span>
    <span class="track-swatch" aria-hidden="true"></span>
    <span class="track-name"><strong>${escapeHtml(track.name)}</strong><small>${track.clips.length} clip${track.clips.length === 1 ? "" : "s"}</small></span>
  `;
  return row;
}

function renderTracksAndClips() {
  editor.clipElements.clear();
  editor.laneElements.clear();
  dom.trackList.replaceChildren();
  dom.laneStack.replaceChildren();
  dom.clipTrack.replaceChildren();
  const labelFragment = document.createDocumentFragment();
  const laneFragment = document.createDocumentFragment();
  const optionFragment = document.createDocumentFragment();

  project.tracks.forEach((track, trackIndex) => {
    labelFragment.append(createTrackLabel(track, trackIndex));

    const option = document.createElement("option");
    option.value = track.id;
    option.textContent = track.name;
    optionFragment.append(option);

    const lane = document.createElement("div");
    lane.className = "track-lane";
    lane.dataset.trackId = track.id;
    lane.style.setProperty("--track-color", track.color);
    lane.setAttribute("aria-label", `${track.name} track`);
    editor.laneElements.set(track.id, lane);

    const laneGrid = document.createElement("div");
    laneGrid.className = "lane-grid";
    lane.append(laneGrid);

    for (const clip of track.clips) {
      const element = document.createElement("div");
      element.className = "clip";
      element.dataset.clipId = clip.id;
      element.dataset.trackId = track.id;
      element.tabIndex = editor.selectedClipId === clip.id ? 0 : -1;
      element.setAttribute("role", "button");
      element.setAttribute("aria-label", `${clip.label}, ${track.name}, starts ${clip.start.toFixed(2)} seconds, duration ${clip.duration.toFixed(2)} seconds`);
      element.setAttribute("aria-pressed", editor.selectedClipId === clip.id ? "true" : "false");
      if (editor.selectedClipId === clip.id) element.classList.add("selected");
      element.style.setProperty("--clip-color", clip.color || track.color);
      element.innerHTML = `
        <span class="resize-handle left" data-handle="left" aria-hidden="true"></span>
        <span class="clip-body">
          <strong>${escapeHtml(clip.label)}</strong>
          <small class="clip-time">${clip.start.toFixed(2)} — ${(clip.start + clip.duration).toFixed(2)}</small>
          <span class="clip-wave" aria-hidden="true"></span>
        </span>
        <span class="resize-handle right" data-handle="right" aria-hidden="true"></span>
      `;
      applyClipGeometry(element, clip);
      lane.append(element);
      editor.clipElements.set(clip.id, element);
    }
    laneFragment.append(lane);
  });

  dom.trackList.append(labelFragment);
  dom.laneStack.append(laneFragment);
  dom.clipTrack.append(optionFragment);
  dom.trackCount.textContent = String(project.tracks.length);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function updateTimelineDimensions() {
  const width = timelineWidth();
  dom.timelineContent.style.width = `${width}px`;
  dom.timelineContent.style.setProperty("--timeline-width", `${width}px`);
  dom.laneStack.style.height = `${project.tracks.length * LANE_HEIGHT}px`;
}

function updatePlayhead() {
  const x = timeToX(editor.transport.playhead, editor.view.zoom);
  dom.playhead.style.transform = `translate3d(${x}px, 0, 0)`;
  dom.readout.textContent = formatTime(editor.transport.playhead, true);
}

function updateLoopOverlay() {
  const left = timeToX(project.loop.start, editor.view.zoom);
  const width = timeToX(project.loop.end - project.loop.start, editor.view.zoom);
  dom.loopRegion.style.transform = `translate3d(${left}px, 0, 0)`;
  dom.loopRegion.style.width = `${width}px`;
  dom.loopRegion.classList.toggle("active", project.loop.enabled);
  dom.loopEnabled.checked = project.loop.enabled;
  dom.loopStart.value = String(project.loop.start);
  dom.loopEnd.value = String(project.loop.end);
}

function updateHistoryButtons() {
  dom.undo.disabled = history.past.length === 0;
  dom.redo.disabled = history.future.length === 0;
}

function updateTransportButtons() {
  dom.play.setAttribute("aria-pressed", editor.transport.playing ? "true" : "false");
  dom.play.querySelector(".transport-label").textContent = editor.transport.playing ? "Playing" : "Play";
  dom.play.classList.toggle("active", editor.transport.playing);
  dom.pause.disabled = !editor.transport.playing;
}

function updateViewReadout() {
  dom.viewReadout.textContent = `${Math.round(editor.view.zoom)} px/s · ${project.length.toFixed(1)}s`;
}

function renderInspector() {
  const found = editor.selectedClipId ? findClip(project, editor.selectedClipId) : null;
  if (!found) {
    editor.selectedClipId = null;
    dom.inspectorEmpty.hidden = false;
    dom.inspectorForm.hidden = true;
    return;
  }
  dom.inspectorEmpty.hidden = true;
  dom.inspectorForm.hidden = false;
  dom.inspectorTitle.textContent = found.clip.label;
  dom.clipName.value = found.clip.label;
  dom.clipStart.value = String(found.clip.start);
  dom.clipDuration.value = String(found.clip.duration);
  dom.clipTrack.value = found.track.id;
  dom.clipEnd.textContent = `${(found.clip.start + found.clip.duration).toFixed(2)}s`;
  dom.clipId.textContent = found.clip.id;
  dom.inspectorForm.style.setProperty("--selection-color", found.clip.color || found.track.color);
}

function renderProject({ preserveScroll = true } = {}) {
  const scrollLeft = dom.timelineViewport.scrollLeft;
  const scrollTop = dom.timelineViewport.scrollTop;
  updateTimelineDimensions();
  renderRuler();
  renderTracksAndClips();
  updateLoopOverlay();
  updatePlayhead();
  renderInspector();
  updateHistoryButtons();
  updateTransportButtons();
  updateViewReadout();
  dom.snap.value = String(project.snap);
  dom.zoom.value = String(editor.view.zoom);
  if (preserveScroll) {
    dom.timelineViewport.scrollLeft = scrollLeft;
    dom.timelineViewport.scrollTop = scrollTop;
  }
  syncTrackSidebar();
}

function selectClip(clipId, { focus = false } = {}) {
  if (clipId && !findClip(project, clipId)) clipId = null;
  const previous = editor.selectedClipId;
  editor.selectedClipId = clipId;
  if (previous && editor.clipElements.has(previous)) {
    const element = editor.clipElements.get(previous);
    element.classList.remove("selected");
    element.setAttribute("aria-pressed", "false");
    element.tabIndex = -1;
  }
  if (clipId && editor.clipElements.has(clipId)) {
    const element = editor.clipElements.get(clipId);
    element.classList.add("selected");
    element.setAttribute("aria-pressed", "true");
    element.tabIndex = 0;
    if (focus) element.focus({ preventScroll: true });
  }
  renderInspector();
}

function commitProjectEdit(label, mutate) {
  const result = mutate();
  assertProjectInvariants(project);
  historyCommit(history, project);
  renderProject();
  setStatus(`${label} · undo available`, true);
  return result;
}

function cancelGesture(reason = "Edit cancelled") {
  const gesture = editor.gesture;
  if (!gesture) return;
  if (gesture.captureElement?.hasPointerCapture?.(gesture.pointerId)) {
    try { gesture.captureElement.releasePointerCapture(gesture.pointerId); } catch { /* no-op */ }
  }
  editor.gesture = null;
  if (gesture.type === "clip") renderProject();
  setStatus(reason, true);
}

function previewTrackForClientY(clientY) {
  const rect = dom.laneStack.getBoundingClientRect();
  const index = Math.floor((clientY - rect.top) / LANE_HEIGHT);
  return project.tracks[Math.max(0, Math.min(project.tracks.length - 1, index))] ?? null;
}

function beginClipGesture(event, clipElement) {
  const found = findClip(project, clipElement.dataset.clipId);
  if (!found) return;
  const handle = event.target.closest("[data-handle]")?.dataset.handle ?? null;
  selectClip(found.clip.id);
  const preview = {
    id: found.clip.id,
    start: found.clip.start,
    duration: found.clip.duration,
    trackId: found.track.id
  };
  editor.gesture = {
    type: "clip",
    mode: handle === "left" ? "resize-left" : handle === "right" ? "resize-right" : "move",
    pointerId: event.pointerId,
    captureElement: clipElement,
    originClientX: event.clientX,
    originStart: found.clip.start,
    originDuration: found.clip.duration,
    originTrackId: found.track.id,
    preview
  };
  clipElement.classList.add("editing");
  clipElement.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function updateClipGesture(event) {
  const gesture = editor.gesture;
  if (!gesture || gesture.type !== "clip" || gesture.pointerId !== event.pointerId) return;
  const deltaTime = (event.clientX - gesture.originClientX) / editor.view.zoom;
  const minimum = Math.min(MIN_CLIP_DURATION, project.length);
  let { start, duration, trackId } = gesture.preview;

  if (gesture.mode === "move") {
    start = Math.max(0, Math.min(project.length - gesture.originDuration, snapTime(gesture.originStart + deltaTime, project.snap)));
    duration = gesture.originDuration;
    trackId = previewTrackForClientY(event.clientY)?.id ?? gesture.originTrackId;
  } else if (gesture.mode === "resize-right") {
    const desiredEnd = snapTime(gesture.originStart + gesture.originDuration + deltaTime, project.snap);
    const end = Math.max(gesture.originStart + minimum, Math.min(project.length, desiredEnd));
    start = gesture.originStart;
    duration = end - start;
    trackId = gesture.originTrackId;
  } else {
    const end = gesture.originStart + gesture.originDuration;
    start = Math.max(0, Math.min(end - minimum, snapTime(gesture.originStart + deltaTime, project.snap)));
    duration = end - start;
    trackId = gesture.originTrackId;
  }

  gesture.preview = { id: gesture.preview.id, start, duration, trackId };
  const element = editor.clipElements.get(gesture.preview.id);
  if (!element) return;
  const targetLane = editor.laneElements.get(trackId);
  if (targetLane && element.parentElement !== targetLane) targetLane.append(element);
  element.dataset.trackId = trackId;
  element.style.setProperty("--clip-color", getTrackColor(trackId));
  applyClipGeometry(element, gesture.preview);
}

function commitClipGesture(event) {
  const gesture = editor.gesture;
  if (!gesture || gesture.type !== "clip" || gesture.pointerId !== event.pointerId) return;
  editor.gesture = null;
  const preview = gesture.preview;
  const changed = preview.start !== gesture.originStart
    || preview.duration !== gesture.originDuration
    || preview.trackId !== gesture.originTrackId;
  if (!changed) {
    renderProject();
    return;
  }
  const label = gesture.mode === "move"
    ? (preview.trackId === gesture.originTrackId ? "Moved clip" : "Moved clip across tracks")
    : gesture.mode === "resize-left" ? "Trimmed clip start" : "Trimmed clip end";

  commitProjectEdit(label, () => {
    if (gesture.mode === "move") {
      moveClip(project, preview.id, preview.start, preview.trackId);
    } else if (gesture.mode === "resize-left") {
      resizeClipLeft(project, preview.id, preview.start);
    } else {
      resizeClipRight(project, preview.id, preview.start + preview.duration);
    }
  });
}

function clientXToTimelineTime(clientX) {
  const rect = dom.timelineViewport.getBoundingClientRect();
  return Math.min(project.length, viewportXToTime(clientX - rect.left, dom.timelineViewport.scrollLeft, editor.view.zoom));
}

function beginScrub(event) {
  editor.gesture = { type: "scrub", pointerId: event.pointerId, captureElement: dom.timelineViewport };
  dom.timelineViewport.setPointerCapture?.(event.pointerId);
  scrubTo(event.clientX);
  event.preventDefault();
}

function scrubTo(clientX) {
  editor.transport.playhead = clientXToTimelineTime(clientX);
  editor.transport.lastClock = performance.now();
  updatePlayhead();
}

function finishScrub(event) {
  const gesture = editor.gesture;
  if (!gesture || gesture.type !== "scrub" || gesture.pointerId !== event.pointerId) return;
  editor.gesture = null;
  setStatus(`Playhead · ${editor.transport.playhead.toFixed(2)}s`, true);
}

function setPlaying(value) {
  editor.transport.playing = Boolean(value);
  editor.transport.lastClock = performance.now();
  updateTransportButtons();
}

function stopTransport() {
  setPlaying(false);
  editor.transport.playhead = 0;
  updatePlayhead();
  setStatus("Stopped · returned to 0:00", true);
}

function transportFrame(now) {
  if (editor.transport.playing) {
    const wallDelta = Math.max(0, (now - editor.transport.lastClock) / 1000);
    const boundedDelta = Math.min(0.25, wallDelta);
    editor.transport.lastClock = now;
    const advanced = advancePlayhead(project, editor.transport.playhead, boundedDelta);
    editor.transport.playhead = advanced.playhead;
    if (advanced.ended) editor.transport.playing = false;
    updatePlayhead();
    if (advanced.ended) updateTransportButtons();
  }
  requestAnimationFrame(transportFrame);
}

function applyZoom(nextZoom, anchorViewportX = dom.timelineViewport.clientWidth / 2) {
  const clamped = Math.max(36, Math.min(220, Number(nextZoom) || DEFAULT_ZOOM));
  if (clamped === editor.view.zoom) return;
  const oldZoom = editor.view.zoom;
  const oldScroll = dom.timelineViewport.scrollLeft;
  const nextScroll = zoomScrollForAnchor(anchorViewportX, oldScroll, oldZoom, clamped);
  editor.view.zoom = clamped;
  renderProject({ preserveScroll: false });
  dom.timelineViewport.scrollLeft = nextScroll;
  syncTrackSidebar();
}

function syncTrackSidebar() {
  dom.trackList.style.transform = `translateY(${-dom.timelineViewport.scrollTop}px)`;
}

function undo() {
  if (editor.gesture) cancelGesture();
  const previous = historyUndo(history);
  if (!previous) return;
  project = previous;
  if (editor.selectedClipId && !findClip(project, editor.selectedClipId)) editor.selectedClipId = null;
  renderProject();
  setStatus("Undo", true);
}

function redo() {
  if (editor.gesture) cancelGesture();
  const next = historyRedo(history);
  if (!next) return;
  project = next;
  if (editor.selectedClipId && !findClip(project, editor.selectedClipId)) editor.selectedClipId = null;
  renderProject();
  setStatus("Redo", true);
}

function duplicateSelection() {
  if (!editor.selectedClipId) return;
  let nextId = null;
  commitProjectEdit("Duplicated clip", () => {
    const copy = duplicateClip(project, editor.selectedClipId);
    nextId = copy?.id ?? null;
  });
  selectClip(nextId, { focus: true });
}

function deleteSelection() {
  if (!editor.selectedClipId) return;
  const clipId = editor.selectedClipId;
  editor.selectedClipId = null;
  commitProjectEdit("Deleted clip", () => deleteClip(project, clipId));
}

function updateLoopFromControls() {
  const start = Number(dom.loopStart.value);
  const end = Number(dom.loopEnd.value);
  try {
    commitProjectEdit("Updated loop", () => setLoop(project, start, end, dom.loopEnabled.checked));
  } catch (error) {
    updateLoopOverlay();
    setStatus(error.message, true);
  }
}

function updateSelectedFromInspector(kind) {
  const found = editor.selectedClipId ? findClip(project, editor.selectedClipId) : null;
  if (!found) return;
  try {
    if (kind === "name") {
      const next = dom.clipName.value.trim();
      if (next === found.clip.label || !next) { renderInspector(); return; }
      commitProjectEdit("Renamed clip", () => renameClip(project, found.clip.id, next));
    } else if (kind === "start") {
      const nextStart = Number(dom.clipStart.value);
      if (!Number.isFinite(nextStart)) return renderInspector();
      commitProjectEdit("Moved clip", () => moveClip(project, found.clip.id, nextStart, found.track.id));
    } else if (kind === "duration") {
      const nextDuration = Number(dom.clipDuration.value);
      if (!Number.isFinite(nextDuration)) return renderInspector();
      commitProjectEdit("Resized clip", () => resizeClip(project, found.clip.id, nextDuration));
    } else if (kind === "track") {
      const nextTrack = dom.clipTrack.value;
      if (nextTrack === found.track.id) return;
      commitProjectEdit("Moved clip across tracks", () => moveClip(project, found.clip.id, found.clip.start, nextTrack));
    }
  } catch (error) {
    renderInspector();
    setStatus(error.message, true);
  }
}

function exportProject() {
  const blob = new Blob([serializeProject(project)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "tapegrid-project.json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setStatus("Project JSON exported", true);
}

async function importProject(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const loaded = normalizeProjectSnapshot(text);
    project = loaded;
    history = createHistory(project);
    replaceHistoryPresent(history, project);
    editor.selectedClipId = null;
    editor.transport.playhead = 0;
    setPlaying(false);
    renderProject({ preserveScroll: false });
    dom.timelineViewport.scrollTo({ left: 0, top: 0 });
    setStatus(`Loaded ${file.name}`, true);
  } catch (error) {
    setStatus(`Import rejected · ${error.message}`, true);
  } finally {
    dom.importFile.value = "";
  }
}

function isTextInput(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
}

function nudgeSelection(direction) {
  const found = editor.selectedClipId ? findClip(project, editor.selectedClipId) : null;
  if (!found) return;
  commitProjectEdit("Nudged clip", () => moveClip(project, found.clip.id, found.clip.start + direction * project.snap, found.track.id));
  selectClip(editor.selectedClipId, { focus: true });
}

function moveSelectionTrack(direction) {
  const found = editor.selectedClipId ? findClip(project, editor.selectedClipId) : null;
  if (!found) return;
  const nextIndex = Math.max(0, Math.min(project.tracks.length - 1, found.trackIndex + direction));
  if (nextIndex === found.trackIndex) return;
  commitProjectEdit("Moved clip across tracks", () => moveClip(project, found.clip.id, found.clip.start, project.tracks[nextIndex].id));
  selectClip(editor.selectedClipId, { focus: true });
}

dom.timelineContent.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const clip = event.target.closest(".clip");
  if (clip) beginClipGesture(event, clip);
  else beginScrub(event);
});

dom.timelineViewport.addEventListener("pointermove", (event) => {
  if (!editor.gesture || editor.gesture.pointerId !== event.pointerId) return;
  if (editor.gesture.type === "clip") updateClipGesture(event);
  else scrubTo(event.clientX);
});

dom.timelineViewport.addEventListener("pointerup", (event) => {
  if (!editor.gesture || editor.gesture.pointerId !== event.pointerId) return;
  if (editor.gesture.type === "clip") commitClipGesture(event);
  else finishScrub(event);
});

dom.timelineViewport.addEventListener("pointercancel", (event) => {
  if (editor.gesture?.pointerId === event.pointerId) cancelGesture("Pointer edit cancelled");
});

dom.timelineViewport.addEventListener("lostpointercapture", (event) => {
  if (editor.gesture?.pointerId === event.pointerId) cancelGesture("Pointer capture lost · edit rolled back");
});

dom.timelineViewport.addEventListener("scroll", syncTrackSidebar, { passive: true });

dom.timelineViewport.addEventListener("wheel", (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const rect = dom.timelineViewport.getBoundingClientRect();
  const anchor = event.clientX - rect.left;
  applyZoom(editor.view.zoom * (event.deltaY > 0 ? 0.9 : 1.1), anchor);
}, { passive: false });

window.addEventListener("blur", () => {
  if (editor.gesture?.type === "clip") cancelGesture("Window lost focus · edit rolled back");
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && editor.gesture) {
    event.preventDefault();
    cancelGesture("Edit cancelled");
    return;
  }
  if (isTextInput(event.target)) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
  } else if ((modifier && event.key.toLowerCase() === "y")) {
    event.preventDefault();
    redo();
  } else if (modifier && event.key.toLowerCase() === "d") {
    event.preventDefault();
    duplicateSelection();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    if (!editor.selectedClipId) return;
    event.preventDefault();
    deleteSelection();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    if (!editor.selectedClipId) return;
    event.preventDefault();
    nudgeSelection(event.key === "ArrowLeft" ? -1 : 1);
  } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    if (!editor.selectedClipId) return;
    event.preventDefault();
    moveSelectionTrack(event.key === "ArrowUp" ? -1 : 1);
  } else if (event.code === "Space") {
    event.preventDefault();
    setPlaying(!editor.transport.playing);
  }
});

dom.play.addEventListener("click", () => {
  if (editor.transport.playhead >= project.length) editor.transport.playhead = 0;
  setPlaying(true);
  setStatus("Playing", true);
});
dom.pause.addEventListener("click", () => {
  setPlaying(false);
  setStatus(`Paused · ${editor.transport.playhead.toFixed(2)}s`, true);
});
dom.stop.addEventListener("click", stopTransport);
dom.undo.addEventListener("click", undo);
dom.redo.addEventListener("click", redo);

dom.snap.addEventListener("change", () => {
  const nextSnap = Math.max(0.001, Number(dom.snap.value) || 0.5);
  if (nextSnap === project.snap) return;
  commitProjectEdit("Changed snap grid", () => { project.snap = nextSnap; });
});

dom.zoom.addEventListener("input", () => applyZoom(Number(dom.zoom.value)));
dom.zoomIn.addEventListener("click", () => applyZoom(editor.view.zoom * 1.2));
dom.zoomOut.addEventListener("click", () => applyZoom(editor.view.zoom / 1.2));

dom.add.addEventListener("click", () => {
  const targetTrack = editor.selectedClipId ? findClip(project, editor.selectedClipId)?.track : project.tracks[0];
  let newId = null;
  commitProjectEdit("Added clip", () => {
    const clip = addClip(project, targetTrack?.id ?? project.tracks[0].id, editor.transport.playhead, 2, "New loop");
    newId = clip.id;
  });
  selectClip(newId, { focus: true });
});

dom.loopEnabled.addEventListener("change", updateLoopFromControls);
dom.loopStart.addEventListener("change", updateLoopFromControls);
dom.loopEnd.addEventListener("change", updateLoopFromControls);
dom.loopToPlayhead.addEventListener("click", () => {
  dom.loopStart.value = String(snapTime(editor.transport.playhead, project.snap));
  updateLoopFromControls();
});

dom.clipName.addEventListener("change", () => updateSelectedFromInspector("name"));
dom.clipStart.addEventListener("change", () => updateSelectedFromInspector("start"));
dom.clipDuration.addEventListener("change", () => updateSelectedFromInspector("duration"));
dom.clipTrack.addEventListener("change", () => updateSelectedFromInspector("track"));
dom.duplicate.addEventListener("click", duplicateSelection);
dom.delete.addEventListener("click", deleteSelection);

dom.export.addEventListener("click", exportProject);
dom.importTrigger.addEventListener("click", () => dom.importFile.click());
dom.importFile.addEventListener("change", () => importProject(dom.importFile.files?.[0]));

renderProject({ preserveScroll: false });
requestAnimationFrame(transportFrame);
