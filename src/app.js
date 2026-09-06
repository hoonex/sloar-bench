const flavors = {
  yuzu: {
    theme: "yuzu",
    kicker: "GREEN TEA / CITRUS",
    title: "Sharp sun,<br>soft tea.",
    description: "Yuzu lands bright and aromatic, while green tea keeps the finish fresh and composed.",
    canFlavor: "Yuzu<br>Green Tea",
    scales: { bright: "88%", roasted: "22%", citrus: "92%" }
  },
  peach: {
    theme: "peach",
    kicker: "OOLONG / STONE FRUIT",
    title: "Ripe fruit,<br>toasty edges.",
    description: "Peach brings a soft, juicy middle; roasted oolong answers with warm depth and a drier finish.",
    canFlavor: "Peach<br>Oolong",
    scales: { bright: "58%", roasted: "78%", citrus: "10%" }
  },
  orange: {
    theme: "orange",
    kicker: "BLACK TEA / CITRUS",
    title: "Bitter peel,<br>dark tea.",
    description: "Blood orange leans bittersweet and vivid against the fuller character of black tea.",
    canFlavor: "Blood Orange<br>Black Tea",
    scales: { bright: "70%", roasted: "52%", citrus: "86%" }
  }
};

const stage = document.querySelector("[data-flavor-stage]");
const flavorButtons = [...document.querySelectorAll("[data-flavor]")];

function selectFlavor(key) {
  const flavor = flavors[key];
  if (!flavor || !stage) return;

  stage.dataset.theme = flavor.theme;
  stage.querySelector("[data-stage-kicker]").textContent = flavor.kicker;
  stage.querySelector("[data-stage-title]").innerHTML = flavor.title;
  stage.querySelector("[data-stage-description]").textContent = flavor.description;
  stage.querySelector("[data-stage-can-flavor]").innerHTML = flavor.canFlavor;
  stage.querySelector("[data-scale-bright]").style.width = flavor.scales.bright;
  stage.querySelector("[data-scale-roasted]").style.width = flavor.scales.roasted;
  stage.querySelector("[data-scale-citrus]").style.width = flavor.scales.citrus;

  flavorButtons.forEach((button) => {
    const active = button.dataset.flavor === key;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

flavorButtons.forEach((button) => {
  button.addEventListener("click", () => selectFlavor(button.dataset.flavor));
});

const menuButton = document.querySelector("[data-menu-button]");
const mobileNav = document.querySelector("[data-mobile-nav]");

function setMenu(open) {
  if (!menuButton || !mobileNav) return;
  menuButton.setAttribute("aria-expanded", String(open));
  mobileNav.hidden = !open;
}

menuButton?.addEventListener("click", () => {
  setMenu(menuButton.getAttribute("aria-expanded") !== "true");
});

mobileNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => setMenu(false));
});

const revealItems = document.querySelectorAll(".reveal");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (prefersReducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -30px" });

  revealItems.forEach((item) => observer.observe(item));
}
