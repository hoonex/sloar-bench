import test from "node:test";
import assert from "node:assert/strict";
import {
  addClip,
  cloneProject,
  createProject,
  moveClip,
  resizeClip,
  snapTime,
  timeToX,
  xToTime
} from "../src/model.js";

test("project starts with four named tracks", () => {
  const project = createProject();
  assert.deepEqual(project.tracks.map((track) => track.id), ["drums", "bass", "texture", "voice"]);
});

test("clip creation snaps and stays inside project", () => {
  const project = createProject();
  const clip = addClip(project, "drums", 15.8, 4, "Tail");
  assert.equal(clip.start, 16);
  assert.equal(clip.duration, 0.5);
});

test("moving a clip clamps by its duration", () => {
  const project = createProject();
  const clip = addClip(project, "drums", 2, 3, "Move");
  moveClip(project, clip.id, 99);
  assert.equal(clip.start, 13);
});

test("resizing snaps and does not cross project end", () => {
  const project = createProject();
  const clip = addClip(project, "bass", 14, 1, "Resize");
  resizeClip(project, clip.id, 8);
  assert.equal(clip.duration, 2);
});

test("timeline coordinate conversion round-trips", () => {
  const px = timeToX(3.75, 96);
  assert.equal(xToTime(px, 96), 3.75);
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
