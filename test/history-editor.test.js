import test from "node:test";
import assert from "node:assert/strict";
import { HistoryEditor } from "../src/history-editor.js";

test("editor starts with the provided text", () => {
  const editor = new HistoryEditor("hello");
  assert.equal(editor.getText(), "hello");
});

test("setText updates the current text", () => {
  const editor = new HistoryEditor("a");
  assert.equal(editor.setText("b"), "b");
  assert.equal(editor.getText(), "b");
});

test("undo and redo return and apply the current text", () => {
  const editor = new HistoryEditor("a");
  editor.setText("b");
  editor.setText("c");

  assert.equal(editor.undo(), "b");
  assert.equal(editor.getText(), "b");
  assert.equal(editor.undo(), "a");
  assert.equal(editor.undo(), "a");

  assert.equal(editor.redo(), "b");
  assert.equal(editor.redo(), "c");
  assert.equal(editor.redo(), "c");
});

test("setting the same text consecutively does not create history", () => {
  const editor = new HistoryEditor("a");
  editor.setText("b");
  editor.setText("b");

  assert.equal(editor.undo(), "a");
  assert.equal(editor.redo(), "b");
});

test("setting new text after undo clears redo history", () => {
  const editor = new HistoryEditor("a");
  editor.setText("b");
  editor.setText("c");
  editor.undo();

  assert.equal(editor.setText("d"), "d");
  assert.equal(editor.redo(), "d");
  assert.equal(editor.undo(), "b");
});

test("keeps at most 20 changes while preserving the initial text", () => {
  const editor = new HistoryEditor("initial");

  for (let i = 1; i <= 25; i += 1) {
    editor.setText(`change-${i}`);
  }

  for (let i = 0; i < 20; i += 1) {
    editor.undo();
  }

  assert.equal(editor.getText(), "initial");
  assert.equal(editor.undo(), "initial");
});
