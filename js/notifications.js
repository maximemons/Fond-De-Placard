// Cloche de l'en-tête : produits à racheter et dates limites proches.
// Les notifications sont calculées en direct à partir du placard (rien n'est stocké côté serveur) ;
// seules les notifications déjà vues sont mémorisées sur l'appareil, pour la pastille.

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

  const unseen = list.filter(n => !seen.has(n.key)).length;
  badge.textContent = unseen > 9 ? "9+" : String(unseen);
  badge.classList.toggle("hidden", !unseen);
  btn.classList.toggle("has-notifs", list.length > 0);
  btn.setAttribute("aria-label", list.length
    ? `Notifications : ${list.length}${unseen ? `, dont ${unseen} nouvelle${unseen > 1 ? "s" : ""}` : ""}`
    : "Notifications");
  panelDraw?.(list);
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
    body: `<div data-notifs></div>`,
    onClose() { panelDraw = null; },
    onMount(el, entry) {
      const box = $("[data-notifs]", el);
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
}
