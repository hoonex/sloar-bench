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
