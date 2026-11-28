// Cloche de l'en-tête : produits à racheter et dates limites proches.
// Les notifications sont calculées en direct à partir du placard (rien n'est stocké côté serveur) ;
// seules les notifications déjà vues sont mémorisées sur l'appareil, pour la pastille.
// Chaque nouvelle notification de la cloche déclenche aussi une notification du navigateur
// (si l'utilisateur l'a activée sur cet appareil depuis le panneau de la cloche).

import { $, $$, esc, fmtDate, openSheet, persist, toast, choiceDialog } from "./ui.js";
import { state, lowProducts, consumeLot, dropLot } from "./store.js";
import { expiringLots, daysUntil, dlcText, fmtDlc, DLC_WARN_DAYS } from "./dlc.js";
import { qtyLabel } from "./catalog.js";
import { thumbHtml, hydrateThumbs, stockText, byName } from "./products-ui.js";
import { openProductSheet } from "./app.js";

const seenKey = () => `fdp:notifs-seen:${state.hid}`;

function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(seenKey()) || "[]")); } catch { return new Set(); }
}
function saveSeen(set) {
  try { localStorage.setItem(seenKey(), JSON.stringify([...set])); } catch { /* stockage plein */ }
}

/* ---------- Notifications du navigateur ---------- */

const PREF_KEY = "fdp:browser-notifs";            // "on" | "off", par appareil
const pushedKey = () => `fdp:notifs-pushed:${state.hid}`;
const MAX_SEPARATE = 3;                           // au-delà, une seule notification récapitulative

export function browserNotifsSupported() {
  return "Notification" in window && window.isSecureContext;
}
function browserPref() {
  try { return localStorage.getItem(PREF_KEY); } catch { return null; }
}
function setBrowserPref(v) {
  try { localStorage.setItem(PREF_KEY, v); } catch { /* stockage plein */ }
}
export function browserNotifsOn() {
  return browserNotifsSupported() && Notification.permission === "granted" && browserPref() === "on";
}
function loadPushed() {
  try { return new Set(JSON.parse(localStorage.getItem(pushedKey()) || "[]")); } catch { return new Set(); }
}
function savePushed(set) {
  try { localStorage.setItem(pushedKey(), JSON.stringify([...set])); } catch { /* stockage plein */ }
}

function notifContent(n) {
  const { p } = n;
  if (n.kind === "dlc") {
    return {
      title: `${p.name} : ${n.stage === "over" ? "périmé" : "bientôt périmé"}`,
      body: `${dlcText(n.lot.date)} · ${qtyLabel(n.lot.qty, p.unit)} · DLC ${fmtDlc(n.lot.date)}`,
      target: "notifs"
    };
  }
  return {
    title: `Racheter ${p.listName || p.name}`,
    body: p.sentAt ? "Déjà sur la liste de courses" : `Reste ${stockText(p)}`,
    target: "courses"
  };
}

async function showBrowserNotif(title, { body, tag, target }) {
  const options = {
    body,
    tag,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    lang: "fr",
    data: { target }
  };
  try {
    // Sur Android, seul le service worker peut afficher une notification.
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) { await reg.showNotification(title, options); return; }
    }
    const notif = new Notification(title, options);
    notif.onclick = () => { window.focus(); handleNotifTarget(target); notif.close(); };
  } catch { /* navigateur qui refuse : la cloche reste la référence */ }
}

/** Envoie au navigateur les notifications apparues depuis le dernier passage. */
function pushBrowserNotifs(list, seen) {
  const active = new Set(list.map(n => n.key));
  const pushed = loadPushed();
  let changed = false;
  // Une notification disparue puis revenue sera signalée à nouveau.
  for (const k of pushed) if (!active.has(k)) { pushed.delete(k); changed = true; }

  const fresh = list.filter(n => !pushed.has(n.key));
  for (const n of fresh) pushed.add(n.key);
  if (fresh.length) changed = true;
  if (changed) savePushed(pushed);

  if (!browserNotifsOn()) return;
  // Déjà vues dans la cloche (panneau ouvert) : inutile de les rappeler.
  const toShow = fresh.filter(n => !seen.has(n.key));
  if (!toShow.length) return;

  if (toShow.length > MAX_SEPARATE) {
    const dlc = toShow.filter(n => n.kind === "dlc").length;
    const restock = toShow.length - dlc;
    const parts = [];
    if (dlc) parts.push(`${dlc} date${dlc > 1 ? "s" : ""} limite${dlc > 1 ? "s" : ""}`);
    if (restock) parts.push(`${restock} produit${restock > 1 ? "s" : ""} à racheter`);
    showBrowserNotif(`${toShow.length} nouvelles notifications`, {
      body: parts.join(" · "),
      tag: "fdp-summary",
      target: "notifs"
    });
    return;
  }
  for (const n of toShow) {
    const { title, body, target } = notifContent(n);
    showBrowserNotif(title, { body, tag: `fdp:${n.key}`, target });
  }
}

/** Active les notifications du navigateur (à appeler depuis un geste de l'utilisateur). */
async function enableBrowserNotifs() {
  if (!browserNotifsSupported()) return false;
  let perm = Notification.permission;
  if (perm === "default") {
    try { perm = await Notification.requestPermission(); } catch { perm = "denied"; }
  }
  if (perm !== "granted") {
    toast("Notifications refusées par le navigateur", { error: true });
    return false;
  }
  setBrowserPref("on");
  // Ce qui est déjà dans la cloche est connu : seules les prochaines seront envoyées.
  if (state.hid) savePushed(new Set(computeNotifications().map(n => n.key)));
  toast("Notifications activées sur cet appareil");
  return true;
}

let pendingTarget = null;

function handleNotifTarget(target) {
  if (target === "courses") { location.hash = "#/courses"; return; }
  pendingTarget = "notifs";
  tryOpenPending();
}

function tryOpenPending() {
  if (!pendingTarget || panelDraw) { if (panelDraw) pendingTarget = null; return; }
  if (!state.hid || !state.ready.household || !state.ready.products) return;
  pendingTarget = null;
  openNotifications();
}

function browserRowHtml() {
  if (!browserNotifsSupported()) {
    return `
      <div class="switch-row">
        <span><strong>Notifications du téléphone</strong>
        <small>Pas disponibles dans ce navigateur. Sur iPhone, ajoute d’abord l’appli à l’écran d’accueil.</small></span>
      </div>`;
  }
  const denied = Notification.permission === "denied";
  const on = browserNotifsOn();
  return `
    <div class="switch-row">
      <span><strong>Notifications du téléphone</strong>
      <small>${denied
        ? "Bloquées : autorise-les dans les réglages du navigateur pour ce site."
        : "Être prévenu ici dès qu’une nouvelle alerte arrive dans la cloche."}</small></span>
      <label class="switch"><input type="checkbox" data-push-toggle ${on ? "checked" : ""} ${denied ? "disabled" : ""} aria-label="Notifications du téléphone"><span></span></label>
    </div>`;
}

function mountBrowserRow(host) {
  host.innerHTML = browserRowHtml();
  const input = $("[data-push-toggle]", host);
  if (!input) return;
  input.onchange = async () => {
    if (input.checked) {
      input.disabled = true;
      await enableBrowserNotifs();
      mountBrowserRow(host); // reflète l'état réel (autorisation accordée ou non)
    } else {
      setBrowserPref("off");
      toast("Notifications désactivées sur cet appareil");
    }
  };
}

/* ---------- Cloche ---------- */

/** Liste des notifications actives, les plus urgentes d'abord. */
export function computeNotifications() {
  const dlc = [];
  for (const p of state.products) {
    if (p.qty <= 0) continue;
    for (const lot of expiringLots(p)) {
      const days = daysUntil(lot.date);
      const stage = days < 0 ? "over" : days === 0 ? "today" : "soon";
      dlc.push({ key: `d:${p.id}:${lot.id}:${stage}`, kind: "dlc", stage, p, lot, days });
    }
  }
  dlc.sort((a, b) => a.days - b.days || byName(a.p, b.p));
  const restock = lowProducts()
    .sort((a, b) => (!!a.sentAt - !!b.sentAt) || byName(a, b))
    .map(p => ({ key: `r:${p.id}`, kind: "restock", p }));
  return [...dlc, ...restock];
}

let panelDraw = null;

export function refreshNotifications() {
  const btn = $("#btn-notifs");
  const badge = $("#notifs-badge");
  if (!btn || !badge) return;
  if (!state.hid || !state.ready.household || !state.ready.products) {
    badge.classList.add("hidden");
    btn.classList.remove("has-notifs");
    return;
  }
  const list = computeNotifications();
  const active = new Set(list.map(n => n.key));
  const seen = loadSeen();
  let changed = false;
  // On oublie les notifications disparues : si elles reviennent, elles seront à nouveau signalées.
  for (const k of seen) if (!active.has(k)) { seen.delete(k); changed = true; }
  // Panneau ouvert : tout ce qui s'affiche est vu.
  if (panelDraw) for (const k of active) if (!seen.has(k)) { seen.add(k); changed = true; }
  if (changed) saveSeen(seen);
  pushBrowserNotifs(list, seen);

  const unseen = list.filter(n => !seen.has(n.key)).length;
  badge.textContent = unseen > 9 ? "9+" : String(unseen);
  badge.classList.toggle("hidden", !unseen);
  btn.classList.toggle("has-notifs", list.length > 0);
  btn.setAttribute("aria-label", list.length
    ? `Notifications : ${list.length}${unseen ? `, dont ${unseen} nouvelle${unseen > 1 ? "s" : ""}` : ""}`
    : "Notifications");
  panelDraw?.(list);
  tryOpenPending();
}

function dlcRow(n) {
  const { p, lot, stage } = n;
  return `
    <li class="notif notif--${stage}" data-key="${esc(n.key)}">
      ${thumbHtml(p)}
      <button type="button" class="rows-text rows-btn" data-open-product="${esc(p.id)}">
        <strong>${esc(p.name)} : ${stage === "over" ? "périmé" : "bientôt périmé"}</strong>
        <small>${esc(dlcText(lot.date))} · ${esc(qtyLabel(lot.qty, p.unit))} · DLC ${esc(fmtDlc(lot.date))}</small>
      </button>
      <button type="button" class="btn btn-ghost btn-small" data-lot="${esc(p.id)}|${esc(lot.id)}">Retirer</button>
    </li>`;
}

function restockRow(n) {
  const { p } = n;
  return `
    <li class="notif notif--restock">
      ${thumbHtml(p)}
      <button type="button" class="rows-text rows-btn" data-courses>
        <strong>Racheter ${esc(p.listName || p.name)}</strong>
        <small>${p.sentAt ? `Sur la liste depuis le ${esc(fmtDate(p.sentAt) || "…")}` : `Reste ${esc(stockText(p))}`}</small>
      </button>
      <i class="fa-solid fa-chevron-right muted" aria-hidden="true"></i>
    </li>`;
}

export function openNotifications() {
  openSheet({
    title: "Notifications",
    body: `<div data-push-row style="margin-bottom:18px"></div><div data-notifs></div>`,
    onClose() { panelDraw = null; },
    onMount(el, entry) {
      const box = $("[data-notifs]", el);
      mountBrowserRow($("[data-push-row]", el));
      panelDraw = list => {
        const dlc = list.filter(n => n.kind === "dlc");
        const restock = list.filter(n => n.kind === "restock");
        if (!list.length) {
          box.innerHTML = `
            <div class="empty" style="margin-top:6px">
              <i class="fa-regular fa-bell" aria-hidden="true"></i>
              <p>Rien à signaler : aucune date limite dans les ${DLC_WARN_DAYS} prochains jours et rien à racheter.</p>
            </div>`;
          return;
        }
        box.innerHTML = `
          ${dlc.length ? `
          <section>
            <h3 class="block-title">Dates limites</h3>
            <ul class="rows">${dlc.map(dlcRow).join("")}</ul>
          </section>` : ""}
          ${restock.length ? `
          <section style="margin-top:${dlc.length ? "22px" : "0"}">
            <h3 class="block-title">À racheter</h3>
            <ul class="rows">${restock.map(restockRow).join("")}</ul>
            <button type="button" class="btn btn-ghost btn-block" data-courses style="margin-top:10px">
              <i class="fa-solid fa-basket-shopping"></i> Voir les courses
            </button>
          </section>` : ""}`;
        hydrateThumbs(box);

        $$("[data-courses]", box).forEach(b => b.onclick = () => entry.close(() => { location.hash = "#/courses"; }));
        $$("[data-open-product]", box).forEach(b => b.onclick = () => {
          const p = state.products.find(x => x.id === b.dataset.openProduct);
          if (p) openProductSheet({ product: p });
        });
        $$("[data-lot]", box).forEach(b => b.onclick = async () => {
          const [pid, lotId] = b.dataset.lot.split("|");
          const p = state.products.find(x => x.id === pid);
          const lot = p?.lots.find(l => l.id === lotId);
          if (!p || !lot) return;
          const choice = await choiceDialog(`${p.name}, DLC du ${fmtDlc(lot.date)}`, [
            { label: `Consommé ou jeté (−${qtyLabel(lot.qty, p.unit)} du stock)`, value: "consume", kind: "primary" },
            { label: "Enlever seulement la date", value: "drop" }
          ], { detail: "« Enlever seulement la date » garde le stock tel quel." });
          if (choice === "consume") {
            persist(consumeLot(p, lotId));
            toast(`${p.name} : il en reste ${stockText(p)}`);
          } else if (choice === "drop") {
            persist(dropLot(p, lotId));
            toast("Date retirée");
          }
          refreshNotifications();
        });
      };
      refreshNotifications();
    }
  });
}

let started = false;
export function initNotifications() {
  if (started) return;
  started = true;
  $("#btn-notifs")?.addEventListener("click", openNotifications);
  // Les dates avancent toutes seules : on recalcule au retour sur l'appli et régulièrement.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshNotifications(); });
  setInterval(refreshNotifications, 15 * 60 * 1000);

  // Appui sur une notification du navigateur (relayé par le service worker).
  navigator.serviceWorker?.addEventListener("message", e => {
    if (e.data?.type === "fdp-notif-click") handleNotifTarget(e.data.target);
  });
  // Appli ouverte depuis une notification alors qu'elle était fermée.
  if (location.hash === "#/notifs") {
    history.replaceState(null, "", "#/");
    pendingTarget = "notifs";
  }
}
