const root = document.documentElement;
const themeToggle = document.querySelector("[data-theme-toggle]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const mobileMenu = document.querySelector("[data-mobile-menu]");
const header = document.querySelector("[data-header]");

function currentTheme() {
  return root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function updateThemeControl() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  themeToggle?.setAttribute("aria-label", `Switch to ${next} theme`);
}

function setTheme(theme) {
  root.dataset.theme = theme;
  try { localStorage.setItem("relay-theme", theme); } catch {}
  updateThemeControl();
}

themeToggle?.addEventListener("click", () => setTheme(currentTheme() === "dark" ? "light" : "dark"));
updateThemeControl();

function closeMenu() {
  if (!mobileMenu || !menuToggle) return;
  mobileMenu.hidden = true;
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open navigation");
}

menuToggle?.addEventListener("click", () => {
  const opening = mobileMenu.hidden;
  mobileMenu.hidden = !opening;
  menuToggle.setAttribute("aria-expanded", String(opening));
  menuToggle.setAttribute("aria-label", opening ? "Close navigation" : "Open navigation");
});

mobileMenu?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
window.addEventListener("resize", () => { if (innerWidth > 760) closeMenu(); });

const onScroll = () => header?.classList.toggle("scrolled", scrollY > 8);
onScroll();
addEventListener("scroll", onScroll, { passive: true });

const agentData = {
  a: {
    title: "Preserve parser context through error recovery",
    reasoning: "Keeps the existing parser flow intact and threads a small context object through recovery, so diagnostics gain source spans without changing call-site behavior."
  },
  b: {
    title: "Attach source spans at error construction sites",
    reasoning: "Touches fewer files by computing spans where errors are created. The patch is smaller, but it introduces two new parameters at existing parser call sites."
  },
  c: {
    title: "Centralize diagnostics behind a reporting layer",
    reasoning: "Builds a broader diagnostic abstraction that handles spans and hints consistently. It creates a cleaner boundary, but expands the scope beyond the immediate parser bug."
  }
};

const agentTabs = [...document.querySelectorAll("[data-agent]")];
const agentTitle = document.querySelector("[data-agent-title]");
const agentReasoning = document.querySelector("[data-agent-reasoning]");
const reviewStatus = document.querySelector("[data-review-status]");
const queueCount = document.querySelector("[data-queue-count]");
const reviewButtons = [...document.querySelectorAll("[data-review]")];
let reviewDecision = null;

function resetReview() {
  reviewDecision = null;
  if (reviewStatus) reviewStatus.textContent = "Unreviewed hunk";
  reviewButtons.forEach((button) => button.classList.remove("chosen"));
  if (queueCount) queueCount.textContent = "0 changes queued";
}

function selectAgent(key) {
  agentTabs.forEach((tab) => {
    const selected = tab.dataset.agent === key;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  if (agentTitle) agentTitle.textContent = agentData[key].title;
  if (agentReasoning) agentReasoning.textContent = agentData[key].reasoning;
  resetReview();
}

agentTabs.forEach((tab) => tab.addEventListener("click", () => selectAgent(tab.dataset.agent)));

reviewButtons.forEach((button) => button.addEventListener("click", () => {
  reviewDecision = button.dataset.review;
  reviewButtons.forEach((item) => item.classList.toggle("chosen", item === button));
  if (reviewStatus) reviewStatus.textContent = reviewDecision === "accept" ? "Change accepted" : "Change rejected";
  if (queueCount) queueCount.textContent = reviewDecision === "accept" ? "1 change queued" : "0 changes queued";
}));

const downloadButton = document.querySelector("[data-download-button]");
const downloadLabel = document.querySelector("[data-download-label]");
const downloadNote = document.querySelector("[data-download-note]");

function platformName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  if (/mac/i.test(platform)) return "macOS";
  if (/win/i.test(platform)) return "Windows";
  if (/linux|x11/i.test(platform)) return "Linux";
  return "desktop";
}

const platform = platformName();
if (downloadLabel && platform !== "desktop") downloadLabel.textContent = `Download for ${platform}`;

downloadButton?.addEventListener("click", () => {
  if (!downloadNote) return;
  downloadNote.textContent = "Relay is a fictional product for this benchmark, so there is no installer to download.";
  downloadButton.classList.add("acknowledged");
});

const revealItems = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("visible"));
}
