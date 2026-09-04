import test from "node:test";
import assert from "node:assert/strict";
import {
  addClip,
  assertProjectInvariants,
  createHistory,
  createProject,
  historyCommit,
  moveClip
} from "../src/model.js";

test("800 clips maintain unique IDs and strict bounds", () => {
  const project = createProject({ length: 128 });
  project.snap = 0.125;
  const ids = new Set();
  for (let i = 0; i < 800; i += 1) {
    const track = project.tracks[i % project.tracks.length];
    const start = (i * 0.375) % 126;
    const clip = addClip(project, track.id, start, 0.5 + (i % 5) * 0.125, `Clip ${i}`);
    assert.equal(ids.has(clip.id), false);
    ids.add(clip.id);
  }
  assert.equal(ids.size, 800);
  assertProjectInvariants(project);
});

test("history bound holds under hundreds of edits", () => {
  const project = createProject({ length: 64 });
  const clip = addClip(project, "drums", 0, 2, "Hot path");
  const history = createHistory(project, 50);
  for (let i = 0; i < 500; i += 1) {
    moveClip(project, clip.id, (i % 100) * project.snap);
    historyCommit(history, project);
  }
  assert.equal(history.past.length, 50);
});
