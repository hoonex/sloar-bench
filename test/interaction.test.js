import test from "node:test";
import assert from "node:assert/strict";
import {
  backingStoreSize,
  beginPointerSession,
  cancelPointerSession,
  clientToBiomePoint,
  createPointerSession,
  endPointerSession,
  movePointerSession
} from "../src/interaction.js";

test("CSS pointer coordinates map to simulation space independently of DPR", () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };
  assert.deepEqual(clientToBiomePoint(rect, 300, 150), { x: 0.5, y: 0.5 });
  assert.deepEqual(backingStoreSize(rect.width, rect.height, 1), { width: 400, height: 200, dpr: 1 });
  assert.deepEqual(backingStoreSize(rect.width, rect.height, 2.5), { width: 1000, height: 500, dpr: 2.5 });
  assert.deepEqual(clientToBiomePoint(rect, 300, 150), { x: 0.5, y: 0.5 });
});

test("pointer movement produces local gesture direction and bounded intensity", () => {
  const session = createPointerSession();
  beginPointerSession(session, 7, "wind", { x: 0.2, y: 0.7 });
  const action = movePointerSession(session, 7, { x: 0.28, y: 0.66 });
  assert.equal(action.mode, "wind");
  assert.ok(action.dx > 0);
  assert.ok(action.dy < 0);
  assert.ok(action.intensity > 0.38 && action.intensity <= 1.35);
});

test("pointerup cleanup ends the owned gesture and ignores later moves", () => {
  const session = createPointerSession();
  beginPointerSession(session, 8, "rain", { x: 0.4, y: 0.6 });
  assert.equal(endPointerSession(session, 8), true);
  assert.equal(session.active, false);
  assert.equal(session.pointerId, null);
  assert.equal(movePointerSession(session, 8, { x: 0.5, y: 0.6 }), null);
});

test("pointercancel cleanup ends the owned gesture without leaving active mode", () => {
  const session = createPointerSession();
  beginPointerSession(session, 9, "wind", { x: 0.4, y: 0.6 });
  assert.equal(cancelPointerSession(session, 9), true);
  assert.equal(session.active, false);
  assert.equal(session.pointerId, null);
});

test("unrelated pointer lifecycle events cannot steal or end the active gesture", () => {
  const session = createPointerSession();
  beginPointerSession(session, 11, "wind", { x: 0.2, y: 0.5 });
  assert.equal(movePointerSession(session, 12, { x: 0.4, y: 0.5 }), null);
  assert.equal(endPointerSession(session, 12), false);
  assert.equal(session.active, true);
  assert.equal(session.pointerId, 11);
});
