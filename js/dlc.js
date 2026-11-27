// Dates limites (DLC) : chaque produit peut avoir des lots { id, date: "AAAA-MM-JJ", qty }.
// Une alerte part DLC_WARN_DAYS jours avant la date (et reste tant que le lot n'est pas retiré).

export const DLC_WARN_DAYS = 3;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(s) {
  if (!DATE_RE.test(String(s || ""))) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Nombre de jours avant la date (0 = aujourd'hui, négatif = dépassée). */
export function daysUntil(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return Infinity;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}

export function fmtDlc(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** « Périme aujourd'hui », « Périme dans 2 jours », « Périmé depuis 3 jours »… */
export function dlcText(dateStr) {
  const n = daysUntil(dateStr);
  if (n === Infinity) return "";
  if (n < -1) return `Périmé depuis ${-n} jours`;
  if (n === -1) return "Périmé depuis hier";
  if (n === 0) return "Périme aujourd’hui";
  if (n === 1) return "Périme demain";
  return `Périme dans ${n} jours`;
}

/** Version courte pour les étiquettes de liste. */
export function dlcShort(dateStr) {
  const n = daysUntil(dateStr);
  if (n === Infinity) return "";
  if (n < 0) return "Périmé";
  if (n === 0) return "DLC aujourd’hui";
  if (n === 1) return "DLC demain";
  return `DLC dans ${n} j`;
}

export const isValidLot = l => !!l && !!parseDate(l.date) && Number(l.qty) > 0;

/** Lots valides, du plus proche au plus lointain. */
export function lotsOf(p) {
  return (Array.isArray(p?.lots) ? p.lots : [])
    .filter(isValidLot)
    .map(l => ({ id: String(l.id || ""), date: l.date, qty: Number(l.qty) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const lotsTotal = lots => Math.round(lots.reduce((s, l) => s + (Number(l.qty) || 0), 0) * 1000) / 1000;

/** Garde au plus « qty » unités datées : on consomme d'abord les dates les plus proches. */
export function trimLots(lots, qty) {
  const sorted = lots.filter(isValidLot).slice().sort((a, b) => a.date.localeCompare(b.date));
  let excess = Math.round((lotsTotal(sorted) - Math.max(0, Number(qty) || 0)) * 1000) / 1000;
  const out = [];
  for (const l of sorted) {
    if (excess > 0) {
      const take = Math.min(excess, l.qty);
      excess = Math.round((excess - take) * 1000) / 1000;
      const left = Math.round((l.qty - take) * 1000) / 1000;
      if (left > 0) out.push({ ...l, qty: left });
    } else {
      out.push({ ...l });
    }
  }
  return out;
}

/** Ajoute des lots : même date = quantités additionnées. */
export function mergeLots(current, added, newId) {
  const out = current.filter(isValidLot).map(l => ({ ...l }));
  for (const a of added.filter(isValidLot)) {
    const same = out.find(l => l.date === a.date);
    if (same) same.qty = Math.round((same.qty + Number(a.qty)) * 1000) / 1000;
    else out.push({ id: a.id || newId(), date: a.date, qty: Number(a.qty) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Lots dont la date approche (ou est passée). */
export function expiringLots(p) {
  return lotsOf(p).filter(l => daysUntil(l.date) <= DLC_WARN_DAYS);
}

export function nextLot(p) {
  return lotsOf(p)[0] || null;
}

export const sameLots = (a, b) => JSON.stringify(a.filter(isValidLot)) === JSON.stringify(b.filter(isValidLot));
