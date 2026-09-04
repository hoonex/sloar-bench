// Controls
dom.play.addEventListener("click", togglePlayback);
dom.stop.addEventListener("click", stopPlayback);
dom.add.addEventListener("click", addNewClip);
dom.duplicate.addEventListener("click", duplicateSelected);
dom.delete.addEventListener("click", deleteSelected);
dom.inspectorDuplicate.addEventListener("click", duplicateSelected);
dom.inspectorDelete.addEventListener("click", deleteSelected);
dom.undo.addEventListener("click", undo);
dom.redo.addEventListener("click", redo);
dom.snap.addEventListener("change", () => {
  const next = Number(dom.snap.value);
  commitMutation("Change snap grid", () => { project.snap = next; }, { render: false });
  renderRuler();
  renderTimeline();
  renderInspector();
  renderChrome();
});
dom.zoom.addEventListener("input", (event) => applyZoom(Number(event.target.value)));
dom.zoomIn.addEventListener("click", () => applyZoom(project.zoom + 16));
dom.zoomOut.addEventListener("click", () => applyZoom(project.zoom - 16));
dom.loopToggle.addEventListener("click", () => setLoopEnabled(!project.loop.enabled));
dom.loopToggleInspector.addEventListener("click", () => setLoopEnabled(!project.loop.enabled));
dom.loopStart.addEventListener("change", updateLoopFromInputs);
dom.loopEnd.addEventListener("change", updateLoopFromInputs);

dom.clipName.addEventListener("change", () => {
  const found = validSelection(); if (!found) return;
  commitMutation("Rename clip", () => renameClip(project, found.clip.id, dom.clipName.value));
});
dom.clipNotes.addEventListener("change", () => {
  const found = validSelection(); if (!found) return;
  commitMutation("Edit clip notes", () => { findClip(project, found.clip.id).clip.notes = dom.clipNotes.value; });
});
dom.clipStart.addEventListener("change", () => updateInspectorTiming("start"));
dom.clipDuration.addEventListener("change", () => updateInspectorTiming("duration"));
dom.clipTrack.addEventListener("change", () => {
  const found = validSelection(); if (!found) return;
  commitMutation("Move clip to track", () => moveClip(project, found.clip.id, found.clip.start, dom.clipTrack.value));
});

dom.trackList.addEventListener("click", (event) => {
  const button = event.target.closest(".track-mute");
  if (!button) return;
  const trackId = button.closest(".track-head")?.dataset.trackId;
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return;
  commitMutation(track.muted ? "Unmute track" : "Mute track", () => { track.muted = !track.muted; });
});

// Timeline pointer lifecycle: one drag/resize gesture becomes one history entry.
dom.timeline.addEventListener("pointerdown", (event) => {
  const clip = event.target.closest(".clip");
  if (clip) { beginClipInteraction(event, clip); return; }
  if (event.button > 0) return;
  scrubTo(event.clientX);
  interaction = { kind: "scrub", pointerId: event.pointerId };
  dom.timeline.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  setInteractionStatus("Scrubbing…");
});
dom.timeline.addEventListener("pointermove", (event) => {
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  if (interaction.kind === "scrub") scrubTo(event.clientX);
  else updateClipInteraction(event);
});
dom.timeline.addEventListener("pointerup", finishInteraction);
dom.timeline.addEventListener("pointercancel", (event) => {
  if (interaction?.pointerId === event.pointerId) cancelInteraction("Pointer cancelled · edit restored");
});
dom.timeline.addEventListener("lostpointercapture", (event) => {
  if (interaction?.pointerId === event.pointerId) cancelInteraction("Pointer capture lost · edit restored");
});
dom.timeline.addEventListener("focusin", (event) => {
  const clip = event.target.closest(".clip");
  if (clip) selectClip(clip.dataset.clipId);
});
dom.ruler.addEventListener("pointerdown", (event) => {
  if (event.button > 0) return;
  scrubTo(event.clientX);
  setInteractionStatus("Playhead moved");
});

dom.scroll.addEventListener("wheel", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  applyZoom(project.zoom + (event.deltaY < 0 ? 12 : -12), event.clientX);
}, { passive: false });

window.addEventListener("blur", () => { if (interaction) cancelInteraction("Window blurred · edit restored"); });
window.addEventListener("resize", () => {
  if (interaction) cancelInteraction("Viewport changed · edit restored");
  renderAll();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && interaction) {
    event.preventDefault();
    cancelInteraction("Escape · edit restored");
    return;
  }
  if (isEditableTarget(event.target)) return;
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if (command && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
  if (command && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelected(); return; }
  if (event.key === " ") { event.preventDefault(); togglePlayback(); return; }
  if (event.key === "Home") { event.preventDefault(); stopPlayback(); return; }
  if ((event.key === "Delete" || event.key === "Backspace") && selectedClipId) { event.preventDefault(); deleteSelected(); return; }
  const found = validSelection();
  if (!found) return;
  const id = found.clip.id;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const delta = project.snap * (event.shiftKey ? 4 : 1) * (event.key === "ArrowLeft" ? -1 : 1);
    commitMutation("Nudge clip", () => moveClip(project, id, findClip(project, id).clip.start + delta));
    selectClip(id, { focus: true });
    return;
  }
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    const current = findClip(project, id);
    const nextIndex = Math.max(0, Math.min(project.tracks.length - 1, current.trackIndex + (event.key === "ArrowUp" ? -1 : 1)));
    commitMutation("Move clip to track", () => moveClip(project, id, findClip(project, id).clip.start, project.tracks[nextIndex].id));
    selectClip(id, { focus: true });
  }
});

// Persistence dialog
dom.projectJsonButton.addEventListener("click", () => { refreshProjectJson(); dom.dialog.showModal(); });
dom.refreshJson.addEventListener("click", refreshProjectJson);
dom.downloadJson.addEventListener("click", () => {
  refreshProjectJson();
  const blob = new Blob([dom.projectJsonText.value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tapegrid"}.json`;
  document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  showToast("Project JSON downloaded");
});
dom.importFile.addEventListener("change", async () => {
  const file = dom.importFile.files?.[0];
  if (!file) return;
  dom.projectJsonText.value = await file.text();
  dom.projectError.textContent = "";
});
dom.loadJson.addEventListener("click", () => {
  try {
    const loaded = loadProjectSnapshot(dom.projectJsonText.value);
    replaceProject(loaded, { clearHistory: true });
    selectedClipId = null;
    renderAll({ preserveScroll: false });
    dom.dialog.close();
    showToast("Project loaded");
    setInteractionStatus("Snapshot loaded");
  } catch (error) {
    dom.projectError.textContent = error instanceof Error ? error.message : "Invalid project snapshot";
  }
});

// Small public diagnostics surface for browser verification without coupling tests to internal DOM details.
window.Tapegrid = Object.freeze({
  getProject: () => cloneProject(project),
  getSelectedClipId: () => selectedClipId,
  getHistoryDepth: () => ({ undo: history.undoStack.length, redo: history.redoStack.length, limit: history.limit }),
  timeAtClientX: (clientX) => timelineTimeFromClientX(clientX),
  selectClip: (id) => selectClip(id),
  cancelInteraction: () => cancelInteraction("Diagnostic cancel"),
  renderAll: () => renderAll()
});

renderAll({ preserveScroll: false });
requestAnimationFrame(transportFrame);
