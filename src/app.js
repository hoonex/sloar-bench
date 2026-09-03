import {
  createScheduleState,
  hydrateScheduleState,
  serializeScheduleState,
  visiblePanels
} from "./schedule-state.js";

const STORAGE_KEY = "sloar-bench:schedule";

let state = hydrateScheduleState(localStorage.getItem(STORAGE_KEY));

const todayButton = document.querySelector("[data-mode='today']");
const weekButton = document.querySelector("[data-mode='week']");
const todayPanel = document.querySelector("#today-panel");
const weekPanel = document.querySelector("#week-panel");

function render() {
  const visible = visiblePanels(state);
  todayPanel.hidden = !visible.today;
  weekPanel.hidden = !visible.week;
  todayButton.setAttribute("aria-pressed", String(state.mode === "today"));
  weekButton.setAttribute("aria-pressed", String(state.mode === "week"));
}

function selectMode(mode) {
  state = createScheduleState(mode);
  localStorage.setItem(STORAGE_KEY, serializeScheduleState(state));
  render();
}

todayButton.addEventListener("click", () => selectMode("today"));
weekButton.addEventListener("click", () => selectMode("week"));
render();
