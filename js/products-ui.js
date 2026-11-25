// Rendu commun des produits : vignette (photo perso > photo Open Food Facts > émoji), libellés.

import { esc } from "./ui.js";
import { state, categoryOf, loadPhoto } from "./store.js";
import { qtyLabel } from "./catalog.js";

export function emojiOf(p) {
  return p?.emoji || categoryOf(p?.categoryId)?.icon || "📦";
}

export function thumbHtml(p, cls = "") {
  const emoji = esc(emojiOf(p));
  if (p?.hasPhoto && p.id) {
    return `<span class="thumb ${cls}" data-photo="${esc(p.id)}" aria-hidden="true">${emoji}</span>`;
  }
  if (p?.imageUrl) {
    return `<span class="thumb ${cls}" aria-hidden="true"><img src="${esc(p.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${emoji}"></span>`;
  }
  return `<span class="thumb ${cls}" aria-hidden="true">${emoji}</span>`;
}

// À appeler après chaque insertion de vignettes dans le DOM.
export function hydrateThumbs(root) {
  root.querySelectorAll("img[data-fallback]").forEach(img => {
    if (img.dataset.bound) return;
    img.dataset.bound = "1";
    const fail = () => { img.parentElement && (img.parentElement.textContent = img.dataset.fallback); };
    if (img.complete && img.naturalWidth === 0 && img.src) fail();
    else img.addEventListener("error", fail, { once: true });
  });
  root.querySelectorAll("[data-photo]").forEach(el => {
    const p = state.products.find(x => x.id === el.dataset.photo);
    if (!p) return;
    loadPhoto(p).then(data => {
      if (data && el.isConnected) el.innerHTML = `<img src="${data}" alt="">`;
    });
  });
}

export function subLine(p) {
  const bits = [];
  if (p.brand) bits.push(p.brand);
  if (p.format) bits.push(p.format);
  return bits.join(", ");
}

export function stockText(p) {
  return qtyLabel(p.qty, p.unit);
}

export const byName = (a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
