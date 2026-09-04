import test from "node:test";
import assert from "node:assert/strict";
import {
  addClip,
  advancePlayhead,
  createHistory,
  createProject,
  findClip,
  historyCommit,
  historyRedo,
  historyUndo,
  moveClip,
  resizeClipLeft,
  setLoop
} from "../src/model.js";

test("one logical move can be represented by one history commit", () => {
  const project = createProject();
  const clip = addClip(project, "drums", 1, 2, "Gesture");
  const history = createHistory(project);
  // Many pointer previews intentionally do not touch project/history.
  const previews = [1.5, 2, 2.5, 3, 3.5];
  assert.equal(previews.length, 5);
  moveClip(project, clip.id, previews.at(-1));
  historyCommit(history, project);
  assert.equal(history.past.length, 1);
  assert.equal(historyUndo(history).tracks[0].clips[0].start, 1);
  assert.equal(historyRedo(history).tracks[0].clips[0].start, 3.5);
});

test("undo restores cross-track membership and redo reapplies it", () => {
  let project = createProject();
  const clip = addClip(project, "drums", 1, 2, "Cross");
  const history = createHistory(project);
  moveClip(project, clip.id, 4, "bass");
  historyCommit(history, project);
  project = historyUndo(history);
  assert.equal(findClip(project, clip.id).track.id, "drums");
  project = historyRedo(history);
  assert.equal(findClip(project, clip.id).track.id, "bass");
});

test("undo restores left resize exactly", () => {
  let project = createProject();
  const clip = addClip(project, "texture", 2, 4, "Resize");
  const history = createHistory(project);
  resizeClipLeft(project, clip.id, 4);
  historyCommit(history, project);
  project = historyUndo(history);
  assert.deepEqual({ start: findClip(project, clip.id).clip.start, duration: findClip(project, clip.id).clip.duration }, { start: 2, duration: 4 });
});

test("undo then new edit clears redo branch", () => {
  let project = createProject();
  const clip = addClip(project, "bass", 1, 2, "Branch");
  const history = createHistory(project);
  moveClip(project, clip.id, 2);
  historyCommit(history, project);
  project = historyUndo(history);
  moveClip(project, clip.id, 5);
  historyCommit(history, project);
  assert.equal(history.future.length, 0);
  assert.equal(historyRedo(history), null);
});

test("history remains bounded", () => {
  const project = createProject();
  const clip = addClip(project, "voice", 0, 1, "Bounded");
  const history = createHistory(project, 12);
  for (let i = 0; i < 40; i += 1) {
    moveClip(project, clip.id, (i % 10) * 0.5);
    historyCommit(history, project);
  }
  assert.equal(history.past.length, 12);
});

test("transport advances from current playhead", () => {
  const project = createProject();
  const result = advancePlayhead(project, 3.5, 0.25);
  assert.equal(result.playhead, 3.75);
  assert.equal(result.ended, false);
});

test("transport ends at project boundary without loop", () => {
  const project = createProject();
  const result = advancePlayhead(project, 15.9, 1);
  assert.equal(result.playhead, 16);
  assert.equal(result.ended, true);
});

test("loop wraps using modulo across multiple boundaries", () => {
  const project = createProject();
  setLoop(project, 4, 6, true);
  const result = advancePlayhead(project, 5.8, 5.1);
  assert.ok(Math.abs(result.playhead - 4.9) < 1e-9);
  assert.equal(result.ended, false);
});

test("loop entry from before loop preserves pre-loop elapsed time", () => {
  const project = createProject();
  setLoop(project, 4, 6, true);
  const result = advancePlayhead(project, 3, 4);
  assert.ok(Math.abs(result.playhead - 5) < 1e-9);
});

test("pause/resume giant-delta prevention belongs to clock boundary, not modulo function", () => {
  const project = createProject();
  setLoop(project, 4, 6, true);
  const boundedWallDelta = Math.min(0.25, 120);
  const result = advancePlayhead(project, 5.5, boundedWallDelta);
  assert.equal(result.playhead, 5.75);
});
