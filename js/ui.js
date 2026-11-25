// Petits outils d'interface : sélecteurs, échappement, toast, dialogues, panneaux, images.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Comparaison sans accents ni majuscules
export function norm(s) {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function toNum(v) {
  if (v === null || v === undefined || v === "") return NaN;
  return parseFloat(String(v).replace(",", ".").replace(/\s/g, ""));
}

export function fmtQty(n) {
  const v = Math.max(0, Number(n) || 0);
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

export function plural(n, one, many) {
  return `${fmtQty(n)} ${Math.abs(n) >= 2 ? many : one}`;
}

export function fmtDate(ts) {
  const d = ts?.toDate ? ts.toDate() : (typeof ts === "number" ? new Date(ts) : null);
  if (!d) return "";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/* ---------- Toast (avec action facultative, ex. « Annuler ») ---------- */

let toastTimer;
export function toast(msg, { error = false, action = null, duration } = {}) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}`;
  el.classList.toggle("is-error", error);
  el.classList.add("is-visible");
  if (action) {
    $("button", el).onclick = () => {
      el.classList.remove("is-visible");
      action.onClick();
    };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), duration || (error ? 4500 : action ? 4500 : 2200));
}

export function errorMessage(err) {
  const code = err?.code || "";
  if (code.includes("permission-denied")) return "Accès refusé. Vérifie que tu fais bien partie de ce foyer.";
  if (code.includes("resource-exhausted")) return "Quota Firebase atteint. Réessaie plus tard.";
  if (code.includes("invalid-argument")) return "Donnée refusée (photo trop lourde ?).";
  if (code.includes("unavailable")) return "Serveur injoignable. Les changements partiront au retour du réseau.";
  return "L’enregistrement a échoué. Réessaie.";
}

export function persist(promise, okMsg) {
  if (okMsg) toast(okMsg);
  return Promise.resolve(promise).catch(err => {
    console.error(err);
    toast(errorMessage(err), { error: true });
  });
}

/* ---------- Dialogues (remplacent confirm(), ignoré dans certaines applis installées) ---------- */

function mountDialog(inner, onDone) {
  const wrap = document.createElement("div");
  wrap.className = "dialog-backdrop";
  wrap.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true" aria-describedby="dialog-msg">${inner}</div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("is-open"));
  const done = value => {
    document.removeEventListener("keydown", onKey, true);
    wrap.classList.remove("is-open");
    setTimeout(() => wrap.remove(), 180);
    onDone(value);
  };
  const onKey = e => { if (e.key === "Escape") { e.stopImmediatePropagation(); done(null); } };
  document.addEventListener("keydown", onKey, true);
  wrap.addEventListener("click", e => { if (e.target === wrap) done(null); });
  return { wrap, done };
}

export function confirmDialog(message, { confirmLabel = "Confirmer", danger = false, detail = "" } = {}) {
  return new Promise(resolve => {
    const { wrap, done } = mountDialog(`
      <p id="dialog-msg" class="dialog-msg">${esc(message)}</p>
      ${detail ? `<p class="dialog-detail">${esc(detail)}</p>` : ""}
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-no>Annuler</button>
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-yes>${esc(confirmLabel)}</button>
      </div>`, v => resolve(!!v));
    $("[data-no]", wrap).onclick = () => done(false);
    $("[data-yes]", wrap).onclick = () => done(true);
    $("[data-yes]", wrap).focus();
  });
}

export function choiceDialog(message, choices, { detail = "", cancelLabel = "Annuler" } = {}) {
  return new Promise(resolve => {
    const { wrap, done } = mountDialog(`
      <p id="dialog-msg" class="dialog-msg">${esc(message)}</p>
      ${detail ? `<p class="dialog-detail">${esc(detail)}</p>` : ""}
      <div class="dialog-actions dialog-actions--stack">
        ${choices.map((c, i) => `<button type="button" class="btn ${c.kind === "primary" ? "btn-primary" : c.kind === "danger" ? "btn-danger" : "btn-ghost"}" data-choice="${i}">${esc(c.label)}</button>`).join("")}
        <button type="button" class="link-btn" data-no>${esc(cancelLabel)}</button>
      </div>`, v => resolve(v ?? null));
    $("[data-no]", wrap).onclick = () => done(null);
    $$("[data-choice]", wrap).forEach(b => { b.onclick = () => done(choices[+b.dataset.choice].value); });
    $("[data-choice]", wrap)?.focus();
  });
}

export function promptDialog(message, { value = "", placeholder = "", confirmLabel = "Valider", type = "text", maxLength = 80 } = {}) {
  return new Promise(resolve => {
    const { wrap, done } = mountDialog(`
      <form>
        <label class="field">
          <span id="dialog-msg" class="dialog-msg">${esc(message)}</span>
          <input type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="${maxLength}" required>
        </label>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" data-no>Annuler</button>
          <button type="submit" class="btn btn-primary">${esc(confirmLabel)}</button>
        </div>
      </form>`, v => resolve(v));
    const input = $("input", wrap);
    $("[data-no]", wrap).onclick = () => done(null);
    $("form", wrap).onsubmit = e => {
      e.preventDefault();
      const v = input.value.trim();
      if (v) done(v); else input.focus();
    };
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

/* ---------- Panneaux (bottom sheets) avec gestion du bouton retour ---------- */

const sheetStack = [];

export function openSheet({ title, body, footer = "", onMount, isDirty, onClose }) {
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grip"></div>
      <header class="sheet-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Fermer"><i class="fa-solid fa-xmark"></i></button>
      </header>
      <div class="sheet-body">${body}</div>
      ${footer ? `<footer class="sheet-foot">${footer}</footer>` : ""}
    </div>`;
  $("#sheet-root").appendChild(backdrop);
  document.body.classList.add("no-scroll");

  const entry = { backdrop, isDirty, onClose, force: false, after: null };
  sheetStack.push(entry);
  history.pushState({ fdpSheet: sheetStack.length }, "");

  const requestClose = () => history.back();
  backdrop.addEventListener("click", e => { if (e.target === backdrop) requestClose(); });
  $("[data-close]", backdrop).addEventListener("click", requestClose);
  requestAnimationFrame(() => backdrop.classList.add("is-open"));

  const sheetEl = $(".sheet", backdrop);
  entry.el = sheetEl;
  entry.close = after => { entry.force = true; entry.after = after || null; history.back(); };
  onMount?.(sheetEl, entry);
  return entry;
}

function destroySheet(entry) {
  const i = sheetStack.indexOf(entry);
  if (i >= 0) sheetStack.splice(i, 1);
  entry.backdrop.classList.remove("is-open");
  setTimeout(() => entry.backdrop.remove(), 220);
  if (!sheetStack.length) document.body.classList.remove("no-scroll");
  entry.onClose?.();
  if (entry.after) setTimeout(entry.after, 0);
}

export function hasOpenSheet() { return sheetStack.length > 0; }

// Le bouton retour (Android) ferme d'abord le scanner, puis le panneau du dessus.
const backHandlers = [];
export function pushBackHandler(fn) {
  backHandlers.push(fn);
  history.pushState({ fdpLayer: true }, "");
}
export function popBackHandler(fn) {
  const i = backHandlers.lastIndexOf(fn);
  if (i >= 0) backHandlers.splice(i, 1);
}

// Retour d'historique déclenché par le code pour retirer une entrée déjà traitée : à ignorer.
let swallow = 0;
export function swallowNextPop() { swallow++; }

window.addEventListener("popstate", () => {
  if (swallow) { swallow--; return; }
  if (backHandlers.length) {
    const fn = backHandlers.pop();
    fn();
    return;
  }
  const top = sheetStack[sheetStack.length - 1];
  if (!top) return;
  if (!top.force && top.isDirty && top.isDirty()) {
    history.pushState({ fdpSheet: sheetStack.length }, "");
    confirmDialog("Fermer sans enregistrer les modifications ?", { confirmLabel: "Fermer", danger: true })
      .then(ok => { if (ok) top.close(); });
    return;
  }
  destroySheet(top);
});

document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || document.querySelector(".dialog-backdrop")) return;
  if (backHandlers.length || sheetStack.length) history.back();
});

/* ---------- Images ---------- */

const MAX_IMAGE_SIDE = 640;
const IMAGE_QUALITY = 0.72;

// Redimensionne et compresse une photo sur le téléphone (≤ ~250 Ko) avant l'envoi.
export function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) return reject(new Error("not-image"));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      let quality = IMAGE_QUALITY;
      let data = canvas.toDataURL("image/jpeg", quality);
      while (data.length > 250000 && quality > 0.3) {
        quality -= 0.1;
        data = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("load")); };
    img.src = url;
  });
}

export function vibrate(pattern = 40) {
  try { navigator.vibrate?.(pattern); } catch { /* rien */ }
}

let audioCtx;
export function beep(freq = 1150, ms = 90) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.value = 0.08;
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + ms / 1000);
  } catch { /* rien */ }
}
