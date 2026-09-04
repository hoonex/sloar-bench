import test from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_LIMIT,
  History,
  addClip,
  advancePlayhead,
  cloneProject,
  createProject,
  deleteClip,
  duplicateClip,
  findClip,
  loadProjectSnapshot,
  moveClip,
  projectDuration,
  renameClip,
  resizeClip,
  resizeClipLeft,
  setLoop,
  snapTime,
  snapshotProject,
  timeToViewportX,
  timeToX,
  validateProjectSnapshot,
  viewportXToTime,
  xToTime,
  zoomScrollForAnchor
} from "../src/model.js";

function assertBounds(project) {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      assert.ok(clip.start >= 0, `${clip.id} start`);
      assert.ok(clip.duration > 0, `${clip.id} duration`);
      assert.ok(clip.start + clip.duration <= projectDuration(project) + 1e-9, `${clip.id} end`);
    }
  }
}

test("project starts with four named tracks", () => {
  const project = createProject();
  assert.deepEqual(project.tracks.map((track) => track.id), ["drums", "bass", "texture", "voice"]);
});

test("clip creation snaps and stays strictly inside project", () => {
  const project = createProject();
  const clip = addClip(project, "drums", 15.8, 4, "Tail");
  assert.equal(clip.start, 15.5);
  assert.equal(clip.duration, 0.5);
  assert.equal(clip.start + clip.duration, 16);
});

test("moving a clip clamps by its duration", () => {
  const project = createProject();
  const clip = addClip(project, "drums", 2, 3, "Move");
  moveClip(project, clip.id, 99);
  assert.equal(clip.start, 13);
});

test("cross-track move preserves identity and clip data", () => {
  const project = createProject();
  const clip = addClip(project, "drums", 2, 3, "Move");
  moveClip(project, clip.id, 4, "bass");
  assert.equal(findClip(project, clip.id).track.id, "bass");
  assert.equal(findClip(project, clip.id).clip.label, "Move");
  assert.equal(project.tracks[0].clips.length, 0);
});

test("right resize snaps and does not cross project end", () => {
  const project = createProject();
  const clip = addClip(project, "bass", 14, 1, "Resize");
  resizeClip(project, clip.id, 8);
  assert.equal(clip.duration, 2);
});

test("left resize keeps old end and bounds", () => {
  const project = createProject();
  const clip = addClip(project, "bass", 4, 3, "Resize left");
  resizeClipLeft(project, clip.id, 2.6);
  assert.equal(clip.start, 2.5);
  assert.equal(clip.duration, 4.5);
  assert.equal(clip.start + clip.duration, 7);
  resizeClipLeft(project, clip.id, 99);
  assert.ok(clip.duration > 0);
  assert.equal(clip.start + clip.duration, 7);
});

test("timeline coordinate conversion round-trips", () => {
  for (const zoom of [36, 88, 173, 240]) {
    const px = timeToX(3.75, zoom);
    assert.equal(xToTime(px, zoom), 3.75);
  }
});

test("viewport conversion accounts for scroll and round-trips", () => {
  const clientX = 610;
  const left = 120;
  const scroll = 340;
  const zoom = 96;
  const time = viewportXToTime(clientX, left, scroll, zoom);
  assert.equal(timeToViewportX(time, left, scroll, zoom), clientX);
});

test("zoom anchor preserves time under pointer", () => {
  const anchorClientX = 640;
  const viewportLeft = 172;
  const scrollLeft = 410;
  const before = viewportXToTime(anchorClientX, viewportLeft, scrollLeft, 80);
  const nextScroll = zoomScrollForAnchor({ anchorClientX, viewportLeft, scrollLeft, oldZoom: 80, newZoom: 160, maxScroll: 5000 });
  const after = viewportXToTime(anchorClientX, viewportLeft, nextScroll, 160);
  assert.ok(Math.abs(before - after) < 1e-9);
});

test("snapshot clone is deep independent both directions", () => {
  const project = createProject();
  addClip(project, "texture", 1, 2, "Clone");
  const copy = snapshotProject(project);
  copy.tracks[2].clips[0].start = 8;
  assert.equal(project.tracks[2].clips[0].start, 1);
  project.tracks[2].clips[0].label = "Live edit";
  assert.equal(copy.tracks[2].clips[0].label, "Clone");
});

test("snap helper handles invalid and fractional values", () => {
  assert.equal(snapTime(1.26, 0.5), 1.5);
  assert.equal(snapTime(-2, 0.25), 0);
});

test("duplicate produces independent object and unique id", () => {
  const project = createProject();
  const clip = addClip(project, "texture", 1, 2, "Original", { notes: "a" });
  const copy = duplicateClip(project, clip.id);
  assert.notEqual(copy.id, clip.id);
  copy.notes = "b";
  assert.equal(clip.notes, "a");
  assert.notEqual(copy.start, clip.start);
});

test("delete returns removed clip and stale lookup disappears", () => {
  const project = createProject();
  const clip = addClip(project, "voice", 1, 2, "Delete");
  assert.equal(deleteClip(project, clip.id).id, clip.id);
  assert.equal(findClip(project, clip.id), null);
});

test("rename changes metadata without geometry", () => {
  const project = createProject();
  const clip = addClip(project, "voice", 1, 2, "Before");
  renameClip(project, clip.id, "After");
  assert.equal(clip.label, "After");
  assert.equal(clip.start, 1);
  assert.equal(clip.duration, 2);
});

test("loop enforces start before end", () => {
  const project = createProject();
  setLoop(project, 3.1, 7.2, true);
  assert.deepEqual(project.loop, { enabled: true, start: 3, end: 7 });
  assert.throws(() => setLoop(project, 7, 7, true));
});

test("transport distinguishes ordinary end and modulo loop wrap", () => {
  assert.deepEqual(advancePlayhead(15.9, 0.2, 16, { enabled: false }), { position: 16, ended: true });
  const wrapped = advancePlayhead(5.8, 5.1, 16, { enabled: true, start: 4, end: 6 });
  assert.ok(Math.abs(wrapped.position - 4.9) < 1e-9);
  assert.equal(wrapped.ended, false);
});

test("history treats gesture-style before/after as one logical edit", () => {
  let project = createProject();
  const clip = addClip(project, "drums", 1, 2, "Gesture");
  const history = new History(10);
  const before = cloneProject(project);
  for (let i = 0; i < 47; i += 1) moveClip(project, clip.id, 1 + i * 0.1);
  history.push("Move clip", before, project);
  assert.equal(history.undoStack.length, 1);
  const undone = history.undo();
  project = undone.project;
  assert.equal(findClip(project, clip.id).clip.start, 1);
  const redone = history.redo();
  assert.equal(findClip(redone.project, clip.id).clip.start, 5.5);
});

test("undo then new edit invalidates redo", () => {
  const project = createProject();
  const history = new History(10);
  let before = cloneProject(project);
  const a = addClip(project, "drums", 0, 1, "A");
  history.push("Add", before, project);
  history.undo();
  assert.equal(history.redoStack.length, 1);
  before = cloneProject(project);
  addClip(project, "bass", 2, 1, "B");
  history.push("New branch", before, project);
  assert.equal(history.redoStack.length, 0);
  assert.ok(a.id);
});

test("history is bounded", () => {
  const project = createProject();
  const history = new History(5);
  for (let i = 0; i < 20; i += 1) {
    const before = cloneProject(project);
    project.name = `v${i}`;
    history.push("Rename project", before, project);
  }
  assert.equal(history.undoStack.length, 5);
  assert.ok(HISTORY_LIMIT >= 50 && HISTORY_LIMIT <= 100);
});

test("load restores project and allocator continues after highest numeric id", () => {
  const project = createProject();
  project.tracks[0].clips.push({ id: "clip-1", label: "A", start: 0, duration: 1, kind: "drums", gain: 1, notes: "" });
  project.tracks[1].clips.push({ id: "clip-42", label: "B", start: 2, duration: 1, kind: "bass", gain: 1, notes: "" });
  validateProjectSnapshot(project);
  const loaded = loadProjectSnapshot(JSON.stringify(project));
  const next = addClip(loaded, "voice", 4, 1, "Next");
  assert.equal(next.id, "clip-43");
  assertBounds(loaded);
});

test("malformed snapshots reject without mutating live source", () => {
  const source = createProject();
  const before = JSON.stringify(source);
  assert.throws(() => loadProjectSnapshot("not json"));
  assert.throws(() => loadProjectSnapshot({ duration: -1, tracks: [] }));
  const badBounds = snapshotProject(source);
  badBounds.tracks[0].clips.push({ id: "x", label: "bad", start: 15.5, duration: 2 });
  assert.throws(() => loadProjectSnapshot(badBounds));
  const duplicate = snapshotProject(source);
  duplicate.tracks[0].clips.push({ id: "same", label: "a", start: 0, duration: 1 });
  duplicate.tracks[1].clips.push({ id: "same", label: "b", start: 2, duration: 1 });
  assert.throws(() => loadProjectSnapshot(duplicate));
  assert.equal(JSON.stringify(source), before);
});

test("600 clips retain unique IDs and strict bounds", () => {
  const project = createProject({ duration: 256, snap: 0.125 });
  for (let i = 0; i < 600; i += 1) {
    const track = project.tracks[i % project.tracks.length];
    addClip(project, track.id, (i * 0.375) % 255, 0.5 + (i % 8) * 0.125, `Clip ${i}`);
  }
  const ids = project.tracks.flatMap((track) => track.clips.map((clip) => clip.id));
  assert.equal(new Set(ids).size, 600);
  assertBounds(project);
});
