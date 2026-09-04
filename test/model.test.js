import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_CLIP_DURATION,
  addClip,
  assertProjectInvariants,
  cloneProject,
  createProject,
  deleteClip,
  duplicateClip,
  findClip,
  moveClip,
  normalizeProjectSnapshot,
  renameClip,
  resizeClip,
  resizeClipLeft,
  resizeClipRight,
  serializeProject,
  setLoop,
  snapTime,
  timeToViewportX,
  timeToX,
  viewportXToTime,
  xToTime,
  zoomScrollForAnchor
} from "../src/model.js";

test("project starts with four named tracks and valid loop", () => {
  const project = createProject();
  assert.deepEqual(project.tracks.map((track) => track.id), ["drums", "bass", "texture", "voice"]);
  assert.equal(project.loop.start < project.loop.end, true);
  assertProjectInvariants(project);
});

test("clip creation snaps and stays strictly inside project", () => {
  const project = createProject();
  const clip = addClip(project, "drums", 15.8, 4, "Tail");
  assert.equal(clip.start, 15.5);
  assert.equal(clip.duration, 0.5);
  assert.equal(clip.start + clip.duration, project.length);
});

test("moving a clip clamps by its duration", () => {
  const project = createProject();
  const clip = addClip(project, "drums", 2, 3, "Move");
  moveClip(project, clip.id, 99);
  assert.equal(clip.start, 13);
});

test("cross-track move preserves identity and geometry", () => {
  const project = createProject();
  const clip = addClip(project, "drums", 2, 3, "Move");
  moveClip(project, clip.id, 4, "bass");
  assert.equal(findClip(project, clip.id).track.id, "bass");
  assert.equal(findClip(project, clip.id).clip.start, 4);
  assert.equal(project.tracks[0].clips.length, 0);
});

test("legacy right resize snaps and does not cross project end", () => {
  const project = createProject();
  const clip = addClip(project, "bass", 14, 1, "Resize");
  resizeClip(project, clip.id, 8);
  assert.equal(clip.duration, 2);
});

test("left resize preserves end and minimum duration", () => {
  const project = createProject();
  const clip = addClip(project, "bass", 4, 3, "Trim");
  resizeClipLeft(project, clip.id, 6.9);
  assert.equal(clip.start, 6.5);
  assert.equal(clip.duration, 0.5);
  assert.equal(clip.start + clip.duration, 7);
});

test("right resize preserves start and bounds", () => {
  const project = createProject();
  const clip = addClip(project, "bass", 14, 1, "Trim");
  resizeClipRight(project, clip.id, 40);
  assert.equal(clip.start, 14);
  assert.equal(clip.duration, 2);
});

test("duplicate is independent and receives unique ID", () => {
  const project = createProject();
  const clip = addClip(project, "texture", 1, 2, "Source", { gain: 0.7 });
  const copy = duplicateClip(project, clip.id);
  assert.notEqual(copy.id, clip.id);
  copy.label = "Changed";
  copy.gain = 1.5;
  assert.equal(clip.label, "Source");
  assert.equal(clip.gain, 0.7);
});

test("delete and rename preserve lookup semantics", () => {
  const project = createProject();
  const clip = addClip(project, "voice", 1, 2, "Old");
  renameClip(project, clip.id, "New");
  assert.equal(findClip(project, clip.id).clip.label, "New");
  assert.equal(deleteClip(project, clip.id).id, clip.id);
  assert.equal(findClip(project, clip.id), null);
});

test("timeline coordinate conversion round-trips", () => {
  const px = timeToX(3.75, 96);
  assert.equal(xToTime(px, 96), 3.75);
});

test("viewport conversion includes horizontal scroll exactly once", () => {
  const viewport = timeToViewportX(6, 240, 80);
  assert.equal(viewport, 240);
  assert.equal(viewportXToTime(viewport, 240, 80), 6);
});

test("zoom anchor preserves time under viewport anchor", () => {
  const anchorX = 320;
  const oldScroll = 180;
  const oldZoom = 80;
  const newZoom = 150;
  const timeBefore = viewportXToTime(anchorX, oldScroll, oldZoom);
  const newScroll = zoomScrollForAnchor(anchorX, oldScroll, oldZoom, newZoom);
  const timeAfter = viewportXToTime(anchorX, newScroll, newZoom);
  assert.ok(Math.abs(timeBefore - timeAfter) < 1e-9);
});

test("snapshot clone is independent", () => {
  const project = createProject();
  addClip(project, "texture", 1, 2, "Clone");
  const copy = cloneProject(project);
  copy.tracks[2].clips[0].start = 8;
  assert.equal(project.tracks[2].clips[0].start, 1);
});

test("snap helper handles invalid and fractional values", () => {
  assert.equal(snapTime(1.26, 0.5), 1.5);
  assert.equal(snapTime(-2, 0.25), 0);
});

test("loop invariant rejects zero or negative ranges", () => {
  const project = createProject();
  assert.throws(() => setLoop(project, 4, 4), /after loop start/);
  assert.throws(() => setLoop(project, 8, 7), /after loop start/);
});

test("serialization is deep independent", () => {
  const project = createProject();
  const clip = addClip(project, "drums", 1, 2, "Persist");
  const json = serializeProject(project);
  clip.start = 7;
  const restored = normalizeProjectSnapshot(json);
  assert.equal(findClip(restored, clip.id).clip.start, 1);
});

test("load restoration preserves IDs, metadata, snap and loop", () => {
  const project = createProject();
  project.snap = 0.25;
  setLoop(project, 2, 8, true);
  const clip = addClip(project, "voice", 3.25, 1.5, "Persist", { gain: 0.6, muted: true });
  const loaded = normalizeProjectSnapshot(serializeProject(project));
  const found = findClip(loaded, clip.id);
  assert.equal(loaded.snap, 0.25);
  assert.deepEqual(loaded.loop, { enabled: true, start: 2, end: 8 });
  assert.equal(found.track.id, "voice");
  assert.equal(found.clip.label, "Persist");
  assert.equal(found.clip.gain, 0.6);
  assert.equal(found.clip.muted, true);
});

test("loaded project does not alias source object", () => {
  const source = createProject();
  addClip(source, "drums", 1, 2, "Alias");
  const loaded = normalizeProjectSnapshot(source);
  loaded.tracks[0].clips[0].start = 4;
  assert.equal(source.tracks[0].clips[0].start, 1);
});

test("allocator continues after loaded numeric clip IDs", () => {
  const source = createProject();
  const first = addClip(source, "drums", 1, 1, "One");
  source.tracks[0].clips[0].id = "clip-900";
  const loaded = normalizeProjectSnapshot(source);
  const next = addClip(loaded, "drums", 3, 1, "Next");
  assert.equal(first.id.startsWith("clip-"), true);
  assert.equal(next.id, "clip-901");
});

test("malformed snapshots reject atomically at parser boundary", () => {
  assert.throws(() => normalizeProjectSnapshot("{"), SyntaxError);
  assert.throws(() => normalizeProjectSnapshot({ length: -1, tracks: [] }), /Invalid project length/);
  const duplicateTracks = { length: 16, loop: { start: 0, end: 4 }, tracks: [{ id: "x", clips: [] }, { id: "x", clips: [] }] };
  assert.throws(() => normalizeProjectSnapshot(duplicateTracks), /Track IDs/);
  const outOfBounds = { length: 16, loop: { start: 0, end: 4 }, tracks: [{ id: "x", clips: [{ id: "clip-x", label: "x", start: 15, duration: 2 }] }] };
  assert.throws(() => normalizeProjectSnapshot(outOfBounds), /outside project bounds/);
  const duplicateClips = { length: 16, loop: { start: 0, end: 4 }, tracks: [
    { id: "a", clips: [{ id: "same", label: "a", start: 0, duration: 1 }] },
    { id: "b", clips: [{ id: "same", label: "b", start: 1, duration: 1 }] }
  ] };
  assert.throws(() => normalizeProjectSnapshot(duplicateClips), /Clip IDs/);
});

test("minimum duration is enforced even with very fine snap", () => {
  const project = createProject();
  project.snap = 0.01;
  const clip = addClip(project, "drums", 1, 0.01, "Tiny");
  assert.ok(clip.duration >= MIN_CLIP_DURATION);
});
