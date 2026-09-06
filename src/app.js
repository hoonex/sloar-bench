import {
  PROPOSALS,
  hydrateRelayState,
  selectAgent,
  selectedChangeCount,
  serializeRelayState,
  toggleChange
} from "./relay-state.js";

const STATE_KEY = "relay:demo-state";

function readStoredState() {
  try { return localStorage.getItem(STATE_KEY); } catch { return null; }
}

let state = hydrateRelayState(readStoredState());

const agentButtons = [...document.querySelectorAll("[data-agent]")];
const title = document.querySelector("[data-proposal-title]");
const meta = document.querySelector("[data-proposal-meta]");
const reasoning = document.querySelector("[data-proposal-reasoning]");
const changeList = document.querySelector("[data-change-list]");
const selectedCount = document.querySelector("[data-selected-count]");
const applyCopy = document.querySelector("[data-apply-copy]");
const applyButton = document.querySelector("[data-apply-button]");
const toast = document.querySelector("[data-toast]");

function persist() {
  try { localStorage.setItem(STATE_KEY, serializeRelayState(state)); } catch {}
}

function renderChanges() {
  const proposal = PROPOSALS[state.activeAgent];
  changeList.replaceChildren();

  proposal.changes.forEach((change, index) => {
    const item = document.createElement("li");
    item.className = "change-item";

    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.accepted[state.activeAgent][index];
    input.dataset.changeIndex = String(index);

    const check = document.createElement("span");
    check.className = "change-check";
    check.setAttribute("aria-hidden", "true");

    const copy = document.createElement("span");
    copy.className = "change-copy";

    const top = document.createElement("span");
    top.className = "change-topline";
    const file = document.createElement("code");
    file.textContent = change.file;
    const description = document.createElement("strong");
    description.textContent = change.label;
    top.append(file, description);

    const code = document.createElement("code");
    code.className = "diff-code";
    code.textContent = change.code;

    copy.append(top, code);
    label.append(input, check, copy);
    item.append(label);
    changeList.append(item);
  });
}

function render() {
  const proposal = PROPOSALS[state.activeAgent];
  title.textContent = proposal.title;
  meta.textContent = proposal.meta;
  reasoning.textContent = proposal.reasoning;

  agentButtons.forEach((button) => {
    const active = button.dataset.agent === state.activeAgent;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });

  renderChanges();
  const count = selectedChangeCount(state);
  const total = proposal.changes.length;
  selectedCount.textContent = `${count} of ${total} selected`;
  applyCopy.textContent = `${count} change${count === 1 ? "" : "s"} selected`;
  applyButton.disabled = count === 0;
}

agentButtons.forEach((button, index) => {
  button.addEventListener("click", () => {
    state = selectAgent(state, button.dataset.agent);
    persist();
    render();
  });

  button.addEventListener("keydown", (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = (index + offset + agentButtons.length) % agentButtons.length;
    agentButtons[next].click();
    agentButtons[next].focus();
  });
});

changeList.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-change-index]");
  if (!checkbox) return;
  state = toggleChange(state, Number(checkbox.dataset.changeIndex));
  persist();
  render();
});

let toastTimer;
applyButton.addEventListener("click", () => {
  const count = selectedChangeCount(state);
  toast.textContent = `Preview: ${count} selected change${count === 1 ? "" : "s"} would be applied to the local working tree.`;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
});

const themeToggle = document.querySelector("[data-theme-toggle]");
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

function effectiveTheme() {
  return document.documentElement.dataset.theme || (themeMedia.matches ? "dark" : "light");
}

function syncThemeControl() {
  const current = effectiveTheme();
  themeToggle.setAttribute("aria-label", `Switch to ${current === "dark" ? "light" : "dark"} appearance`);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("relay:theme", theme); } catch {}
  syncThemeControl();
}

themeToggle.addEventListener("click", () => setTheme(effectiveTheme() === "dark" ? "light" : "dark"));
themeMedia.addEventListener?.("change", syncThemeControl);
syncThemeControl();

const menuButton = document.querySelector("[data-menu-toggle]");
const header = document.querySelector("[data-header]");
const nav = document.querySelector("#primary-nav");

function closeMenu() {
  header.dataset.menuOpen = "false";
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Open navigation");
}

menuButton.addEventListener("click", () => {
  const isOpen = header.dataset.menuOpen === "true";
  header.dataset.menuOpen = String(!isOpen);
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  menuButton.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
});

nav.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});

render();
