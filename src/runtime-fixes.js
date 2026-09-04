const activePointers = new Set();
const intentionalRelease = new Set();

export function formatRulerLabel(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  if (value < 10 && Math.abs(value - Math.round(value)) > 1e-9) {
    return `${Number(value.toFixed(3))}s`;
  }
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  if (minutes === 0) return `${Number(rest.toFixed(2))}s`;
  const whole = Math.floor(rest).toString().padStart(2, "0");
  const fraction = rest - Math.floor(rest);
  return fraction > 1e-9
    ? `${minutes}:${(rest).toFixed(2).padStart(5, "0")}`
    : `${minutes}:${whole}`;
}

export function isPrematureCaptureLoss({ active, intentional, targetIsClip }) {
  return Boolean(active && !intentional && targetIsClip);
}

function installPointerContinuityGuard() {
  window.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Element && event.target.closest(".clip")) {
      activePointers.add(event.pointerId);
      intentionalRelease.delete(event.pointerId);
    }
  }, true);

  const finishPointer = (event) => {
    activePointers.delete(event.pointerId);
    intentionalRelease.delete(event.pointerId);
  };
  window.addEventListener("pointerup", finishPointer, true);
  window.addEventListener("pointercancel", finishPointer, true);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      for (const pointerId of activePointers) intentionalRelease.add(pointerId);
    }
  }, true);
  window.addEventListener("blur", () => {
    for (const pointerId of activePointers) intentionalRelease.add(pointerId);
  }, true);

  window.addEventListener("lostpointercapture", (event) => {
    const target = event.target;
    const targetIsClip = target instanceof Element && target.classList.contains("clip");
    if (!isPrematureCaptureLoss({
      active: activePointers.has(event.pointerId),
      intentional: intentionalRelease.has(event.pointerId),
      targetIsClip
    })) return;

    // Reparenting an element that owns pointer capture releases capture in Chromium.
    // Tapegrid previews cross-track moves by reparenting the same clip element; reacquire
    // capture before the app's bubble-phase cleanup sees this intermediate loss.
    try {
      target.setPointerCapture(event.pointerId);
      event.stopImmediatePropagation();
    } catch {
      // If the pointer can no longer be captured, let the app's normal lost-capture
      // handler roll back the transaction instead of masking a genuine interruption.
    }
  }, true);
}

function relabelRuler() {
  for (const tick of document.querySelectorAll("#ruler .tick.major[data-time]")) {
    const label = tick.querySelector("b");
    if (label) label.textContent = formatRulerLabel(tick.dataset.time);
  }
}

function keepRulerLabelsFresh() {
  const ruler = document.querySelector("#ruler");
  if (!ruler) return;
  relabelRuler();
  const observer = new MutationObserver(() => relabelRuler());
  observer.observe(ruler, { childList: true });
}

function install() {
  installPointerContinuityGuard();
  keepRulerLabelsFresh();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
}
