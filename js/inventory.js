// Grand inventaire : on passe chaque produit en revue et on note la quantité réelle.
// Le comptage est gardé sur l'appareil (on peut s'interrompre et reprendre) ;
// à la fin, les quantités comptées écrasent celles du placard.

import { $, $$, esc, fmtQty, fmtDate, toast, persist, confirmDialog } from "./ui.js";
import { state, categories, categoryOf, applyInventory, findByCode } from "./store.js";
import { unitOf, stepOf, qtyLabel } from "./catalog.js";
import { thumbHtml, hydrateThumbs, subLine, byName } from "./products-ui.js";
import { openScanner } from "./scanner.js";
import { stepperHtml, bindStepper, pickProduct } from "./app.js";

const key = () => `fdp:inventory:${state.hid}`;

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(key()) || "null"); } catch { return null; }
}
function saveDraft(d) {
  try { localStorage.setItem(key(), JSON.stringify(d)); } catch { /* stockage plein */ }
}
function clearDraft() {
  try { localStorage.removeItem(key()); } catch { /* rien */ }
}

const productById = id => state.products.find(p => p.id === id) || null;
let selectedCats = null;

export function renderInventory(ctx) {
  const draft = loadDraft();
  if (!draft) return renderIntro(ctx);
  // Produits supprimés entre-temps : on les retire du parcours.
  draft.order = draft.order.filter(id => productById(id));
  if (draft.review || draft.idx >= draft.order.length) {
    draft.review = true;
    saveDraft(draft);
    return renderReview(ctx, draft);
  }
  return renderStep(ctx, draft);
}

/* ---------- Avant de commencer ---------- */

function renderIntro(ctx) {
  ctx.setHeader({ title: "Grand inventaire", kicker: ctx.kicker() });
  ctx.setFab(null);
  const view = $("#view");

  const update = () => {
    const cats = [...categories(), { id: "", name: "Sans rangement", icon: "📦" }];
    const counts = {};
    state.products.forEach(p => {
      const k = categoryOf(p.categoryId) ? p.categoryId : "";
      counts[k] = (counts[k] || 0) + 1;
    });
    const available = cats.filter(c => counts[c.id]);
    if (!selectedCats) selectedCats = new Set(available.map(c => c.id));
    const total = available.filter(c => selectedCats.has(c.id)).reduce((s, c) => s + counts[c.id], 0);
    const h = state.household;

    if (!state.products.length) {
      view.innerHTML = `
        <h2 class="display">Grand inventaire</h2>
        <div class="empty"><i class="fa-solid fa-clipboard-list" aria-hidden="true"></i>
        <p>Ajoute d’abord des produits à ton placard : l’inventaire permettra ensuite de recaler leurs quantités.</p></div>`;
      return;
    }

    view.innerHTML = `
      <h2 class="display">Grand inventaire</h2>
      <p class="lead">Passe en revue chaque produit et note ce qu’il reste vraiment. À la fin, les quantités comptées remplacent celles de l’appli, pour tout le foyer.</p>
      ${h.lastInventoryAt ? `<p class="muted" style="margin-top:8px">Dernier inventaire le ${esc(fmtDate(h.lastInventoryAt))}${h.lastInventoryBy ? ` par ${esc(h.lastInventoryBy)}` : ""}.</p>` : ""}
      <section class="block">
        <h3 class="block-title">Rangements à compter</h3>
        <div class="inv-cats">
          ${available.map(c => `<label><input type="checkbox" data-cat="${esc(c.id)}" ${selectedCats.has(c.id) ? "checked" : ""}><span>${esc(c.icon)} ${esc(c.name)} <b>${counts[c.id]}</b></span></label>`).join("")}
        </div>
      </section>
      <div class="shop-actions">
        <button type="button" class="btn btn-primary btn-block" data-start ${total ? "" : "disabled"}>
          <i class="fa-solid fa-play"></i> Commencer (${total} produit${total > 1 ? "s" : ""})
        </button>
        <p class="muted">Tu peux t’arrêter en cours de route : le comptage est gardé sur ce téléphone jusqu’à ce que tu l’enregistres.</p>
      </div>`;

    $$("[data-cat]", view).forEach(i => i.onchange = () => {
      if (i.checked) selectedCats.add(i.dataset.cat); else selectedCats.delete(i.dataset.cat);
      update();
    });
    $("[data-start]", view).onclick = () => {
      const catOrder = cats.map(c => c.id);
      const order = state.products
        .filter(p => selectedCats.has(categoryOf(p.categoryId) ? p.categoryId : ""))
        .sort((a, b) => {
          const ca = catOrder.indexOf(categoryOf(a.categoryId) ? a.categoryId : "");
          const cb = catOrder.indexOf(categoryOf(b.categoryId) ? b.categoryId : "");
          return ca - cb || byName(a, b);
        })
        .map(p => p.id);
      saveDraft({ startedAt: Date.now(), order, idx: 0, counts: {}, review: false, zeroUncounted: false });
      selectedCats = null;
      ctx.rerender();
    };
  };

  update();
  return update;
}

/* ---------- Comptage, produit par produit ---------- */

function renderStep(ctx, draft) {
  const n = draft.order.length;
  const p = productById(draft.order[draft.idx]);
  const counted = Object.keys(draft.counts).length;
  const goTo = idx => { draft.idx = Math.max(0, idx); draft.review = false; saveDraft(draft); ctx.rerender(); };

  ctx.setHeader({
    title: "Grand inventaire",
    kicker: `Produit ${draft.idx + 1} sur ${n}`,
    actions: [
      { icon: "fa-magnifying-glass", label: "Aller à un produit", onClick: jumpList },
      { icon: "fa-barcode", label: "Scanner pour aller au produit", onClick: jumpScan }
    ]
  });
  ctx.setFab(null);

  const cat = categoryOf(p.categoryId);
  const has = Object.prototype.hasOwnProperty.call(draft.counts, p.id);
  const value = has ? draft.counts[p.id] : p.qty;
  const view = $("#view");
  view.innerHTML = `
    <div class="inv-progress">
      <div class="inv-progress-bar"><span style="width:${Math.round((counted / n) * 100)}%"></span></div>
      <span class="inv-progress-text">${counted} / ${n} comptés</span>
    </div>
    <article class="inv-card">
      ${thumbHtml(p, "thumb--lg")}
      <span class="inv-cat">${esc(cat ? `${cat.icon} ${cat.name}` : "Sans rangement")}</span>
      <h2>${esc(p.name)}</h2>
      ${subLine(p) ? `<span class="muted">${esc(subLine(p))}</span>` : ""}
      <p class="inv-was">Dans l’appli : <strong>${esc(qtyLabel(p.qty, p.unit))}</strong>${has ? `, compté : <strong>${esc(qtyLabel(draft.counts[p.id], p.unit))}</strong>` : ""}</p>
      ${stepperHtml("count", value, stepOf(p), { label: `Quantité réelle de ${p.name}`, lg: true })}
      <small class="muted">${esc(unitOf(p.unit).label)}</small>
      <div class="inv-nav">
        <button type="button" class="btn btn-ghost" data-prev aria-label="Produit précédent" ${draft.idx === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-left"></i></button>
        <button type="button" class="btn btn-primary" data-ok><i class="fa-solid fa-check"></i> Valider${draft.idx < n - 1 ? " et continuer" : " et terminer"}</button>
      </div>
    </article>
    <div class="inv-tools">
      <button type="button" class="btn btn-ghost btn-small" data-zero>Il n’y en a plus</button>
      <button type="button" class="btn btn-ghost btn-small" data-skip>Passer</button>
      <button type="button" class="btn btn-ghost btn-small" data-review><i class="fa-solid fa-list-check"></i> Revoir et terminer</button>
    </div>`;
  hydrateThumbs(view);

  const stepper = bindStepper($('[data-stepper="count"]', view));
  const validate = v => {
    draft.counts[p.id] = Math.max(0, v);
    goTo(draft.idx + 1);
    window.scrollTo(0, 0);
  };
  $("[data-ok]", view).onclick = () => validate(stepper.read());
  $("[data-zero]", view).onclick = () => validate(0);
  $("[data-prev]", view).onclick = () => goTo(draft.idx - 1);
  $("[data-skip]", view).onclick = () => goTo(draft.idx + 1);
  $("[data-review]", view).onclick = () => { draft.review = true; saveDraft(draft); ctx.rerender(); };
  $('[data-stepper="count"] input', view).addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); validate(stepper.read()); }
  });

  function jumpList() {
    const ids = new Set(draft.order);
    pickProduct({
      title: "Aller à un produit",
      filter: x => ids.has(x.id),
      onPick: target => goTo(draft.order.indexOf(target.id))
    });
  }

  function jumpScan() {
    openScanner({
      title: "Aller au produit",
      hint: "Scanne le produit que tu as en main",
      onCode: async (code, sc) => {
        const target = findByCode(code);
        const pos = target ? draft.order.indexOf(target.id) : -1;
        if (pos < 0) {
          sc.setPanel(`<p class="scanner-error">${target ? `« ${esc(target.name)} » ne fait pas partie de cet inventaire.` : "Ce code n’est pas dans le placard. Ajoute le produit après l’inventaire."}</p>`);
          setTimeout(() => sc.resume(), 900);
          return;
        }
        await sc.closeNow();
        goTo(pos);
      }
    });
  }

  return () => {};
}

/* ---------- Vérification et enregistrement ---------- */

function renderReview(ctx, draft) {
  ctx.setHeader({ title: "Vérification", kicker: "Grand inventaire" });
  ctx.setFab(null);
  const view = $("#view");

  const update = () => {
    const items = draft.order.map(productById).filter(Boolean);
    const counted = items.filter(p => Object.prototype.hasOwnProperty.call(draft.counts, p.id));
    const uncounted = items.filter(p => !Object.prototype.hasOwnProperty.call(draft.counts, p.id));
    const changes = counted.filter(p => draft.counts[p.id] !== p.qty);
    const zeroing = draft.zeroUncounted ? uncounted.filter(p => p.qty > 0) : [];

    view.innerHTML = `
      <h2 class="display">${changes.length + zeroing.length ? `${changes.length + zeroing.length} quantité${changes.length + zeroing.length > 1 ? "s" : ""} à corriger` : "Tout est juste"}</h2>
      <p class="lead">${counted.length} produit${counted.length > 1 ? "s" : ""} compté${counted.length > 1 ? "s" : ""} sur ${items.length}.
        ${changes.length + zeroing.length ? "En enregistrant, ces quantités remplacent celles de l’appli." : "Aucun écart avec l’appli sur les produits comptés."}</p>

      ${changes.length ? `
      <section class="block">
        <h3 class="block-title">Écarts</h3>
        <ul class="rows">${changes.map(p => {
          const d = draft.counts[p.id] - p.qty;
          return `<li>
            ${thumbHtml(p)}
            <button type="button" class="rows-text" data-goto="${esc(p.id)}" style="border:0;background:none;padding:0;text-align:left">
              <strong>${esc(p.name)}</strong>
              <small>${esc(qtyLabel(p.qty, p.unit))} → ${esc(qtyLabel(draft.counts[p.id], p.unit))}</small>
            </button>
            <span class="${d > 0 ? "diff-up" : "diff-down"}">${d > 0 ? "+" : "−"}${fmtQty(Math.abs(d))}</span>
          </li>`;
        }).join("")}</ul>
      </section>` : ""}

      ${uncounted.length ? `
      <section class="block">
        <h3 class="block-title">Pas comptés (${uncounted.length})</h3>
        <div class="switch-row">
          <span><strong>Les mettre à 0</strong><small>Sinon, leur quantité ne change pas</small></span>
          <label class="switch"><input type="checkbox" data-zero-all ${draft.zeroUncounted ? "checked" : ""} aria-label="Mettre à 0 les produits non comptés"><span></span></label>
        </div>
        <ul class="rows" style="margin-top:8px">${uncounted.slice(0, 30).map(p => `<li>
          ${thumbHtml(p)}
          <button type="button" class="rows-text" data-goto="${esc(p.id)}" style="border:0;background:none;padding:0;text-align:left">
            <strong>${esc(p.name)}</strong><small>Dans l’appli : ${esc(qtyLabel(p.qty, p.unit))}</small>
          </button>
          <i class="fa-solid fa-chevron-right muted" aria-hidden="true"></i>
        </li>`).join("")}${uncounted.length > 30 ? `<li class="muted">Et ${uncounted.length - 30} autres…</li>` : ""}</ul>
      </section>` : ""}

      <div class="shop-actions">
        <button type="button" class="btn btn-primary btn-block" data-apply><i class="fa-solid fa-floppy-disk"></i> Enregistrer l’inventaire</button>
        <button type="button" class="btn btn-ghost btn-block" data-resume><i class="fa-solid fa-arrow-rotate-left"></i> Reprendre le comptage</button>
        <button type="button" class="link-btn" data-abort>Abandonner cet inventaire</button>
      </div>`;
    hydrateThumbs(view);

    $$("[data-goto]", view).forEach(b => b.onclick = () => {
      draft.idx = draft.order.indexOf(b.dataset.goto);
      draft.review = false;
      saveDraft(draft);
      ctx.rerender();
    });
    $("[data-zero-all]", view)?.addEventListener("change", e => {
      draft.zeroUncounted = e.target.checked;
      saveDraft(draft);
      update();
    });
    $("[data-resume]", view).onclick = () => {
      const firstUncounted = draft.order.findIndex(id => !Object.prototype.hasOwnProperty.call(draft.counts, id));
      draft.idx = firstUncounted >= 0 ? firstUncounted : Math.max(0, draft.order.length - 1);
      draft.review = false;
      saveDraft(draft);
      ctx.rerender();
    };
    $("[data-abort]", view).onclick = async () => {
      const ok = await confirmDialog("Abandonner cet inventaire ?", { confirmLabel: "Abandonner", danger: true, detail: "Le comptage en cours est effacé. Le placard ne change pas." });
      if (!ok) return;
      clearDraft();
      ctx.rerender();
    };
    $("[data-apply]", view).onclick = async () => {
      const entries = [
        ...changes.map(p => ({ product: p, qty: draft.counts[p.id] })),
        ...zeroing.map(p => ({ product: p, qty: 0 }))
      ];
      if (entries.length) {
        const ok = await confirmDialog(`Remplacer ${entries.length} quantité${entries.length > 1 ? "s" : ""} ?`, {
          confirmLabel: "Enregistrer", detail: "Les quantités comptées écrasent celles de l’appli, pour tout le foyer."
        });
        if (!ok) return;
        persist(applyInventory(entries));
      } else {
        persist(applyInventory([]));
      }
      clearDraft();
      toast(entries.length ? `Inventaire enregistré : ${entries.length} quantité${entries.length > 1 ? "s" : ""} corrigée${entries.length > 1 ? "s" : ""}` : "Inventaire enregistré");
      location.hash = "#/";
    };
  };

  update();
  return update;
}
