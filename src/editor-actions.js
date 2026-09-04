
function commitMutation(label, mutation, { selection = selectedClipId, render = true } = {}) {
  const before = snapshotProject(project);
  mutation();
  const changed = history.push(label, before, project);
  selectedClipId = selection && findClip(project, selection) ? selection : selectedClipId;
  if (selectedClipId && !findClip(project, selectedClipId)) selectedClipId = null;
  if (render) renderAll();
  else { renderInspector(); renderChrome(); }
  if (changed) setInteractionStatus(label);
  return changed;
}

function pauseTransport() {
  if (!project.playing) return;
  project.playing = false;
  transportLast = null;
  renderChrome();
}

function togglePlayback() {
  if (project.playing) {
    pauseTransport();
    setInteractionStatus("Paused");
    return;
  }
  if (!project.loop.enabled && project.playhead >= projectDuration(project)) project.playhead = 0;
  project.playing = true;
  transportLast = performance.now();
  renderChrome();
  setInteractionStatus("Playing");
}

function stopPlayback() {
  project.playing = false;
  project.playhead = 0;
  transportLast = null;
  updatePlayheadOnly();
  renderChrome();
  setInteractionStatus("Stopped · playhead reset");
}

function transportFrame(now) {
  if (project.playing) {
    if (transportLast == null) transportLast = now;
    const elapsed = Math.max(0, (now - transportLast) / 1000);
    transportLast = now;
    // A stalled tab cannot create a giant visual/transport jump. Large-delta loop semantics
    // remain defined and tested by advancePlayhead itself; the UI clock deliberately caps stalls.
    const delta = Math.min(elapsed, 0.25);
    const result = advancePlayhead(project.playhead, delta, projectDuration(project), project.loop);
    project.playhead = result.position;
    if (result.ended) {
      project.playing = false;
      transportLast = null;
      setInteractionStatus("Reached project end");
      renderChrome();
    }
    updatePlayheadOnly();
  }
  requestAnimationFrame(transportFrame);
}

function timelineTimeFromClientX(clientX) {
  const rect = dom.scroll.getBoundingClientRect();
  const viewportLeft = rect.left + dom.timeline.offsetLeft;
  return viewportXToTime(clientX, viewportLeft, dom.scroll.scrollLeft, project.zoom);
}

function scrubTo(clientX) {
  const next = Math.min(projectDuration(project), Math.max(0, timelineTimeFromClientX(clientX)));
  project.playhead = next;
  transportLast = project.playing ? performance.now() : null;
  updatePlayheadOnly();
}

function trackIdFromClientY(clientY) {
  const rect = dom.timeline.getBoundingClientRect();
  const index = Math.max(0, Math.min(project.tracks.length - 1, Math.floor((clientY - rect.top) / laneHeight())));
  return project.tracks[index]?.id || project.tracks[0]?.id;
}

function beginClipInteraction(event, clipElement) {
  const found = findClip(project, clipElement.dataset.clipId);
  if (!found || event.button > 0) return;
  pauseTransport();
  selectClip(found.clip.id);
  const edge = event.target.closest(".resize-handle")?.dataset.edge;
  interaction = {
    kind: edge === "left" ? "resize-left" : edge === "right" ? "resize-right" : "move",
    pointerId: event.pointerId,
    clipId: found.clip.id,
    originX: event.clientX,
    originY: event.clientY,
    originScrollLeft: dom.scroll.scrollLeft,
    originStart: found.clip.start,
    originDuration: found.clip.duration,
    originTrackId: found.track.id,
    before: snapshotProject(project),
    captureTarget: clipElement
  };
  clipElement.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  setInteractionStatus(interaction.kind === "move" ? "Moving clip…" : "Resizing clip…");
}

function updateClipInteraction(event) {
  if (!interaction || interaction.kind === "scrub" || event.pointerId !== interaction.pointerId) return;
  const deltaPx = (event.clientX - interaction.originX) + (dom.scroll.scrollLeft - interaction.originScrollLeft);
  const deltaTime = xToTime(Math.abs(deltaPx), project.zoom) * Math.sign(deltaPx || 1);
  if (interaction.kind === "move") {
    moveClip(project, interaction.clipId, interaction.originStart + deltaTime, trackIdFromClientY(event.clientY));
  } else if (interaction.kind === "resize-right") {
    resizeClip(project, interaction.clipId, interaction.originDuration + deltaTime);
  } else if (interaction.kind === "resize-left") {
    resizeClipLeft(project, interaction.clipId, interaction.originStart + deltaTime);
  }
  updateClipOnly(interaction.clipId);
  renderInspector();
}

function finishInteraction(event) {
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  if (interaction.kind === "scrub") {
    interaction = null;
    setInteractionStatus("Playhead moved");
    return;
  }
  const active = interaction;
  interaction = null;
  const label = active.kind === "move" ? "Move clip" : active.kind === "resize-left" ? "Resize clip left" : "Resize clip right";
  history.push(label, active.before, project);
  updateClipOnly(active.clipId);
  renderInspector();
  renderChrome();
  setInteractionStatus(label);
}

function cancelInteraction(reason = "Edit cancelled") {
  if (!interaction) return false;
  if (interaction.kind === "scrub") {
    interaction = null;
    setInteractionStatus(reason);
    return true;
  }
  const before = interaction.before;
  const clipId = interaction.clipId;
  interaction = null;
  project = loadProjectSnapshot(before);
  selectedClipId = findClip(project, clipId) ? clipId : null;
  renderAll();
  setInteractionStatus(reason);
  return true;
}

function addNewClip() {
  pauseTransport();
  const preferredTrack = validSelection()?.track.id || project.tracks[0].id;
  let createdId = null;
  commitMutation("Add clip", () => {
    const clip = addClip(project, preferredTrack, project.playhead, 2, "New idea");
    createdId = clip.id;
  }, { selection: null });
  selectClip(createdId, { focus: true });
  showToast("Clip added");
}

function duplicateSelected() {
  const found = validSelection();
  if (!found) return;
  let copyId = null;
  commitMutation("Duplicate clip", () => { copyId = duplicateClip(project, found.clip.id)?.id || null; });
  selectClip(copyId, { focus: true });
  showToast("Clip duplicated");
}

function deleteSelected() {
  const found = validSelection();
  if (!found) return;
  const id = found.clip.id;
  commitMutation("Delete clip", () => deleteClip(project, id), { selection: null });
  selectedClipId = null;
  renderAll();
  showToast("Clip deleted");
}

function undo() {
  if (interaction) cancelInteraction();
  const result = history.undo();
  if (!result) return;
  replaceProject(result.project);
  showToast(`Undo: ${result.label}`);
  setInteractionStatus(`Undo · ${result.label}`);
}
function redo() {
  if (interaction) cancelInteraction();
  const result = history.redo();
  if (!result) return;
  replaceProject(result.project);
  showToast(`Redo: ${result.label}`);
  setInteractionStatus(`Redo · ${result.label}`);
}

function applyZoom(nextZoom, anchorClientX = null) {
  const oldZoom = project.zoom;
  const targetZoom = Math.max(36, Math.min(240, Number(nextZoom) || oldZoom));
  if (targetZoom === oldZoom) return;
  const rect = dom.scroll.getBoundingClientRect();
  const anchor = anchorClientX ?? (rect.left + Math.max(dom.timeline.offsetLeft, rect.width * 0.5));
  const viewportLeft = rect.left + dom.timeline.offsetLeft;
  const oldScroll = dom.scroll.scrollLeft;
  project.zoom = targetZoom;
  renderRuler();
  renderTimeline();
  const maxScroll = Math.max(0, dom.scroll.scrollWidth - dom.scroll.clientWidth);
  dom.scroll.scrollLeft = zoomScrollForAnchor({ anchorClientX: anchor, viewportLeft, scrollLeft: oldScroll, oldZoom, newZoom: targetZoom, maxScroll });
  dom.zoom.value = String(targetZoom);
  dom.zoomReadout.textContent = `${Math.round(targetZoom)} px/s`;
  renderInspector();
  setInteractionStatus(`Zoom ${Math.round(targetZoom)} px/s`);
}

function setLoopEnabled(enabled) {
  commitMutation(enabled ? "Enable loop" : "Disable loop", () => { project.loop.enabled = Boolean(enabled); }, { render: false });
  updateLoopGeometry();
  renderInspector();
  renderChrome();
}

function updateLoopFromInputs() {
  const start = Number(dom.loopStart.value);
  const end = Number(dom.loopEnd.value);
  try {
    commitMutation("Edit loop region", () => setLoop(project, start, end, project.loop.enabled));
  } catch (error) {
    renderInspector();
    showToast(error.message);
  }
}

function updateInspectorTiming(kind) {
  const found = validSelection();
  if (!found) return;
  const id = found.clip.id;
  const value = kind === "start" ? Number(dom.clipStart.value) : Number(dom.clipDuration.value);
  commitMutation(kind === "start" ? "Set clip start" : "Set clip duration", () => {
    if (kind === "start") moveClip(project, id, value, findClip(project, id)?.track.id);
    else resizeClip(project, id, value);
  });
}

function refreshProjectJson() {
  dom.projectJsonText.value = JSON.stringify(snapshotProject(project), null, 2);
  dom.projectError.textContent = "";
}

