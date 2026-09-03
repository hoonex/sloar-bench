function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function clientToBiomePoint(rect, clientX, clientY) {
  const width = Math.max(1, Number(rect.width) || 0);
  const height = Math.max(1, Number(rect.height) || 0);
  return {
    x: clamp01(((Number(clientX) || 0) - (Number(rect.left) || 0)) / width),
    y: clamp01(((Number(clientY) || 0) - (Number(rect.top) || 0)) / height)
  };
}

export function backingStoreSize(cssWidth, cssHeight, devicePixelRatio = 1) {
  const dpr = Math.max(1, Math.min(3, Number(devicePixelRatio) || 1));
  return {
    width: Math.max(1, Math.round(Math.max(1, Number(cssWidth) || 1) * dpr)),
    height: Math.max(1, Math.round(Math.max(1, Number(cssHeight) || 1) * dpr)),
    dpr
  };
}

export function createPointerSession() {
  return {
    active: false,
    pointerId: null,
    mode: "wind",
    lastX: 0,
    lastY: 0
  };
}

export function beginPointerSession(session, pointerId, mode, point) {
  session.active = true;
  session.pointerId = pointerId;
  session.mode = mode === "rain" ? "rain" : "wind";
  session.lastX = point.x;
  session.lastY = point.y;
  return {
    mode: session.mode,
    x: point.x,
    y: point.y,
    dx: 0,
    dy: 0,
    intensity: session.mode === "rain" ? 0.72 : 0.46
  };
}

export function movePointerSession(session, pointerId, point) {
  if (!session.active || session.pointerId !== pointerId) return null;
  const dx = point.x - session.lastX;
  const dy = point.y - session.lastY;
  session.lastX = point.x;
  session.lastY = point.y;
  const distance = Math.hypot(dx, dy);
  return {
    mode: session.mode,
    x: point.x,
    y: point.y,
    dx,
    dy,
    intensity: session.mode === "rain" ? Math.min(1.2, 0.55 + distance * 8) : Math.min(1.35, 0.38 + distance * 15)
  };
}

export function endPointerSession(session, pointerId) {
  if (!session.active || session.pointerId !== pointerId) return false;
  session.active = false;
  session.pointerId = null;
  return true;
}

export function cancelPointerSession(session, pointerId) {
  return endPointerSession(session, pointerId);
}
