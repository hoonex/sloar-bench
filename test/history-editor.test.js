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
  const editor = new HistoryEditor("initial");
  editor.setText("one");
  editor.setText("two");

  assert.equal(editor.undo(), "one");
  assert.equal(editor.undo(), "initial");
  assert.equal(editor.redo(), "one");
  assert.equal(editor.redo(), "two");
});

test("undo and redo keep the current text when there is no history", () => {
  const editor = new HistoryEditor("initial");

  assert.equal(editor.undo(), "initial");
  assert.equal(editor.redo(), "initial");
});

test("setting the same text consecutively does not create history", () => {
  const editor = new HistoryEditor("a");
  editor.setText("b");
  editor.setText("b");

  assert.equal(editor.undo(), "a");
  assert.equal(editor.undo(), "a");
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

test("keeps at most 20 changes in history", () => {
  const editor = new HistoryEditor("0");
  for (let i = 1; i <= 21; i += 1) {
    editor.setText(String(i));
  }

  for (let i = 20; i >= 1; i -= 1) {
    assert.equal(editor.undo(), String(i));
  }
  assert.equal(editor.undo(), "1");
});
