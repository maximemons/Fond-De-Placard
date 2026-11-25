import { auth, googleProvider } from "./firebase-config.js";
import {
  onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, updateProfile
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

import {
  $, $$, esc, norm, toNum, fmtQty, fmtDate, toast, persist, confirmDialog, choiceDialog, promptDialog, newId,
  openSheet, compressImage, vibrate
} from "./ui.js";
import {
  state, subscribe, onHouseholdLost, loadUserHousehold, findInvites, createHousehold, watch, resetState,
  categories, categoryOf, findByCode, isLow, lowProducts, createProduct, updateProduct, deleteProduct,
  changeQty, addBarcode, removeBarcode, markSent, clearSent, loadPhoto, saveCategories, deleteCategory,
  renameHousehold, setListmeLink, inviteEmail, cancelInvite, removeMember, joinHousehold, leaveHousehold,
  myEmail, myName, uid, isOwner, updateMyMemberInfo
} from "./store.js";
import { UNITS, unitOf, stepOf, qtyLabel, FRESH, CATEGORY_ICONS } from "./catalog.js";
import { openScanner } from "./scanner.js";
import { lookupBarcode, isValidCode } from "./lookup.js";
import { buildListMeUrl, parseListMeLink, LISTME_URL } from "./listme.js";
import { thumbHtml, hydrateThumbs, subLine, stockText, byName, emojiOf } from "./products-ui.js";
import { renderInventory } from "./inventory.js";

/* =========================================================
   En-tête, bouton flottant, écrans
   ========================================================= */

let prevHash = "#/";
function setHeader({ title, kicker = "", actions = [], back = false }) {
  $("#topbar-title").textContent = title;
  $("#btn-back").classList.toggle("hidden", !back);
  $("#btn-home").classList.toggle("hidden", back);
  $("#btn-back").onclick = back ? () => { location.hash = prevHash.startsWith("#/compte") ? "#/" : prevHash; } : null;
  $("#btn-account").classList.toggle("is-active", routeName() === "compte");
  $("#topbar-kicker").textContent = kicker;
  $("#topbar-kicker").classList.toggle("hidden", !kicker);
  document.title = title === "Fond de placard" ? title : `${title} · Fond de placard`;
  const wrap = $("#topbar-actions");
  wrap.innerHTML = actions.map((a, i) =>
    `<button type="button" class="icon-btn" data-action-idx="${i}" aria-label="${esc(a.label)}" title="${esc(a.label)}"><i class="fa-solid ${a.icon}"></i></button>`
  ).join("");
  $$("[data-action-idx]", wrap).forEach(btn => btn.addEventListener("click", () => actions[+btn.dataset.actionIdx].onClick()));
}

function setFab(config) {
  const fab = $("#fab");
  if (!config) { fab.classList.add("hidden"); fab.onclick = null; return; }
  fab.innerHTML = `<i class="fa-solid ${config.icon || "fa-plus"}" aria-hidden="true"></i><span>${esc(config.label)}</span>`;
  fab.classList.remove("hidden");
  fab.onclick = config.onClick;
}

function showScreen(name) {
  $("#splash").classList.add("hidden");
  $("#login-screen").classList.toggle("hidden", name !== "login");
  $("#onboard-screen").classList.toggle("hidden", name !== "onboard");
  $("#app").classList.toggle("hidden", name !== "app");
}

const loadingHtml = `<div class="loading"><div class="brand-mark brand-mark--lg"><span></span><span></span><span></span></div></div>`;

function renderLoading() {
  setHeader({ title: "Fond de placard" });
  setFab(null);
  $("#view").innerHTML = loadingHtml;
}

const kicker = () => state.household?.name || "";

/* =========================================================
   Routage (#/, #/courses, #/inventaire, #/foyer, #/scan)
   ========================================================= */

const ctx = { setHeader, setFab, kicker, openProductSheet, rerender: () => render() };
let current = { route: null, update: null };

function routeName() {
  const r = location.hash.replace(/^#\/?/, "").split("/")[0];
  if (r === "foyer") return "compte";
  return ["courses", "inventaire", "rangements", "compte", "scan"].includes(r) ? r : "home";
}

function setActiveTab(route) {
  $$(".tabbar a").forEach(a => {
    const on = a.dataset.tab === route;
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

function render() {
  if (!state.user || !state.hid) return;
  if (!state.ready.household || !state.ready.products) { renderLoading(); current = { route: null, update: null }; return; }
  let route = routeName();
  if (route === "scan") {
    history.replaceState(null, "", "#/");
    route = "home";
    setTimeout(() => openMainScanner(), 300);
  }
  setActiveTab(route);
  const changed = current.route !== route;
  const views = { home: renderHome, courses: renderCourses, inventaire: () => renderInventory(ctx), rangements: renderRangements, compte: renderAccount };
  const update = views[route]();
  current = { route, update: typeof update === "function" ? update : null };
  if (changed) {
    window.scrollTo(0, 0);
    $("#view").focus({ preventScroll: true });
  }
}

// Mise à jour en direct : on ne reconstruit que ce qui bouge (la recherche garde le focus).
function onData() {
  updateBadge();
  if (!state.ready.household || !state.ready.products) return;
  if (current.route && current.update) current.update();
  else render();
}

let lastHash = location.hash || "#/";
window.addEventListener("hashchange", () => {
  if (!location.hash.startsWith("#/compte") && !location.hash.startsWith("#/foyer")) prevHash = location.hash || "#/";
  else if (!lastHash.startsWith("#/compte")) prevHash = lastHash;
  lastHash = location.hash;
  render();
});

function updateBadge() {
  const n = lowProducts().filter(p => !p.sentAt).length;
  const b = $("#courses-badge");
  b.textContent = n > 99 ? "99+" : String(n);
  b.classList.toggle("hidden", !n);
}

/* =========================================================
   Vue : placards
   ========================================================= */

const homeFilter = { q: "", cat: sessionStorage.getItem("fdp:cat") || "all" };

function renderHome() {
  setHeader({ title: "Placards", kicker: kicker() });
  setFab({ label: "Ajouter un produit", icon: "fa-plus", onClick: () => openAddSheet() });

  const view = $("#view");
  view.innerHTML = `
    <label class="search">
      <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
      <span class="sr-only">Rechercher un produit</span>
      <input type="search" id="home-q" placeholder="Rechercher un produit, une marque…" autocomplete="off" value="${esc(homeFilter.q)}">
    </label>
    <div class="chips" id="home-chips" role="group" aria-label="Filtrer par rangement"></div>
    <div id="home-list"></div>`;

  $("#home-q").addEventListener("input", e => { homeFilter.q = e.target.value; update(); });

  const update = () => {
    const prods = state.products;
    const cats = categories();
    const counts = {};
    prods.forEach(p => { counts[p.categoryId] = (counts[p.categoryId] || 0) + 1; });
    const lowCount = prods.filter(isLow).length;
    if (homeFilter.cat !== "all" && homeFilter.cat !== "low" && !cats.some(c => c.id === homeFilter.cat)) homeFilter.cat = "all";

    const chip = (id, label, n, extra = "") =>
      `<button type="button" class="${extra}" data-cat="${esc(id)}" aria-pressed="${homeFilter.cat === id}">${label} <b>${n}</b></button>`;
    $("#home-chips").innerHTML =
      chip("all", "Tout", prods.length) +
      (lowCount ? chip("low", `<i class="fa-solid fa-tag" aria-hidden="true"></i> À racheter`, lowCount, "chip-low") : "") +
      cats.map(c => chip(c.id, `${esc(c.icon)} ${esc(c.name)}`, counts[c.id] || 0)).join("");
    $$("#home-chips [data-cat]").forEach(b => b.addEventListener("click", () => {
      homeFilter.cat = b.dataset.cat;
      sessionStorage.setItem("fdp:cat", homeFilter.cat);
      update();
    }));

    const list = $("#home-list");
    if (!prods.length) {
      list.innerHTML = `
        <div class="empty">
          <i class="fa-solid fa-box-open" aria-hidden="true"></i>
          <p>Ton placard est vide. Scanne un premier produit, ou ajoute à la main ce qui n’a pas de code-barres.</p>
          <button type="button" class="btn btn-primary" data-empty-scan><i class="fa-solid fa-barcode"></i> Scanner un produit</button>
          <button type="button" class="btn btn-ghost" data-empty-add><i class="fa-solid fa-pen"></i> Ajouter sans code-barres</button>
        </div>`;
      $("[data-empty-scan]", list).onclick = () => openMainScanner();
      $("[data-empty-add]", list).onclick = () => openAddSheet();
      return;
    }

    const q = norm(homeFilter.q);
    let shown = prods.filter(p => {
      if (homeFilter.cat === "low" && !isLow(p)) return false;
      if (homeFilter.cat !== "all" && homeFilter.cat !== "low" && p.categoryId !== homeFilter.cat) return false;
      if (!q) return true;
      return norm(`${p.name} ${p.brand} ${p.listName} ${p.barcodes.join(" ")}`).includes(q);
    });

    if (!shown.length) {
      list.innerHTML = `<div class="empty"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><p>Aucun produit ne correspond.</p>
        ${q ? `<button type="button" class="btn btn-ghost" data-create-q><i class="fa-solid fa-plus"></i> Créer « ${esc(homeFilter.q.trim())} »</button>` : ""}</div>`;
      $("[data-create-q]", list)?.addEventListener("click", () => openProductSheet({ prefill: { name: homeFilter.q.trim() } }));
      return;
    }

    const groups = [...cats.map(c => ({ cat: c, items: [] })), { cat: { id: "", name: "Sans rangement", icon: "📦" }, items: [] }];
    shown.sort(byName).forEach(p => {
      const g = groups.find(x => x.cat.id === p.categoryId) || groups[groups.length - 1];
      g.items.push(p);
    });
    list.innerHTML = groups.filter(g => g.items.length).map(g => `
      <section class="shelf" aria-label="${esc(g.cat.name)}">
        <header class="shelf-head">
          <span class="shelf-icon" aria-hidden="true">${esc(g.cat.icon)}</span>
          <h2>${esc(g.cat.name)}</h2>
          <span>${g.items.length}</span>
        </header>
        <ul class="items">${g.items.map(itemRow).join("")}</ul>
      </section>`).join("");
    hydrateThumbs(list);
    bindItemRows(list, update);
  };

  update();
  return update;
}

function itemRow(p) {
  const low = isLow(p);
  const step = stepOf(p);
  const unit = unitOf(p.unit).short;
  return `
    <li class="item ${low ? "is-low" : ""} ${p.qty <= 0 ? "is-empty" : ""}" data-id="${esc(p.id)}">
      <button type="button" class="item-open" data-open>
        ${thumbHtml(p)}
        <span class="item-text">
          <strong>${esc(p.name)}</strong>
          ${subLine(p) ? `<small>${esc(subLine(p))}</small>` : ""}
          ${low ? `<span class="tag">${p.sentAt ? "Sur la liste" : "À racheter"}</span>` : ""}
        </span>
      </button>
      <div class="stepper" role="group" aria-label="Stock de ${esc(p.name)}">
        <button type="button" data-delta="-${step}" aria-label="Sortir ${fmtQty(step)} ${esc(unit)}" ${p.qty <= 0 ? "disabled" : ""}>−</button>
        <output aria-live="polite" title="${esc(stockText(p))}">${fmtQty(p.qty)}</output>
        <button type="button" data-delta="${step}" aria-label="Ajouter ${fmtQty(step)} ${esc(unit)}">+</button>
      </div>
    </li>`;
}

function bindItemRows(root, update) {
  $$(".item", root).forEach(li => {
    const p = state.products.find(x => x.id === li.dataset.id);
    if (!p) return;
    $("[data-open]", li).onclick = () => openProductSheet({ product: p });
    $$("[data-delta]", li).forEach(b => b.onclick = () => {
      const wasLow = isLow(p);
      const { applied, done } = changeQty(p, toNum(b.dataset.delta));
      if (!applied) return;
      vibrate(15);
      persist(done);
      if (!wasLow && isLow(p)) toast(`${p.name} est à racheter`);
      update();
    });
  });
}

/* =========================================================
   Ajouter un produit (sans code-barres, ou recherche)
   ========================================================= */

function openAddSheet() {
  openSheet({
    title: "Ajouter un produit",
    body: `
      <button type="button" class="btn btn-ghost btn-block" data-scan><i class="fa-solid fa-barcode"></i> Scanner un code-barres</button>
      <label class="search">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <span class="sr-only">Nom du produit</span>
        <input type="search" data-q placeholder="Pommes, riz, lessive…" autocomplete="off" enterkeyhint="go">
      </label>
      <ul class="pick-list" data-results></ul>`,
    onMount(el, entry) {
      const input = $("[data-q]", el);
      const results = $("[data-results]", el);
      $("[data-scan]", el).onclick = () => entry.close(() => openMainScanner());

      const draw = () => {
        const raw = input.value.trim();
        const q = norm(raw);
        const mine = state.products.filter(p => !q || norm(`${p.name} ${p.brand}`).includes(q)).sort(byName).slice(0, q ? 8 : 0);
        const mineNames = new Set(state.products.map(p => norm(p.name)));
        const fresh = FRESH.filter(f => (!q || norm(f.name).includes(q)) && !mineNames.has(norm(f.name))).slice(0, q ? 12 : 60);
        const exact = state.products.some(p => norm(p.name) === q) || FRESH.some(f => norm(f.name) === q);
        results.innerHTML = [
          raw && !exact ? `<li><button type="button" data-new><span class="thumb"><i class="fa-solid fa-plus"></i></span><span class="item-text"><strong>Créer « ${esc(raw)} »</strong><small>Nouveau produit sans code-barres</small></span></button></li>` : "",
          ...mine.map(p => `<li><button type="button" data-mine="${esc(p.id)}">${thumbHtml(p)}<span class="item-text"><strong>${esc(p.name)}</strong><small>Déjà dans le placard : ${esc(stockText(p))}</small></span></button></li>`),
          fresh.length && !q ? `<li class="muted" style="padding:12px 4px 4px">Fruits, légumes et produits frais</li>` : "",
          ...fresh.map((f, i) => `<li><button type="button" data-fresh="${FRESH.indexOf(f)}"><span class="thumb">${esc(f.emoji)}</span><span class="item-text"><strong>${esc(f.name)}</strong><small>${esc(f.cat)}${f.unit ? `, au ${esc(unitOf(f.unit).label.toLowerCase())}` : ""}</small></span></button></li>`)
        ].join("");
        hydrateThumbs(results);
        $("[data-new]", results)?.addEventListener("click", () => entry.close(() => openProductSheet({ prefill: { name: raw, qty: 1 } })));
        $$("[data-mine]", results).forEach(b => b.onclick = () => {
          const p = state.products.find(x => x.id === b.dataset.mine);
          entry.close(() => openProductSheet({ product: p }));
        });
        $$("[data-fresh]", results).forEach(b => b.onclick = () => {
          const f = FRESH[+b.dataset.fresh];
          const cat = categories().find(c => norm(c.name) === norm(f.cat));
          entry.close(() => openProductSheet({
            prefill: { name: f.name, emoji: f.emoji, unit: f.unit, categoryId: cat?.id || "", qty: stepOf(f) }
          }));
        });
      };
      input.addEventListener("input", draw);
      input.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); results.querySelector("button")?.click(); }
      });
      draw();
      setTimeout(() => input.focus(), 250);
    }
  });
}

/* =========================================================
   Fiche produit (création et modification)
   ========================================================= */

function categoryOptions(selected) {
  return categories().map(c => `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.icon)} ${esc(c.name)}</option>`).join("")
    + `<option value="" ${!selected ? "selected" : ""}>Sans rangement</option>`
    + `<option value="__new">+ Nouveau rangement…</option>`;
}

function guessCategoryId(name) {
  if (!name) return categories()[0]?.id || "";
  const c = categories().find(x => norm(x.name) === norm(name));
  return c?.id || categories()[0]?.id || "";
}

function stepperHtml(name, value, step, { min = 0, label = "", lg = false } = {}) {
  return `<div class="stepper ${lg ? "stepper--lg" : ""}" role="group" aria-label="${esc(label)}" data-stepper="${name}" data-step="${step}" data-min="${min}">
    <button type="button" data-step-btn="-1" aria-label="Moins">−</button>
    <input type="text" inputmode="decimal" name="${name}" value="${fmtQty(value)}" aria-label="${esc(label)}">
    <button type="button" data-step-btn="1" aria-label="Plus">+</button>
  </div>`;
}

function bindStepper(root, onChange) {
  const input = $("input", root);
  const read = () => { const v = toNum(input.value); return Number.isFinite(v) ? v : 0; };
  $$("[data-step-btn]", root).forEach(b => b.onclick = () => {
    const step = toNum(root.dataset.step) || 1;
    const min = toNum(root.dataset.min) || 0;
    const v = Math.max(min, Math.round((read() + step * +b.dataset.stepBtn) * 1000) / 1000);
    input.value = fmtQty(v);
    onChange?.(v);
  });
  input.addEventListener("input", () => onChange?.(read()));
  input.addEventListener("blur", () => { input.value = fmtQty(Math.max(0, read())); });
  return { read, set: v => { input.value = fmtQty(v); }, setStep: s => { root.dataset.step = s; } };
}

/**
 * Ouvre la fiche d'un produit.
 * product : produit existant (modification), ou prefill : valeurs de départ (création).
 */
function openProductSheet({ product = null, prefill = {}, onSaved = null } = {}) {
  const isNew = !product;
  const base = {
    name: "", brand: "", format: "", emoji: "", unit: "", categoryId: categories()[0]?.id || "",
    qty: 1, barcodes: [], alert: false, threshold: 0, restockQty: 1, listName: "", imageUrl: "", source: "",
    ...(product || {}), ...prefill
  };
  const codes = [...(base.barcodes || [])];
  const moves = []; // codes repris à un autre produit : { from, code }
  let photo; // undefined = inchangée, null = retirée, texte = nouvelle
  let imageUrl = base.imageUrl || "";
  let qtyTouched = isNew;
  let dirty = false;

  const heroThumb = () => {
    if (typeof photo === "string") return `<span class="thumb thumb--lg"><img src="${photo}" alt=""></span>`;
    const view = { ...base, imageUrl, hasPhoto: photo === null ? false : !!product?.hasPhoto };
    return thumbHtml(view, "thumb--lg");
  };

  const body = `
    <form data-form novalidate>
      <div class="product-hero">
        <button type="button" class="photo-btn" data-photo-btn aria-label="Photo du produit">
          <span data-hero>${heroThumb()}</span>
          <span class="badge-cam" aria-hidden="true"><i class="fa-solid fa-camera"></i></span>
        </button>
        <div class="product-hero-text">
          <label class="field">
            <span class="field-label">Nom</span>
            <input name="name" type="text" maxlength="120" required value="${esc(base.name)}" placeholder="Ex. Coquillettes">
          </label>
        </div>
        <input type="file" accept="image/*" data-file hidden>
      </div>

      <div class="row" style="margin-top:14px">
        <label class="field"><span class="field-label">Marque</span><input name="brand" type="text" maxlength="60" value="${esc(base.brand)}"></label>
        <label class="field"><span class="field-label">Format</span><input name="format" type="text" maxlength="30" value="${esc(base.format)}" placeholder="500 g"></label>
      </div>

      <label class="field" style="margin-top:14px">
        <span class="field-label">Rangement</span>
        <select name="categoryId">${categoryOptions(base.categoryId)}</select>
      </label>

      <div class="row" style="margin-top:14px">
        <label class="field"><span class="field-label">Compté en</span>
          <select name="unit">${UNITS.map(u => `<option value="${u.id}" ${u.id === (base.unit || "") ? "selected" : ""}>${esc(u.label)}</option>`).join("")}</select>
        </label>
        <label class="field flex-none" style="width:96px"><span class="field-label">Émoji</span>
          <input name="emoji" type="text" maxlength="4" value="${esc(base.emoji)}" placeholder="${esc(categoryOf(base.categoryId)?.icon || "📦")}" style="text-align:center;font-size:1.3rem">
        </label>
      </div>

      <div class="qty-block" style="margin-top:14px">
        <small>En stock</small>
        ${stepperHtml("qty", base.qty, stepOf(base), { label: "Quantité en stock", lg: true })}
        <small data-qty-unit>${esc(unitOf(base.unit).label)}</small>
      </div>

      <div class="switch-row" style="margin-top:14px">
        <span><strong>Alerte de stock</strong><small>L’ajouter aux courses quand il en reste peu</small></span>
        <label class="switch"><input type="checkbox" name="alert" ${base.alert ? "checked" : ""} aria-label="Alerte de stock"><span></span></label>
      </div>
      <div class="sub-panel ${base.alert ? "" : "hidden"}" data-alert-panel style="margin-top:8px">
        <div class="stepper-field">
          <span><strong>Alerter à partir de</strong><small>Stock restant (0 = quand il n’y en a plus)</small></span>
          ${stepperHtml("threshold", base.threshold, stepOf(base), { label: "Seuil d’alerte" })}
        </div>
        <div class="stepper-field">
          <span><strong>Quantité à racheter</strong><small>Proposée sur la liste de courses</small></span>
          ${stepperHtml("restockQty", base.restockQty || stepOf(base), stepOf(base), { label: "Quantité à racheter" })}
        </div>
        <label class="field">
          <span class="field-label">Nom sur la liste de courses</span>
          <input name="listName" type="text" maxlength="60" value="${esc(base.listName)}" placeholder="${esc(base.name || "Ex. Lait")}">
          <span class="field-help">Facultatif : un nom simple (« Lait ») est mieux rangé par rayon dans ListMe.</span>
        </label>
      </div>

      <fieldset class="field" style="margin-top:14px">
        <legend class="field-label">Codes-barres</legend>
        <div class="codes" data-codes></div>
        <div class="row">
          <button type="button" class="btn btn-ghost btn-small" data-scan-code><i class="fa-solid fa-barcode"></i> Scanner</button>
          <button type="button" class="btn btn-ghost btn-small" data-type-code><i class="fa-solid fa-keyboard"></i> Saisir</button>
        </div>
        <span class="field-help">Un même produit peut avoir plusieurs codes (autre marque, autre format…).</span>
      </fieldset>

      ${base.source ? `<p class="source-note" style="margin-top:12px">Informations trouvées sur ${esc(base.source)}, base ouverte et collaborative.</p>` : ""}
      ${!isNew ? `<button type="button" class="btn btn-danger-ghost btn-block" data-delete style="margin-top:18px"><i class="fa-solid fa-trash"></i> Supprimer ce produit</button>` : ""}
    </form>`;

  openSheet({
    title: isNew ? "Nouveau produit" : "Fiche produit",
    body,
    footer: `<button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
             <button type="button" class="btn btn-primary" data-save>${isNew ? "Ajouter au placard" : "Enregistrer"}</button>`,
    isDirty: () => dirty,
    onMount(el, entry) {
      const form = $("[data-form]", el);
      form.addEventListener("input", () => { dirty = true; });
      form.addEventListener("submit", e => { e.preventDefault(); save(); });
      hydrateThumbs(el);

      const qtyS = bindStepper($('[data-stepper="qty"]', el), () => { qtyTouched = true; dirty = true; });
      const thrS = bindStepper($('[data-stepper="threshold"]', el), () => { dirty = true; });
      const resS = bindStepper($('[data-stepper="restockQty"]', el), () => { dirty = true; });

      form.unit.addEventListener("change", () => {
        const u = unitOf(form.unit.value);
        [qtyS, thrS, resS].forEach(s => s.setStep(u.step));
        $("[data-qty-unit]", el).textContent = u.label;
      });
      form.alert.addEventListener("change", () => $("[data-alert-panel]", el).classList.toggle("hidden", !form.alert.checked));
      form.categoryId.addEventListener("change", async () => {
        if (form.categoryId.value !== "__new") return;
        const name = await promptDialog("Nom du nouveau rangement", { placeholder: "Ex. Cellier", confirmLabel: "Créer" });
        if (!name) { form.categoryId.value = base.categoryId || ""; return; }
        const c = { id: newId(), name, icon: "📦" };
        persist(saveCategories([...categories(), c]));
        state.household.categories = [...categories(), c];
        form.categoryId.innerHTML = categoryOptions(c.id);
        dirty = true;
      });

      const redrawHero = () => { $("[data-hero]", el).innerHTML = heroThumb(); hydrateThumbs(el); };
      const fileInput = $("[data-file]", el);
      $("[data-photo-btn]", el).onclick = async () => {
        const hasAny = typeof photo === "string" || (photo !== null && product?.hasPhoto) || imageUrl;
        if (hasAny) {
          const c = await choiceDialog("Photo du produit", [
            { label: "Prendre ou choisir une photo", value: "new", kind: "primary" },
            { label: "Retirer la photo", value: "remove", kind: "danger" }
          ]);
          if (c === "remove") { photo = null; imageUrl = ""; dirty = true; redrawHero(); }
          if (c !== "new") return;
        }
        fileInput.click();
      };
      fileInput.onchange = async () => {
        const f = fileInput.files?.[0];
        fileInput.value = "";
        if (!f) return;
        try {
          photo = await compressImage(f);
          dirty = true;
          redrawHero();
        } catch {
          toast("Cette image n’a pas pu être lue.", { error: true });
        }
      };

      const drawCodes = () => {
        $("[data-codes]", el).innerHTML = codes.length
          ? codes.map(c => `<span class="code-chip">${esc(c)}<button type="button" data-rm="${esc(c)}" aria-label="Retirer le code ${esc(c)}"><i class="fa-solid fa-xmark"></i></button></span>`).join("")
          : `<span class="muted">Aucun code-barres</span>`;
        $$("[data-rm]", el).forEach(b => b.onclick = () => {
          codes.splice(codes.indexOf(b.dataset.rm), 1);
          dirty = true;
          drawCodes();
        });
      };
      drawCodes();

      const addCode = async code => {
        if (!code || codes.includes(code)) return;
        if (!isValidCode(code)) { toast("Ce code-barres n’est pas valide.", { error: true }); return; }
        const other = findByCode(code);
        if (other && other.id !== product?.id) {
          const ok = await confirmDialog(`Ce code est déjà associé à « ${other.name} ».`, {
            confirmLabel: "Le déplacer ici", detail: "Il sera retiré de l’autre produit à l’enregistrement."
          });
          if (!ok) return;
          moves.push({ from: other, code });
        }
        codes.push(code);
        dirty = true;
        drawCodes();
      };
      $("[data-type-code]", el).onclick = async () => {
        const v = await promptDialog("Code-barres", { placeholder: "3017620422003", confirmLabel: "Ajouter", maxLength: 32 });
        if (v) addCode(v.replace(/\s+/g, ""));
      };
      $("[data-scan-code]", el).onclick = () => {
        openScanner({
          title: "Ajouter un code-barres",
          onCode: async (code, sc) => { await sc.closeNow(); addCode(code); }
        });
      };

      $("[data-delete]", el)?.addEventListener("click", async () => {
        const ok = await confirmDialog(`Supprimer « ${product.name} » ?`, {
          confirmLabel: "Supprimer", danger: true, detail: "Le produit disparaît du placard pour tout le foyer."
        });
        if (!ok) return;
        persist(deleteProduct(product));
        entry.close(() => toast("Produit supprimé"));
      });

      $("[data-cancel]", el).onclick = () => history.back();
      $("[data-save]", el).onclick = save;

      function save() {
        const name = form.name.value.trim();
        if (!name) { form.name.focus(); toast("Donne un nom au produit.", { error: true }); return; }
        const data = {
          name,
          brand: form.brand.value.trim(),
          format: form.format.value.trim(),
          emoji: form.emoji.value.trim(),
          unit: form.unit.value,
          categoryId: form.categoryId.value === "__new" ? "" : form.categoryId.value,
          barcodes: codes,
          alert: form.alert.checked,
          threshold: thrS.read(),
          restockQty: resS.read() || stepOf({ unit: form.unit.value }),
          listName: form.listName.value.trim(),
          imageUrl
        };
        if (isNew) data.source = base.source || "";
        if (qtyTouched) data.qty = qtyS.read();
        moves.forEach(m => persist(removeBarcode(m.from, m.code)));
        let id = product?.id;
        if (isNew) {
          const res = createProduct(data, typeof photo === "string" ? photo : undefined);
          id = res.id;
          persist(res.done);
        } else {
          persist(updateProduct(product, data, photo));
        }
        entry.close(() => {
          toast(isNew ? `${name} ajouté au placard` : "Modifications enregistrées");
          onSaved?.(id);
        });
      }
    }
  });
}

/* =========================================================
   Scanner : entrée et sortie de stock
   ========================================================= */

const SCAN_MODES = [
  { id: "ask", label: "Choisir" },
  { id: "in", label: "+ Entrée" },
  { id: "out", label: "− Sortie" }
];

function openMainScanner() {
  let mode = localStorage.getItem("fdp:scanMode") || "ask";
  if (!SCAN_MODES.some(m => m.id === mode)) mode = "ask";
  const hints = {
    ask: "Scanne un produit pour l’ajouter ou le sortir",
    in: "Chaque scan ajoute au stock (retour de courses)",
    out: "Chaque scan sort du stock (produit consommé)"
  };

  const sc = openScanner({
    title: "Scanner",
    hint: hints[mode],
    modes: SCAN_MODES,
    mode,
    onModeChange: m => {
      mode = m;
      localStorage.setItem("fdp:scanMode", m);
      sc.setHint(hints[m]);
    },
    onCode: (code, ctrl) => handleScannedCode(code, ctrl, () => mode)
  });
}

function flash(ctrl, p, applied, { out = false } = {}) {
  const low = isLow(p);
  const label = applied
    ? `${p.name} : ${applied > 0 ? "+" : "−"}${fmtQty(Math.abs(applied))}, il en reste ${stockText(p)}`
    : `${p.name} : déjà à 0`;
  ctrl.setPanel(`
    <div class="scan-flash ${out ? "is-out" : ""}">
      ${thumbHtml(p)}
      <span>${esc(label)}${low && applied ? `<br><span class="tag">À racheter</span>` : ""}</span>
      ${applied ? `<button type="button" class="btn btn-ghost btn-small" data-undo>Annuler</button>` : ""}
    </div>`);
  hydrateThumbs(ctrl.panel);
  $("[data-undo]", ctrl.panel)?.addEventListener("click", () => {
    const { done } = changeQty(p, -applied);
    persist(done);
    ctrl.setPanel(`<div class="scan-flash"><span>Annulé : il en reste ${esc(stockText(p))}</span></div>`);
  });
}

async function handleScannedCode(code, ctrl, getMode) {
  const mode = getMode();
  const p = findByCode(code);

  if (p) {
    if (mode === "in" || mode === "out") {
      const { applied, done } = changeQty(p, (mode === "in" ? 1 : -1) * stepOf(p));
      persist(done);
      flash(ctrl, p, applied, { out: mode === "out" });
      setTimeout(() => ctrl.resume(), 700);
      return;
    }
    showKnownProduct(p, ctrl);
    return;
  }

  ctrl.setPanel(`<div class="scan-result"><span class="thumb"><i class="fa-solid fa-spinner fa-spin"></i></span><span class="item-text"><strong>Recherche du produit…</strong><small>${esc(code)}</small></span></div>`);
  const info = await lookupBarcode(code);
  const offline = info?.offline;
  const found = info && !offline ? info : null;
  const startQty = mode === "out" ? 0 : 1;

  ctrl.setPanel(`
    <div class="scan-result">
      ${found ? thumbHtml({ imageUrl: found.imageUrl, emoji: "📦" }) : `<span class="thumb">❔</span>`}
      <span class="item-text">
        <strong>${found ? esc(found.name) : "Produit inconnu"}</strong>
        <small>${found ? esc([found.brand, found.quantity].filter(Boolean).join(", ") || found.source) : offline ? "Pas de réseau pour le chercher" : "Absent des bases publiques"} (${esc(code)})</small>
      </span>
    </div>
    <p class="muted">Ce code n’est pas encore dans ton placard.</p>
    <button type="button" class="btn btn-primary btn-block" data-create><i class="fa-solid fa-plus"></i> ${found ? "Ajouter ce produit" : "Créer le produit"}</button>
    ${state.products.length ? `<button type="button" class="btn btn-ghost btn-block" data-link><i class="fa-solid fa-link"></i> C’est un produit déjà dans le placard</button>` : ""}
    <button type="button" class="link-btn" data-skip>Scanner autre chose</button>`);
  hydrateThumbs(ctrl.panel);

  $("[data-skip]", ctrl.panel).onclick = () => { ctrl.setPanel(""); ctrl.resume(); };
  $("[data-create]", ctrl.panel).onclick = async () => {
    await ctrl.closeNow();
    openProductSheet({
      prefill: {
        name: found?.name || "",
        brand: found?.brand || "",
        format: found?.quantity || "",
        imageUrl: found?.imageUrl || "",
        source: found?.source || "",
        categoryId: guessCategoryId(found?.categoryHint),
        barcodes: [code],
        qty: startQty
      },
      onSaved: () => toast("Produit ajouté", { action: { label: "Scanner le suivant", onClick: openMainScanner } })
    });
  };
  $("[data-link]", ctrl.panel)?.addEventListener("click", async () => {
    await ctrl.closeNow();
    pickProduct({
      title: "Associer le code à…",
      hint: found ? `Code ${code} (${found.name})` : `Code ${code}`,
      onPick: target => {
        persist(addBarcode(target, code));
        if (found?.imageUrl && !target.imageUrl && !target.hasPhoto) persist(updateProduct(target, { imageUrl: found.imageUrl }));
        if (mode === "in" || mode === "out") {
          const { applied, done } = changeQty(target, (mode === "in" ? 1 : -1) * stepOf(target));
          persist(done);
          toast(`Code associé à ${target.name}${applied ? `, stock : ${stockText(target)}` : ""}`, { action: { label: "Scanner", onClick: openMainScanner } });
        } else {
          toast(`Code associé à ${target.name}`, { action: { label: "Scanner", onClick: openMainScanner } });
        }
      }
    });
  });
}

function showKnownProduct(p, ctrl) {
  const step = stepOf(p);
  ctrl.setPanel(`
    <div class="scan-result">
      ${thumbHtml(p)}
      <span class="item-text">
        <strong>${esc(p.name)}</strong>
        <small>En stock : ${esc(stockText(p))}${categoryOf(p.categoryId) ? `, ${esc(categoryOf(p.categoryId).name)}` : ""}</small>
      </span>
      <button type="button" class="icon-btn" data-open aria-label="Ouvrir la fiche"><i class="fa-solid fa-pen"></i></button>
    </div>
    <div class="scan-actions">
      <button type="button" class="btn btn-label" data-out ${p.qty <= 0 ? "disabled" : ""}><i class="fa-solid fa-minus"></i> Sortir</button>
      ${stepperHtml("amount", step, step, { label: "Quantité", min: step })}
      <button type="button" class="btn btn-primary" data-in><i class="fa-solid fa-plus"></i> Ajouter</button>
    </div>
    <button type="button" class="link-btn" data-skip>Scanner autre chose</button>`);
  hydrateThumbs(ctrl.panel);
  const amount = bindStepper($('[data-stepper="amount"]', ctrl.panel));
  const apply = sign => {
    const { applied, done } = changeQty(p, sign * Math.max(step, amount.read()));
    persist(done);
    flash(ctrl, p, applied, { out: sign < 0 });
    ctrl.forgetLast();
    setTimeout(() => ctrl.resume(), 600);
  };
  $("[data-in]", ctrl.panel).onclick = () => apply(1);
  $("[data-out]", ctrl.panel).onclick = () => apply(-1);
  $("[data-skip]", ctrl.panel).onclick = () => { ctrl.setPanel(""); ctrl.resume(); };
  $("[data-open]", ctrl.panel).onclick = async () => { await ctrl.closeNow(); openProductSheet({ product: p }); };
}

// Liste de choix d'un produit existant (associer un code-barres, etc.)
function pickProduct({ title, hint = "", filter = null, onPick }) {
  openSheet({
    title,
    body: `
      ${hint ? `<p class="muted">${esc(hint)}</p>` : ""}
      <label class="search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Rechercher</span>
        <input type="search" data-q placeholder="Rechercher" autocomplete="off"></label>
      <ul class="pick-list" data-list></ul>`,
    onMount(el, entry) {
      const draw = () => {
        const q = norm($("[data-q]", el).value);
        const items = state.products.filter(p => (!filter || filter(p)) && (!q || norm(`${p.name} ${p.brand}`).includes(q))).sort(byName).slice(0, 80);
        $("[data-list]", el).innerHTML = items.map(p => `<li><button type="button" data-id="${esc(p.id)}">${thumbHtml(p)}<span class="item-text"><strong>${esc(p.name)}</strong><small>${esc(subLine(p) || categoryOf(p.categoryId)?.name || "")}</small></span></button></li>`).join("")
          || `<li class="muted" style="padding:12px 4px">Aucun produit</li>`;
        hydrateThumbs(el);
        $$("[data-id]", el).forEach(b => b.onclick = () => {
          const p = state.products.find(x => x.id === b.dataset.id);
          entry.close(() => onPick(p));
        });
      };
      $("[data-q]", el).addEventListener("input", draw);
      draw();
    }
  });
}

/* =========================================================
   Vue : courses (alertes de stock → ListMe)
   ========================================================= */

const buyQty = new Map();   // quantité à acheter modifiée à la main
const checkState = new Map(); // case cochée modifiée à la main (sinon : cochée si pas encore envoyée)

function renderCourses() {
  setHeader({ title: "Courses", kicker: kicker() });
  setFab(null);
  const view = $("#view");

  const update = () => {
    const low = lowProducts().sort((a, b) => (!!a.sentAt - !!b.sentAt) || byName(a, b));
    const alerts = state.products.filter(p => p.alert).length;
    const link = state.household.listmeLink || "";

    if (!low.length) {
      view.innerHTML = `
        <h2 class="display">Rien à racheter</h2>
        <p class="lead">${alerts
          ? `${alerts} produit${alerts > 1 ? "s ont" : " a"} une alerte de stock. Ils apparaîtront ici dès que leur stock descendra au seuil choisi.`
          : "Active l’alerte de stock dans la fiche d’un produit : il apparaîtra ici quand il n’en restera plus (ou presque)."}</p>
        ${listmeBlock(link)}`;
      bindListme(view);
      return;
    }

    const isChecked = p => (checkState.has(p.id) ? checkState.get(p.id) : !p.sentAt);
    const buyOf = p => (buyQty.has(p.id) ? buyQty.get(p.id) : (p.restockQty || stepOf(p)));
    view.innerHTML = `
      <div class="shop-summary">
        <strong>${low.length}</strong>
        <span>produit${low.length > 1 ? "s" : ""} sous le seuil d’alerte${low.some(p => p.sentAt) ? `, dont ${low.filter(p => p.sentAt).length} déjà sur la liste` : ""}</span>
      </div>
      <ul class="items items--shop" style="margin-top:12px">
        ${low.map(p => {
          const q = buyOf(p);
          return `
          <li class="item" data-id="${esc(p.id)}">
            <label class="check"><input type="checkbox" data-check ${isChecked(p) ? "checked" : ""} aria-label="Ajouter ${esc(p.listName || p.name)} à la liste"><span><i class="fa-solid fa-check"></i></span></label>
            <button type="button" class="item-open" data-open>
              ${thumbHtml(p)}
              <span class="item-text">
                <strong>${esc(p.listName || p.name)}</strong>
                <small>Reste ${esc(stockText(p))}, alerte à ${esc(qtyLabel(p.threshold, p.unit))}</small>
                ${p.sentAt ? `<span class="tag tag--sent">Envoyé le ${esc(fmtDate(p.sentAt) || "…")}</span>` : ""}
              </span>
            </button>
            ${stepperHtml(`buy-${p.id}`, q, stepOf(p), { label: `Quantité à acheter de ${p.name}`, min: 0 })}
          </li>`;
        }).join("")}
      </ul>
      <div class="shop-actions">
        <button type="button" class="btn btn-primary btn-block" data-send><i class="fa-solid fa-paper-plane"></i> <span data-send-label></span></button>
        <button type="button" class="btn btn-ghost btn-block" data-copy><i class="fa-regular fa-copy"></i> Copier la liste</button>
        ${low.some(p => p.sentAt) ? `<button type="button" class="link-btn" data-reset-sent>Tout remettre « à envoyer »</button>` : ""}
      </div>
      ${listmeBlock(link)}`;

    hydrateThumbs(view);
    bindListme(view);

    const selected = () => low.filter(p => $(`[data-id="${CSS.escape(p.id)}"] [data-check]`, view)?.checked);
    const qtyFor = p => {
      const v = buyOf(p);
      const u = unitOf(p.unit);
      return u.short && !["boîte", "bout.", "pot", "sachet", "paquet", "botte", "rouleau"].includes(u.short) ? `${fmtQty(v)} ${u.short}` : fmtQty(v);
    };
    const refreshLabel = () => {
      const n = selected().filter(p => buyOf(p) > 0).length;
      $("[data-send-label]", view).textContent = n ? `Envoyer ${n} produit${n > 1 ? "s" : ""} vers ListMe` : "Rien de coché";
      $("[data-send]", view).disabled = !n;
    };

    $$(".item", view).forEach(li => {
      const p = low.find(x => x.id === li.dataset.id);
      $("[data-open]", li).onclick = () => openProductSheet({ product: p });
      $("[data-check]", li).onchange = e => { checkState.set(p.id, e.target.checked); refreshLabel(); };
      bindStepper($("[data-stepper]", li), v => { buyQty.set(p.id, v); refreshLabel(); });
    });
    refreshLabel();

    $("[data-send]", view).onclick = () => {
      const items = selected().filter(p => buyOf(p) > 0);
      if (!items.length) return;
      const listLink = parseListMeLink(link);
      const url = buildListMeUrl({ items: items.map(p => ({ name: p.listName || p.name, qty: qtyFor(p) })), listLink });
      const win = window.open(url, "_blank", "noopener");
      if (!win) location.href = url;
      persist(markSent(items.map(p => p.id)));
      items.forEach(p => { checkState.delete(p.id); buyQty.delete(p.id); });
      toast(`${items.length} produit${items.length > 1 ? "s envoyés" : " envoyé"} vers ListMe`);
    };
    $("[data-copy]", view).onclick = async () => {
      const text = selected().map(p => `- ${p.listName || p.name} : ${qtyFor(p)}`).join("\n");
      try {
        await navigator.clipboard.writeText(text);
        toast("Liste copiée");
      } catch {
        toast("Copie impossible sur cet appareil.", { error: true });
      }
    };
    $("[data-reset-sent]", view)?.addEventListener("click", () => {
      low.forEach(p => checkState.delete(p.id));
      persist(clearSent(low.filter(p => p.sentAt).map(p => p.id)));
    });
  };

  update();
  return update;
}

function listmeBlock(link) {
  const ok = link && !parseListMeLink(link)?.error;
  return `
    <section class="block">
      <h3 class="block-title">Liste ListMe du foyer</h3>
      <div class="card">
        <p class="muted">${ok
          ? "Les produits sont ajoutés à votre liste ListMe partagée. ListMe s’ouvre dans un nouvel onglet pour confirmer."
          : "Aucune liste reliée : chaque envoi crée une nouvelle liste « Fond de placard » dans ListMe. Colle le lien du bouton « Partager » de ListMe pour toujours remplir la même."}</p>
        <div class="row">
          <button type="button" class="btn btn-ghost btn-small" data-listme-edit><i class="fa-solid fa-link"></i> ${ok ? "Changer de liste" : "Relier une liste"}</button>
          ${ok ? `<a class="btn btn-ghost btn-small" href="${esc(link)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Ouvrir</a>` : `<a class="btn btn-ghost btn-small" href="${esc(LISTME_URL)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> ListMe</a>`}
        </div>
        ${ok ? `<button type="button" class="link-btn" data-listme-clear style="align-self:flex-start;padding:0">Délier la liste</button>` : ""}
      </div>
    </section>`;
}

function bindListme(root) {
  $("[data-listme-edit]", root)?.addEventListener("click", async () => {
    const v = await promptDialog("Lien de partage de la liste ListMe", {
      value: state.household.listmeLink || "", placeholder: "https://…/ListMe/?list=…", type: "url", maxLength: 300, confirmLabel: "Relier"
    });
    if (v === null) return;
    const parsed = parseListMeLink(v);
    if (parsed?.error) { toast(parsed.error, { error: true }); return; }
    persist(setListmeLink(v.trim()), "Liste ListMe reliée");
  });
  $("[data-listme-clear]", root)?.addEventListener("click", () => persist(setListmeLink(""), "Liste déliée"));
}

/* =========================================================
   Vue : foyer (membres, invitations, rangements, compte)
   ========================================================= */

let receivedInvites = null;

function loadInvites() {
  if (receivedInvites !== null) return;
  receivedInvites = [];
  findInvites().then(list => {
    receivedInvites = list;
    updateAvatar();
    if (current.route === "compte") current.update?.();
  });
}

/* ---------- Avatar de l'en-tête (photo Google, ou initiale) ---------- */

function initialsOf(name, email) {
  const src = (name || "").trim() || (email || "").split("@")[0];
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
  return (s || "?").toUpperCase();
}

// Couleur stable par personne, prise dans la palette de l'appli.
function avatarHue(seed) {
  let h = 0;
  for (const c of String(seed || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ["#1E6B52", "#3C5A99", "#8A4F7D", "#B5562B", "#4B6B2A", "#2F7C86"][h % 6];
}

function avatarHtml({ name, email, photo, seed, cls = "" }) {
  const bg = avatarHue(seed || email);
  return `<span class="avatar ${cls}" style="--av:${bg}" aria-hidden="true">
    <span class="avatar-initials">${esc(initialsOf(name, email))}</span>
    ${photo ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer">` : ""}
  </span>`;
}

function hydrateAvatars(root) {
  $$(".avatar img", root).forEach(img => {
    const ok = () => img.parentElement.classList.add("has-photo");
    if (img.complete && img.naturalWidth) ok();
    else {
      img.addEventListener("load", ok, { once: true });
      img.addEventListener("error", () => img.remove(), { once: true });
    }
  });
}

function updateAvatar() {
  const btn = $("#btn-account");
  const u = state.user;
  if (!u) { btn.innerHTML = ""; return; }
  btn.innerHTML = avatarHtml({ name: myName(), email: u.email, photo: u.photoURL, seed: u.uid })
    + (receivedInvites?.length ? `<b class="avatar-dot" aria-hidden="true"></b>` : "");
  btn.setAttribute("aria-label", receivedInvites?.length ? "Mon compte et mon foyer (invitation reçue)" : "Mon compte et mon foyer");
  hydrateAvatars(btn);
}

/* =========================================================
   Vue : mon compte et mon foyer (bouton avatar de l'en-tête)
   ========================================================= */

function providerLabel(u) {
  const ids = (u.providerData || []).map(p => p.providerId);
  if (ids.includes("google.com")) return "Connecté avec Google";
  return "Connecté par e-mail";
}

function renderAccount() {
  setHeader({ title: "Mon compte", kicker: kicker(), back: true });
  setFab(null);
  const view = $("#view");
  loadInvites();

  const update = () => {
    const h = state.household;
    const owner = isOwner();
    const members = (h.memberUids || []).map(u => ({ uid: u, ...(h.members?.[u] || {}) }));
    const user = state.user;
    const isGoogle = (user.providerData || []).some(p => p.providerId === "google.com");

    view.innerHTML = `
      <section class="me">
        ${avatarHtml({ name: myName(), email: user.email, photo: user.photoURL, seed: user.uid, cls: "avatar--xl" })}
        <div class="me-text">
          <h2>${esc(myName())}</h2>
          <span class="muted">${esc(user.email || "")}</span>
          <span class="me-provider"><i class="${isGoogle ? "fa-brands fa-google" : "fa-regular fa-envelope"}" aria-hidden="true"></i> ${esc(providerLabel(user))}</span>
        </div>
      </section>
      <div class="me-actions">
        ${isGoogle ? "" : `<button type="button" class="btn btn-ghost btn-small" data-edit-name><i class="fa-solid fa-pen"></i> Modifier mon prénom</button>`}
        <button type="button" class="btn btn-ghost btn-small" data-logout><i class="fa-solid fa-right-from-bracket"></i> Se déconnecter</button>
      </div>
      ${user.emailVerified ? "" : `
      <div class="notice">
        <p><strong>Adresse e-mail à confirmer.</strong> Clique sur le lien reçu par e-mail : c’est nécessaire pour rejoindre un foyer qui t’invite.</p>
        <div class="row">
          <button type="button" class="btn btn-ghost btn-small" data-verify>Renvoyer l’e-mail</button>
          <button type="button" class="btn btn-ghost btn-small" data-verified>C’est fait</button>
        </div>
      </div>`}

      ${receivedInvites.length ? `
      <section class="block">
        <h3 class="block-title">Invitations reçues</h3>
        <ul class="rows">${receivedInvites.map(inv => `
          <li><span class="rows-icon">🏠</span>
            <span class="rows-text"><strong>${esc(inv.name)}</strong><small>${esc(Object.values(inv.members || {}).map(m => m.name || m.email).join(", "))}</small></span>
            <button type="button" class="btn btn-primary btn-small" data-join="${esc(inv.id)}">Rejoindre</button>
          </li>`).join("")}</ul>
      </section>` : ""}

      <section class="block">
        <div class="block-head">
          <h3 class="block-title">Mon foyer</h3>
        </div>
        <div class="household-name">
          <h2>${esc(h.name)}</h2>
          <button type="button" class="icon-btn" data-rename aria-label="Renommer le foyer"><i class="fa-solid fa-pen"></i></button>
        </div>
        <p class="muted" style="margin-top:4px">${state.products.length} produit${state.products.length > 1 ? "s" : ""}, ${categories().length} rangement${categories().length > 1 ? "s" : ""}${h.lastInventoryAt ? `. Dernier grand inventaire le ${esc(fmtDate(h.lastInventoryAt))}${h.lastInventoryBy ? ` par ${esc(h.lastInventoryBy)}` : ""}` : ""}.</p>
      </section>

      <section class="block">
        <h3 class="block-title">Membres</h3>
        <ul class="rows">
          ${members.map(m => `
          <li>
            ${avatarHtml({ name: m.name, email: m.email, photo: m.uid === uid() ? user.photoURL : "", seed: m.uid })}
            <span class="rows-text"><strong>${esc(m.name || m.email || "Membre")}${m.uid === uid() ? " (toi)" : ""}</strong><small>${esc(m.email || "")}</small></span>
            ${m.uid === h.ownerUid ? `<span class="pill">Créateur</span>` : ""}
            ${owner && m.uid !== uid() ? `<button type="button" class="icon-btn icon-btn--danger" data-remove="${esc(m.uid)}" aria-label="Retirer ${esc(m.name || m.email)}"><i class="fa-solid fa-user-minus"></i></button>` : ""}
          </li>`).join("")}
          ${(h.invitedEmails || []).map(e => `
          <li>
            <span class="rows-icon" aria-hidden="true"><i class="fa-regular fa-envelope"></i></span>
            <span class="rows-text"><strong>${esc(e)}</strong><small>Invitation en attente</small></span>
            <button type="button" class="icon-btn" data-cancel-invite="${esc(e)}" aria-label="Annuler l’invitation de ${esc(e)}"><i class="fa-solid fa-xmark"></i></button>
          </li>`).join("")}
          <li class="add-row"><button type="button" data-invite><i class="fa-solid fa-user-plus"></i> Inviter quelqu’un du foyer</button></li>
        </ul>
      </section>

      <section class="block">
        <h3 class="block-title">Rangements</h3>
        <a class="rows-link" href="#/rangements">
          <span class="rows-icon" aria-hidden="true">${esc(categories().slice(0, 1).map(c => c.icon).join("") || "📦")}</span>
          <span class="rows-text"><strong>${esc(categories().map(c => c.name).join(", ") || "Aucun rangement")}</strong><small>Ajouter, renommer, réordonner</small></span>
          <i class="fa-solid fa-chevron-right muted" aria-hidden="true"></i>
        </a>
      </section>

      ${listmeBlock(h.listmeLink || "")}

      ${members.length > 1 ? `
      <section class="block">
        <button type="button" class="btn btn-danger-ghost btn-block" data-leave><i class="fa-solid fa-door-open"></i> Quitter « ${esc(h.name)} »</button>
      </section>` : ""}`;

    hydrateAvatars(view);

    $("[data-rename]", view).onclick = async () => {
      const v = await promptDialog("Nom du foyer", { value: h.name, maxLength: 60, confirmLabel: "Renommer" });
      if (v && v !== h.name) persist(renameHousehold(v), "Foyer renommé");
    };
    $("[data-edit-name]", view)?.addEventListener("click", async () => {
      const v = await promptDialog("Ton prénom", { value: myName(), maxLength: 40, confirmLabel: "Enregistrer" });
      if (!v || v === myName()) return;
      try {
        await updateProfile(state.user, { displayName: v });
        memberInfoChecked = false;
        updateMyMemberInfo();
        updateAvatar();
        update();
        toast("Prénom modifié");
      } catch { toast("Modification impossible pour le moment.", { error: true }); }
    });
    $("[data-invite]", view).onclick = inviteFlow;
    $$("[data-cancel-invite]", view).forEach(b => b.onclick = () => persist(cancelInvite(b.dataset.cancelInvite), "Invitation annulée"));
    $$("[data-remove]", view).forEach(b => b.onclick = async () => {
      const m = members.find(x => x.uid === b.dataset.remove);
      const ok = await confirmDialog(`Retirer ${m.name || m.email} du foyer ?`, { confirmLabel: "Retirer", danger: true, detail: "Cette personne n’aura plus accès au placard." });
      if (ok) persist(removeMember(m.uid), "Membre retiré");
    });
    $$("[data-join]", view).forEach(b => b.onclick = () => joinFlow(receivedInvites.find(i => i.id === b.dataset.join)));

    bindListme(view);

    $("[data-verify]", view)?.addEventListener("click", async () => {
      try { await sendEmailVerification(state.user); toast("E-mail de confirmation envoyé"); }
      catch { toast("Envoi impossible pour le moment, réessaie plus tard.", { error: true }); }
    });
    $("[data-verified]", view)?.addEventListener("click", async () => {
      await state.user.reload();
      await state.user.getIdToken(true);
      state.user = auth.currentUser;
      if (state.user.emailVerified) {
        toast("Adresse confirmée");
        receivedInvites = null;
        render();
      } else {
        toast("Pas encore confirmée : clique sur le lien reçu par e-mail.", { error: true });
      }
    });
    $("[data-logout]", view).onclick = logoutFlow;
    $("[data-leave]", view)?.addEventListener("click", async () => {
      const ok = await confirmDialog(`Quitter « ${h.name} » ?`, {
        confirmLabel: "Quitter", danger: true,
        detail: "Le placard reste aux autres membres. Tu repars avec un placard vide."
      });
      if (!ok) return;
      try {
        renderLoading();
        const hid = await leaveHousehold();
        receivedInvites = null;
        watch(hid);
        location.hash = "#/";
        toast("Tu as quitté le foyer");
      } catch (err) {
        console.error(err);
        toast("Impossible de quitter le foyer (réseau ?).", { error: true });
        render();
      }
    });
  };

  update();
  return update;
}

async function logoutFlow() {
  const ok = await confirmDialog("Se déconnecter ?", {
    confirmLabel: "Se déconnecter",
    detail: "Le placard reste enregistré : tu le retrouveras en te reconnectant."
  });
  if (!ok) return;
  location.hash = "#/";
  signOut(auth);
}

/* =========================================================
   Vue : rangements (vue d'ensemble et réglage)
   ========================================================= */

function renderRangements() {
  setHeader({ title: "Rangements", kicker: kicker() });
  setFab(null);
  const view = $("#view");

  const update = () => {
    const cats = categories();
    const stats = {};
    state.products.forEach(p => {
      const k = categoryOf(p.categoryId) ? p.categoryId : "";
      stats[k] = stats[k] || { n: 0, low: 0, empty: 0 };
      stats[k].n++;
      if (isLow(p)) stats[k].low++;
      if (p.qty <= 0) stats[k].empty++;
    });
    const line = s => {
      if (!s?.n) return "Vide";
      const bits = [`${s.n} produit${s.n > 1 ? "s" : ""}`];
      if (s.low) bits.push(`${s.low} à racheter`);
      return bits.join(", ");
    };

    view.innerHTML = `
      <p class="lead" style="margin-top:0">Un appui ouvre le rangement. Le crayon le renomme ou change son icône, les flèches changent l’ordre d’affichage dans les placards.</p>
      <ul class="rows" style="margin-top:16px">
        ${cats.map((c, i) => `
        <li>
          <a class="rows-open" href="#/" data-goto="${esc(c.id)}">
            <span class="rows-icon" aria-hidden="true">${esc(c.icon)}</span>
            <span class="rows-text"><strong>${esc(c.name)}</strong><small>${esc(line(stats[c.id]))}</small></span>
          </a>
          ${stats[c.id]?.low ? `<span class="tag" style="margin:0">${stats[c.id].low}</span>` : ""}
          <button type="button" class="icon-btn" data-cat-edit="${esc(c.id)}" aria-label="Modifier ${esc(c.name)}"><i class="fa-solid fa-pen"></i></button>
          <span class="reorder">
            <button type="button" class="icon-btn" data-cat-up="${i}" aria-label="Monter ${esc(c.name)}" ${i === 0 ? "disabled" : ""}><i class="fa-solid fa-chevron-up"></i></button>
            <button type="button" class="icon-btn" data-cat-down="${i}" aria-label="Descendre ${esc(c.name)}" ${i === cats.length - 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-down"></i></button>
          </span>
        </li>`).join("")}
        ${stats[""]?.n ? `
        <li>
          <a class="rows-open" href="#/" data-goto="">
            <span class="rows-icon" aria-hidden="true">📦</span>
            <span class="rows-text"><strong>Sans rangement</strong><small>${esc(line(stats[""]))}</small></span>
          </a>
        </li>` : ""}
        <li class="add-row"><button type="button" data-cat-add><i class="fa-solid fa-plus"></i> Ajouter un rangement</button></li>
      </ul>`;

    $$("[data-goto]", view).forEach(a => a.addEventListener("click", () => {
      homeFilter.cat = a.dataset.goto || "all";
      homeFilter.q = "";
      sessionStorage.setItem("fdp:cat", homeFilter.cat);
    }));
    $$("[data-cat-edit]", view).forEach(b => b.onclick = () => openCategorySheet(cats.find(c => c.id === b.dataset.catEdit)));
    $("[data-cat-add]", view).onclick = () => openCategorySheet(null);
    const move = (i, d) => {
      const list = cats.slice();
      [list[i], list[i + d]] = [list[i + d], list[i]];
      state.household.categories = list;
      persist(saveCategories(list));
      update();
    };
    $$("[data-cat-up]", view).forEach(b => b.onclick = () => move(+b.dataset.catUp, -1));
    $$("[data-cat-down]", view).forEach(b => b.onclick = () => move(+b.dataset.catDown, 1));
  };

  update();
  return update;
}

async function inviteFlow() {
  const v = await promptDialog("Adresse e-mail de la personne à inviter", { type: "email", placeholder: "prenom@exemple.fr", confirmLabel: "Inviter", maxLength: 120 });
  if (!v) return;
  const email = v.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("Adresse e-mail invalide.", { error: true }); return; }
  if (Object.values(state.household.members || {}).some(m => m.email === email)) { toast("Cette personne fait déjà partie du foyer."); return; }
  persist(inviteEmail(email));
  const appUrl = `${location.origin}${location.pathname}`;
  const c = await choiceDialog(`${email} est invité·e.`, [
    { label: "Copier le lien de l’appli", value: "copy", kind: "primary" }
  ], { cancelLabel: "Fermer", detail: "Il lui suffit d’ouvrir Fond de placard et de se connecter avec cette adresse (Google, ou e-mail confirmé). L’invitation apparaît alors à la connexion, et dans « Mon compte » (sa photo ou ses initiales, en haut à droite)." });
  if (c === "copy") {
    try { await navigator.clipboard.writeText(appUrl); toast("Lien copié"); } catch { toast(appUrl); }
  }
}

async function joinFlow(inv) {
  if (!inv) return;
  const alone = (state.household?.memberUids || []).length <= 1;
  const n = state.products.length;
  let copy = false;
  if (n) {
    const c = await choiceDialog(`Rejoindre « ${inv.name} » ?`, [
      { label: `Rejoindre et y copier mes ${n} produits`, value: "copy", kind: "primary" },
      { label: "Rejoindre sans mes produits", value: "nocopy", kind: alone ? "danger" : "ghost" }
    ], { detail: alone ? "Ton placard actuel sera ensuite supprimé." : "Tu quitteras ton foyer actuel, qui reste aux autres membres." });
    if (!c) return;
    copy = c === "copy";
  } else {
    const ok = await confirmDialog(`Rejoindre « ${inv.name} » ?`, { confirmLabel: "Rejoindre" });
    if (!ok) return;
  }
  try {
    renderLoading();
    const hid = await joinHousehold(inv, { copy });
    receivedInvites = null;
    watch(hid);
    location.hash = "#/";
    toast(`Bienvenue dans ${inv.name}`);
  } catch (err) {
    console.error(err);
    toast("Impossible de rejoindre ce foyer (invitation annulée, ou e-mail non confirmé ?).", { error: true });
    boot(state.user);
  }
}

/* ---------- Éditeur de rangement ---------- */

function openCategorySheet(cat) {
  const isNew = !cat;
  const icon0 = cat?.icon || "📦";
  const icons = CATEGORY_ICONS.includes(icon0) ? CATEGORY_ICONS : [icon0, ...CATEGORY_ICONS];
  const count = cat ? state.products.filter(p => p.categoryId === cat.id).length : 0;

  openSheet({
    title: isNew ? "Nouveau rangement" : "Rangement",
    body: `
      <label class="field"><span class="field-label">Nom</span>
        <input name="name" type="text" maxlength="40" value="${esc(cat?.name || "")}" placeholder="Ex. Cellier, Garage, Armoire à pharmacie"></label>
      <fieldset class="field"><legend class="field-label">Icône</legend>
        <div class="emoji-grid">${icons.map(i => `<label><input type="radio" name="icon" value="${esc(i)}" ${i === icon0 ? "checked" : ""}><span>${esc(i)}</span></label>`).join("")}</div>
      </fieldset>
      <label class="field"><span class="field-label">Ou un autre émoji</span><input name="custom" type="text" maxlength="4" placeholder="🥡"></label>
      ${!isNew ? `<button type="button" class="btn btn-danger-ghost btn-block" data-del><i class="fa-solid fa-trash"></i> Supprimer ce rangement</button>` : ""}`,
    footer: `<button type="button" class="btn btn-ghost" data-cancel>Annuler</button><button type="button" class="btn btn-primary" data-save>${isNew ? "Ajouter" : "Enregistrer"}</button>`,
    onMount(el, entry) {
      const nameI = $('[name="name"]', el);
      setTimeout(() => isNew && nameI.focus(), 250);
      $("[data-cancel]", el).onclick = () => history.back();
      $("[data-save]", el).onclick = () => {
        const name = nameI.value.trim();
        if (!name) { nameI.focus(); return; }
        if (categories().some(c => c.id !== cat?.id && norm(c.name) === norm(name))) { toast("Ce rangement existe déjà.", { error: true }); return; }
        const icon = $('[name="custom"]', el).value.trim() || $('[name="icon"]:checked', el)?.value || "📦";
        const list = isNew
          ? [...categories(), { id: newId(), name, icon }]
          : categories().map(c => (c.id === cat.id ? { ...c, name, icon } : c));
        state.household.categories = list;
        persist(saveCategories(list));
        entry.close(() => { toast(isNew ? "Rangement ajouté" : "Rangement modifié"); onData(); });
      };
      $("[data-del]", el)?.addEventListener("click", async () => {
        let moveTo = "";
        if (count) {
          const others = categories().filter(c => c.id !== cat.id);
          const choice = await choiceDialog(`${count} produit${count > 1 ? "s sont rangés" : " est rangé"} dans « ${cat.name} ». Où ${count > 1 ? "les" : "le"} déplacer ?`,
            [...others.map(c => ({ label: `${c.icon} ${c.name}`, value: c.id })), { label: "Sans rangement", value: "__none" }]);
          if (!choice) return;
          moveTo = choice === "__none" ? "" : choice;
        } else {
          const ok = await confirmDialog(`Supprimer « ${cat.name} » ?`, { confirmLabel: "Supprimer", danger: true });
          if (!ok) return;
        }
        state.household.categories = categories().filter(c => c.id !== cat.id);
        persist(deleteCategory(cat.id, moveTo));
        entry.close(() => { toast("Rangement supprimé"); onData(); });
      });
    }
  });
}

/* =========================================================
   Connexion
   ========================================================= */

let authMode = "signin";

function setAuthMode(mode) {
  authMode = mode;
  $$("[data-auth-mode]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.authMode === mode)));
  $("#field-name").classList.toggle("hidden", mode !== "signup");
  $("#btn-auth-submit").textContent = mode === "signup" ? "Créer mon compte" : "Se connecter";
  $("#btn-forgot").classList.toggle("hidden", mode === "signup");
  $("#auth-password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  hideLoginMessage();
}

function authErrorMessage(err) {
  switch (err?.code) {
    case "auth/invalid-email": return "Adresse e-mail invalide.";
    case "auth/missing-password": return "Saisis ton mot de passe.";
    case "auth/weak-password": return "Mot de passe trop court : 6 caractères minimum.";
    case "auth/email-already-in-use": return "Un compte existe déjà avec cette adresse. Connecte-toi (ou continue avec Google).";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "Adresse ou mot de passe incorrect.";
    case "auth/too-many-requests": return "Trop de tentatives. Patiente quelques minutes.";
    case "auth/unauthorized-domain": return "Ce domaine n’est pas autorisé. Ajoute-le dans Firebase : Authentication, Paramètres, Domaines autorisés.";
    case "auth/operation-not-allowed": return "Cette méthode de connexion n’est pas activée dans la console Firebase.";
    case "auth/network-request-failed": return "Pas de connexion réseau. Vérifie ta connexion puis réessaie.";
    case "auth/account-exists-with-different-credential": return "Cette adresse est déjà utilisée avec un mot de passe : connecte-toi par e-mail.";
    default: return "La connexion a échoué. Réessaie.";
  }
}

function showLoginMessage(text, ok = false) {
  const el = $("#login-error");
  el.textContent = text;
  el.className = ok ? "login-info" : "login-error";
}
function hideLoginMessage() { $("#login-error").className = "login-error hidden"; }

let pendingProfile = null;

$("#auth-form").addEventListener("submit", async e => {
  e.preventDefault();
  hideLoginMessage();
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const btn = $("#btn-auth-submit");
  btn.disabled = true;
  try {
    if (authMode === "signup") {
      const name = $("#auth-name").value.trim();
      let release;
      pendingProfile = new Promise(r => { release = r; });
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (name) await updateProfile(cred.user, { displayName: name });
        sendEmailVerification(cred.user).catch(() => {});
        toast("Compte créé. Un e-mail de confirmation t’a été envoyé.");
      } finally {
        release();
      }
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    console.error(err);
    showLoginMessage(authErrorMessage(err));
  } finally {
    btn.disabled = false;
  }
});

$("#btn-forgot").addEventListener("click", async () => {
  const email = $("#auth-email").value.trim();
  if (!email) { showLoginMessage("Saisis d’abord ton adresse e-mail ci-dessus."); $("#auth-email").focus(); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showLoginMessage("Si un compte existe avec cette adresse, un e-mail de réinitialisation vient d’être envoyé.", true);
  } catch (err) {
    showLoginMessage(authErrorMessage(err));
  }
});

$$("[data-auth-mode]").forEach(b => b.addEventListener("click", () => setAuthMode(b.dataset.authMode)));

$("#btn-google").addEventListener("click", async () => {
  hideLoginMessage();
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(err.code)) {
      return signInWithRedirect(auth, googleProvider);
    }
    if (["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(err.code)) return;
    console.error(err);
    showLoginMessage(authErrorMessage(err));
  }
});

getRedirectResult(auth).catch(err => { console.error(err); showLoginMessage(authErrorMessage(err)); });

/* =========================================================
   Démarrage : choix ou création du foyer
   ========================================================= */

let bootId = 0;

async function boot(user) {
  const id = ++bootId;
  showScreen("app");
  renderLoading();
  try {
    let hid = await loadUserHousehold();
    if (id !== bootId) return;
    if (!hid) {
      const invites = await findInvites();
      if (id !== bootId) return;
      if (invites.length) { showOnboarding(invites); return; }
      if (!navigator.onLine) { showOffline(); return; }
      hid = await createHousehold(`Chez ${myName()}`);
      if (id !== bootId) return;
    }
    watch(hid);
    loadInvites();
  } catch (err) {
    console.error(err);
    if (id === bootId) showOffline();
  }
}

function showOffline() {
  $("#view").innerHTML = `
    <div class="empty">
      <i class="fa-solid fa-wifi" aria-hidden="true"></i>
      <p>La première ouverture demande une connexion internet, le temps de préparer ton placard.</p>
      <button type="button" class="btn btn-primary" data-retry>Réessayer</button>
    </div>`;
  $("[data-retry]").onclick = () => boot(state.user);
}

function showOnboarding(invites) {
  showScreen("onboard");
  const inner = $("#onboard-inner");
  inner.innerHTML = `
    <div class="brand-mark brand-mark--lg"><span></span><span></span><span></span></div>
    <h1 class="login-title" id="onboard-title">Bienvenue</h1>
    <p class="login-text">${invites.length > 1 ? "Des foyers t’ont" : "Un foyer t’a"} invité à partager ${invites.length > 1 ? "leurs" : "ses"} placards.</p>
    ${invites.map(inv => `
      <div class="onboard-card">
        <strong>${esc(inv.name)}</strong>
        <span class="muted">${Object.values(inv.members || {}).map(m => esc(m.name || m.email)).join(", ")}</span>
        <button type="button" class="btn btn-primary" data-join="${esc(inv.id)}">Rejoindre ce foyer</button>
      </div>`).join("")}
    <button type="button" class="btn btn-ghost" data-own>Créer mon propre placard</button>
    <button type="button" class="link-btn" data-logout>Changer de compte</button>`;
  $$("[data-join]", inner).forEach(b => b.onclick = async () => {
    b.disabled = true;
    try {
      const hid = await joinHousehold(invites.find(i => i.id === b.dataset.join));
      showScreen("app");
      watch(hid);
    } catch (err) {
      console.error(err);
      b.disabled = false;
      toast("Impossible de rejoindre ce foyer. Réessaie.", { error: true });
    }
  });
  $("[data-own]", inner).onclick = async () => {
    showScreen("app");
    renderLoading();
    try {
      const hid = await createHousehold(`Chez ${myName()}`);
      watch(hid);
    } catch { showOffline(); }
  };
  $("[data-logout]", inner).onclick = () => signOut(auth);
}

onHouseholdLost(() => {
  if (!state.user) return;
  toast("Tu ne fais plus partie de ce foyer.", { error: true });
  resetState();
  receivedInvites = null;
  boot(state.user);
});

let memberInfoChecked = false;
subscribe(() => {
  if (state.household && !memberInfoChecked) { memberInfoChecked = true; updateMyMemberInfo(); }
  onData();
});

onAuthStateChanged(auth, async user => {
  if (pendingProfile) { await pendingProfile; pendingProfile = null; user = auth.currentUser; }
  state.user = user;
  if (user) {
    memberInfoChecked = false;
    receivedInvites = null;
    updateAvatar();
    boot(user);
  } else {
    bootId++;
    resetState();
    current = { route: null, update: null };
    showScreen("login");
  }
});

/* ---------- Divers ---------- */

$("#btn-scan").addEventListener("click", () => openMainScanner());
$("#btn-account").addEventListener("click", () => {
  if (routeName() === "compte") location.hash = prevHash.startsWith("#/compte") ? "#/" : prevHash;
  else location.hash = "#/compte";
});

const updateOnline = () => $("#offline-bar").classList.toggle("hidden", navigator.onLine);
window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);
updateOnline();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

export { openProductSheet, stepperHtml, bindStepper, pickProduct };
