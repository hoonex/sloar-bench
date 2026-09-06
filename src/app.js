const root = document.documentElement;
const themeToggle = document.querySelector("[data-theme-toggle]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const mobileMenu = document.querySelector("[data-mobile-menu]");
const header = document.querySelector("[data-header]");

function readStoredTheme() {
  try {
    return localStorage.getItem("relay-theme");
  } catch {
    return null;
  }
}

function storeTheme(theme) {
  try {
    localStorage.setItem("relay-theme", theme);
  } catch {
    // Storage can be unavailable in hardened or opaque-origin contexts.
  }
}

function getPreferredTheme() {
  const stored = readStoredTheme();
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function setTheme(theme, persist = true) {
  root.dataset.theme = theme;
  if (persist) storeTheme(theme);
  if (themeToggle) {
    themeToggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
    themeToggle.dataset.activeTheme = theme;
  }
}

setTheme(getPreferredTheme(), false);

themeToggle?.addEventListener("click", () => {
  setTheme(root.dataset.theme === "dark" ? "light" : "dark");
});

function setMenu(open) {
  if (!menuToggle || !mobileMenu) return;
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  mobileMenu.hidden = !open;
  document.body.classList.toggle("menu-open", open);
}

menuToggle?.addEventListener("click", () => {
  setMenu(menuToggle.getAttribute("aria-expanded") !== "true");
});

mobileMenu?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => setMenu(false));
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 760) setMenu(false);
});

window.addEventListener("scroll", () => {
  header?.classList.toggle("scrolled", window.scrollY > 16);
}, { passive: true });

const heroAgents = [
  {
    badge: "Focused change",
    runtime: "2m 18s",
    summary: "Moves error emission into the parser iterator and keeps the existing diagnostics API intact. Adds one regression test around partial reads.",
    meta: ["Preserves public API", "Tests included"],
    file: "src/parser/stream.ts",
    stats: ["+24", "−8"],
    lines: [
      ["91", "context", "while (cursor.hasNext()) {"],
      ["92", "removed", "  errors.push(parseError(cursor));"],
      ["92", "added", "  yield diagnostics.from(cursor);"],
      ["93", "added", "  cursor.advance();"],
      ["94", "context", "}"]
    ]
  },
  {
    badge: "Smallest diff",
    runtime: "1m 54s",
    summary: "Introduces a lazy diagnostics source around the existing buffer. It touches fewer call sites and avoids changing parser control flow.",
    meta: ["3 files touched", "Adds lazy adapter"],
    file: "src/diagnostics/source.ts",
    stats: ["+17", "−4"],
    lines: [
      ["16", "context", "export class DiagnosticSource {"],
      ["17", "removed", "  constructor(readonly items: Diagnostic[]) {}"],
      ["17", "added", "  constructor(readonly items: Iterable<Diagnostic>) {}"],
      ["18", "added", "  *[Symbol.iterator]() { yield* this.items; }"],
      ["19", "context", "}"]
    ]
  },
  {
    badge: "Broader refactor",
    runtime: "3m 07s",
    summary: "Reframes parsing around async generators so diagnostics and values share one streaming pipeline. Cleaner long term, but a larger migration.",
    meta: ["5 files touched", "API migration"],
    file: "src/parser/pipeline.ts",
    stats: ["+36", "−14"],
    lines: [
      ["32", "context", "export async function* pipeline(input) {"],
      ["33", "removed", "  const result = await parseAll(input);"],
      ["33", "added", "  for await (const event of parse(input)) {"],
      ["34", "added", "    yield normalize(event);"],
      ["35", "context", "}"]
    ]
  }
];

const heroTabs = document.querySelectorAll("[data-hero-agent]");
const heroSummary = document.querySelector("[data-hero-summary]");
const heroDiff = document.querySelector("[data-hero-diff]");

function renderHeroAgent(index) {
  const agent = heroAgents[index];
  if (!agent || !heroSummary || !heroDiff) return;
  heroTabs.forEach((tab, i) => {
    const active = i === index;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  heroSummary.innerHTML = `
    <div class="proposal-head"><span class="confidence-badge">${agent.badge}</span><span class="runtime">${agent.runtime}</span></div>
    <p>${agent.summary}</p>
    <div class="summary-meta"><span><i class="meta-icon">↳</i> ${agent.meta[0]}</span><span><i class="meta-icon">✓</i> ${agent.meta[1]}</span></div>`;
  heroDiff.innerHTML = `
    <div class="diff-file"><span>${agent.file}</span><span class="diff-stats"><i>${agent.stats[0]}</i> <b>${agent.stats[1]}</b></span></div>
    ${agent.lines.map(([number, kind, code]) => `<div class="code-line ${kind}"><span>${number}</span><code>${code.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</code></div>`).join("")}`;
}

heroTabs.forEach((tab) => {
  tab.addEventListener("click", () => renderHeroAgent(Number(tab.dataset.heroAgent)));
});

const workflowSteps = document.querySelectorAll("[data-workflow-step]");
const workflowPanels = document.querySelectorAll("[data-workflow-panel]");

function selectWorkflowStep(index) {
  workflowSteps.forEach((step, i) => {
    const active = i === index;
    step.classList.toggle("active", active);
    step.setAttribute("aria-pressed", String(active));
  });
  workflowPanels.forEach((panel, i) => {
    panel.hidden = i !== index;
  });
}

workflowSteps.forEach((step) => {
  step.addEventListener("click", () => selectWorkflowStep(Number(step.dataset.workflowStep)));
});

const changeRows = document.querySelectorAll("[data-change]");
const acceptedCount = document.querySelector("[data-accepted-count]");
const applyButton = document.querySelector("[data-apply-changes]");

function refreshChangeSummary() {
  const count = [...changeRows].filter((row) => row.dataset.state === "accepted").length;
  if (acceptedCount) acceptedCount.textContent = String(count);
  if (applyButton) {
    applyButton.textContent = count === 1 ? "Apply 1 change" : `Apply ${count} changes`;
    applyButton.disabled = count === 0;
  }
}

changeRows.forEach((row) => {
  const accept = row.querySelector("[data-accept]");
  const reject = row.querySelector("[data-reject]");

  accept?.addEventListener("click", () => {
    row.dataset.state = "accepted";
    accept.classList.add("active");
    accept.textContent = "Accepted";
    reject.classList.remove("active");
    reject.textContent = "Reject";
    refreshChangeSummary();
  });

  reject?.addEventListener("click", () => {
    row.dataset.state = "rejected";
    reject.classList.add("active", "reject");
    reject.textContent = "Rejected";
    accept.classList.remove("active");
    accept.textContent = "Accept";
    refreshChangeSummary();
  });
});

applyButton?.addEventListener("click", () => {
  const count = [...changeRows].filter((row) => row.dataset.state === "accepted").length;
  if (!count) return;
  const original = applyButton.textContent;
  applyButton.textContent = "Applied to working tree ✓";
  applyButton.classList.add("applied");
  applyButton.disabled = true;
  window.setTimeout(() => {
    applyButton.textContent = original;
    applyButton.classList.remove("applied");
    applyButton.disabled = false;
  }, 1800);
});

const revealItems = document.querySelectorAll(".reveal, .section-heading, .compare-card, .detail-card, .control-copy, .review-mockup, .local-panel");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });
  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());
