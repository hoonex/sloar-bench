const hero = document.querySelector("[data-hero]");
const flavorButtons = Array.from(document.querySelectorAll("[data-flavor-button]"));
const cans = Array.from(document.querySelectorAll("[data-can]"));
const tasterNote = document.querySelector("[data-taster-note]");
const menuButton = document.querySelector(".menu-toggle");
const primaryNav = document.querySelector("#primary-nav");

const flavorNotes = {
  yuzu: "Bright citrus opens first; green tea gives it a clean, leafy finish.",
  peach: "Ripe peach feels soft and juicy; roasted oolong adds a warm, toasty edge.",
  orange: "Bittersweet blood orange meets black tea for the deepest, driest finish."
};

function selectFlavor(flavor) {
  if (!hero || !flavorNotes[flavor]) return;
  hero.dataset.flavor = flavor;
  flavorButtons.forEach((button) => {
    const active = button.dataset.flavorButton === flavor;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  cans.forEach((can) => can.classList.toggle("is-active", can.dataset.can === flavor));
  if (tasterNote) tasterNote.textContent = flavorNotes[flavor];
}

flavorButtons.forEach((button) => {
  button.addEventListener("click", () => selectFlavor(button.dataset.flavorButton));
});

function setMenu(open) {
  if (!menuButton || !primaryNav) return;
  menuButton.setAttribute("aria-expanded", String(open));
  primaryNav.classList.toggle("is-open", open);
  document.body.classList.toggle("menu-open", open);
}

menuButton?.addEventListener("click", () => {
  setMenu(menuButton.getAttribute("aria-expanded") !== "true");
});

primaryNav?.addEventListener("click", (event) => {
  if (event.target instanceof HTMLAnchorElement) setMenu(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setMenu(false);
});

const desktopQuery = window.matchMedia("(min-width: 1021px)");
desktopQuery.addEventListener?.("change", (event) => {
  if (event.matches) setMenu(false);
});

selectFlavor("yuzu");
