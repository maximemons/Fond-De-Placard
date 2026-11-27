// Couche de données : foyer, produits, photos, rangements, invitations.
// Les écritures ne sont pas attendues dans l'interface (Firestore les garde hors ligne
// et ne « résout » qu'à l'accusé du serveur) : on génère les identifiants côté appli.

import { auth, db } from "./firebase-config.js";
import { DEFAULT_CATEGORIES } from "./catalog.js";
import { newId, norm } from "./ui.js";
import { lotsOf, trimLots, mergeLots, sameLots, isValidLot, expiringLots } from "./dlc.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where,
  writeBatch, serverTimestamp, increment, arrayUnion, arrayRemove, deleteField
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

export const state = {
  user: null,
  hid: null,
  household: null,
  products: [],
  ready: { household: false, products: false }
};

const subscribers = new Set();
export function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
function emit() { subscribers.forEach(fn => fn()); }

let unsubs = [];
let onLostHandler = null;
export function onHouseholdLost(fn) { onLostHandler = fn; }

/* ---------- Références ---------- */

const householdsCol = () => collection(db, "households");
const householdRef = (hid = state.hid) => doc(db, "households", hid);
const productsCol = (hid = state.hid) => collection(db, "households", hid, "products");
const productRef = (id, hid = state.hid) => doc(db, "households", hid, "products", id);
const imageRef = (id, hid = state.hid) => doc(db, "households", hid, "images", id);
const userRef = () => doc(db, "users", state.user.uid);

export const uid = () => state.user?.uid;
export const myEmail = () => (state.user?.email || "").toLowerCase();
export function myName() {
  const u = state.user;
  return (u?.displayName || (u?.email || "").split("@")[0] || "Moi").trim();
}
export const isOwner = () => state.household?.ownerUid === uid();

/* ---------- Démarrage ---------- */

export async function loadUserHousehold() {
  const snap = await getDoc(userRef()).catch(() => null);
  const hid = snap?.exists() ? snap.data().householdId : null;
  if (!hid) return null;
  try {
    const h = await getDoc(householdRef(hid));
    if (h.exists() && (h.data().memberUids || []).includes(uid())) return hid;
  } catch { /* plus membre */ }
  return null;
}

async function setUserHousehold(hid) {
  await setDoc(userRef(), {
    householdId: hid,
    email: myEmail(),
    name: myName(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function findInvites() {
  const email = myEmail();
  if (!email || !state.user.emailVerified) return [];
  try {
    const snap = await getDocs(query(householdsCol(), where("invitedEmails", "array-contains", email)));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(h => !(h.memberUids || []).includes(uid()));
  } catch (err) {
    console.warn("Invitations illisibles", err);
    return [];
  }
}

export async function createHousehold(name) {
  const ref = doc(householdsCol());
  await setDoc(ref, {
    name: (name || `Chez ${myName()}`).slice(0, 60),
    ownerUid: uid(),
    memberUids: [uid()],
    members: { [uid()]: { email: myEmail(), name: myName() } },
    invitedEmails: [],
    categories: DEFAULT_CATEGORIES.map(c => ({ id: newId(), name: c.name, icon: c.icon })),
    listmeLink: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  await setUserHousehold(ref.id);
  return ref.id;
}

/* ---------- Écoute en direct ---------- */

export function watch(hid) {
  stopWatch();
  state.hid = hid;
  state.household = null;
  state.products = [];
  state.ready = { household: false, products: false };

  const lost = err => {
    console.warn(err);
    if (err?.code === "permission-denied") onLostHandler?.();
  };

  unsubs.push(onSnapshot(householdRef(hid), snap => {
    if (!snap.exists() || !(snap.data().memberUids || []).includes(uid())) { onLostHandler?.(); return; }
    state.household = { id: snap.id, ...snap.data() };
    state.household.categories = state.household.categories || [];
    state.ready.household = true;
    emit();
  }, lost));

  unsubs.push(onSnapshot(productsCol(hid), snap => {
    state.products = snap.docs.map(d => {
      const p = { id: d.id, ...d.data() };
      p.qty = Math.max(0, Number(p.qty) || 0);
      p.barcodes = p.barcodes || [];
      p.lots = lotsOf(p);
      return p;
    });
    state.ready.products = true;
    emit();
  }, lost));
}

export function stopWatch() {
  unsubs.forEach(fn => fn());
  unsubs = [];
}

export function resetState() {
  stopWatch();
  state.hid = null;
  state.household = null;
  state.products = [];
  state.ready = { household: false, products: false };
  photoCache.clear();
}

/* ---------- Lecture ---------- */

export const categories = () => state.household?.categories || [];
export const categoryOf = id => categories().find(c => c.id === id) || null;

export function findByCode(code) {
  return state.products.find(p => p.barcodes.includes(code)) || null;
}

export function isLow(p) {
  return !!p.alert && p.qty <= (Number(p.threshold) || 0);
}

/** Acheté depuis l'alerte, mais toujours sous le seuil : on ne le redemande pas
 *  tant que le stock n'est pas redescendu sous le niveau atteint après l'achat. */
export function isBoughtAwaiting(p) {
  return p.boughtLevel !== null && p.boughtLevel !== undefined && p.qty >= Number(p.boughtLevel);
}

/** Sous le seuil et pas encore racheté : à mettre sur la liste de courses. */
export function needsRestock(p) {
  return isLow(p) && !isBoughtAwaiting(p);
}

export function lowProducts() {
  return state.products.filter(needsRestock);
}

export function expiringProducts() {
  return state.products.filter(p => p.qty > 0 && expiringLots(p).length);
}

/* ---------- Produits ---------- */

const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: uid() });

function cleanProduct(data) {
  const out = {};
  const keys = ["name", "brand", "emoji", "unit", "categoryId", "qty", "barcodes", "alert", "threshold",
    "restockQty", "listName", "imageUrl", "source", "format", "lots"];
  for (const k of keys) if (data[k] !== undefined) out[k] = data[k];
  if (out.name !== undefined) out.name = String(out.name).trim().slice(0, 120);
  if (out.qty !== undefined) out.qty = Math.max(0, Number(out.qty) || 0);
  if (out.threshold !== undefined) out.threshold = Math.max(0, Number(out.threshold) || 0);
  if (out.restockQty !== undefined) out.restockQty = Math.max(0, Number(out.restockQty) || 0);
  if (out.lots !== undefined) {
    out.lots = (out.lots || []).filter(isValidLot).slice(0, 60)
      .map(l => ({ id: String(l.id || newId()), date: l.date, qty: Math.max(0, Number(l.qty) || 0) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return out;
}

export function createProduct(data, photo) {
  const id = doc(productsCol()).id;
  const batch = writeBatch(db);
  const payload = {
    qty: 0, barcodes: [], alert: false, threshold: 0, restockQty: 1, unit: "", emoji: "",
    brand: "", listName: "", imageUrl: "", source: "", format: "", lots: [],
    ...cleanProduct(data),
    hasPhoto: !!photo,
    photoAt: photo ? Date.now() : 0,
    sentAt: null,
    boughtLevel: null,
    createdAt: serverTimestamp(),
    ...stamp()
  };
  batch.set(productRef(id), payload);
  if (photo) batch.set(imageRef(id), { data: photo });
  const done = batch.commit();
  // Ajout immédiat dans l'état local pour pouvoir enchaîner (le cache Firestore suit).
  return { id, done };
}

/** photo : undefined = inchangée, null = retirée, texte = nouvelle photo (data URL). */
export function updateProduct(p, patch, photo) {
  const batch = writeBatch(db);
  const data = { ...cleanProduct(patch), ...stamp() };
  if (photo === null) {
    data.hasPhoto = false;
    data.photoAt = 0;
    batch.delete(imageRef(p.id));
  } else if (typeof photo === "string") {
    data.hasPhoto = true;
    data.photoAt = Date.now();
    batch.set(imageRef(p.id), { data: photo });
  }
  const threshold = patch.threshold ?? p.threshold;
  const qty = patch.qty ?? p.qty;
  if (p.sentAt && qty > threshold) data.sentAt = null;
  if (qty > threshold || (p.boughtLevel != null && qty < p.boughtLevel)) data.boughtLevel = null;
  batch.update(productRef(p.id), data);
  return batch.commit();
}

export function deleteProduct(p) {
  const batch = writeBatch(db);
  batch.delete(productRef(p.id));
  if (p.hasPhoto) batch.delete(imageRef(p.id));
  return batch.commit();
}

/** Ajoute (delta > 0) ou sort (delta < 0) du stock. Renvoie la variation réellement appliquée. */
export function changeQty(p, delta) {
  const cur = Math.max(0, Number(p.qty) || 0);
  let d = delta < 0 ? -Math.min(-delta, cur) : delta;
  d = Math.round(d * 1000) / 1000;
  if (!d) return { applied: 0, done: Promise.resolve() };
  const next = Math.round((cur + d) * 1000) / 1000;
  const data = { qty: increment(d), ...stamp() };
  if (p.sentAt && next > (Number(p.threshold) || 0)) data.sentAt = null;
  if (next > (Number(p.threshold) || 0) && p.boughtLevel != null) { data.boughtLevel = null; p.boughtLevel = null; }
  // Sortie de stock : les unités datées les plus proches partent en premier.
  if (d < 0 && p.lots?.length) {
    const lots = trimLots(lotsOf(p), next);
    if (!sameLots(lots, lotsOf(p))) { data.lots = lots; p.lots = lots; }
  }
  p.qty = next; // reflet immédiat dans l'interface
  return { applied: d, done: updateDoc(productRef(p.id), data) };
}

/**
 * Achat depuis la liste de courses : ajoute au stock, retire de la liste,
 * enregistre les DLC éventuelles. newLots = [{ date, qty }]
 */
export function recordPurchase(p, amount, newLots = []) {
  const add = Math.round(Math.max(0, Number(amount) || 0) * 1000) / 1000;
  const cur = Math.max(0, Number(p.qty) || 0);
  const next = Math.round((cur + add) * 1000) / 1000;
  const threshold = Number(p.threshold) || 0;
  const data = { sentAt: null, ...stamp() };
  if (add) data.qty = increment(add);
  // Toujours sous le seuil après l'achat : on le retire quand même de la liste.
  data.boughtLevel = p.alert && next <= threshold ? next : null;
  const added = newLots.filter(isValidLot);
  if (added.length) {
    const lots = trimLots(mergeLots(lotsOf(p), added, newId), next);
    data.lots = lots;
    p.lots = lots;
  }
  p.qty = next;
  p.sentAt = null;
  p.boughtLevel = data.boughtLevel;
  return updateDoc(productRef(p.id), data);
}

/** Ajoute des lots datés à un stock déjà compté (ex. après un scan d'entrée). */
export function addLots(p, newLots) {
  const lots = trimLots(mergeLots(lotsOf(p), newLots, newId), p.qty);
  p.lots = lots;
  return updateDoc(productRef(p.id), { lots, ...stamp() });
}

/** Lot consommé ou jeté : il sort du stock et de la liste des DLC. */
export function consumeLot(p, lotId) {
  const lot = lotsOf(p).find(l => l.id === lotId);
  if (!lot) return Promise.resolve();
  const cur = Math.max(0, Number(p.qty) || 0);
  const d = Math.min(lot.qty, cur);
  const next = Math.round((cur - d) * 1000) / 1000;
  const lots = trimLots(lotsOf(p).filter(l => l.id !== lotId), next);
  const data = { lots, ...stamp() };
  if (d) data.qty = increment(-d);
  if (p.boughtLevel != null && next < p.boughtLevel) data.boughtLevel = null;
  p.qty = next;
  p.lots = lots;
  return updateDoc(productRef(p.id), data);
}

/** Lot dont la date est fausse ou déjà retiré à la main : on enlève juste la date. */
export function dropLot(p, lotId) {
  const lots = lotsOf(p).filter(l => l.id !== lotId);
  p.lots = lots;
  return updateDoc(productRef(p.id), { lots, ...stamp() });
}

export function addBarcode(p, code) {
  return updateDoc(productRef(p.id), { barcodes: arrayUnion(code), ...stamp() });
}

export function removeBarcode(p, code) {
  return updateDoc(productRef(p.id), { barcodes: arrayRemove(code), ...stamp() });
}

export function markSent(ids) {
  const batch = writeBatch(db);
  ids.forEach(id => batch.update(productRef(id), { sentAt: Date.now() }));
  return batch.commit();
}

export function clearSent(ids) {
  const batch = writeBatch(db);
  ids.forEach(id => batch.update(productRef(id), { sentAt: null }));
  return batch.commit();
}

/** Grand inventaire : écrase les quantités. entries = [{ product, qty }] */
export async function applyInventory(entries) {
  const chunks = [];
  for (let i = 0; i < entries.length; i += 400) chunks.push(entries.slice(i, i + 400));
  const commits = chunks.map(chunk => {
    const batch = writeBatch(db);
    chunk.forEach(({ product, qty }) => {
      const data = { qty: Math.max(0, qty), ...stamp() };
      if (product.sentAt && qty > (Number(product.threshold) || 0)) data.sentAt = null;
      if (product.boughtLevel != null && (qty > (Number(product.threshold) || 0) || qty < product.boughtLevel)) data.boughtLevel = null;
      if (product.lots?.length) {
        const lots = trimLots(lotsOf(product), qty);
        if (!sameLots(lots, lotsOf(product))) data.lots = lots;
      }
      batch.update(productRef(product.id), data);
    });
    return batch.commit();
  });
  updateDoc(householdRef(), { lastInventoryAt: serverTimestamp(), lastInventoryBy: myName() }).catch(() => {});
  return Promise.all(commits);
}

/* ---------- Photos ---------- */

const photoCache = new Map();

export function loadPhoto(p) {
  if (!p?.hasPhoto) return Promise.resolve(null);
  const key = `${p.id}:${p.photoAt || 0}`;
  if (photoCache.has(key)) return photoCache.get(key);
  const promise = getDoc(imageRef(p.id))
    .then(s => (s.exists() ? s.data().data : null))
    .catch(() => null);
  photoCache.set(key, promise);
  promise.then(v => { if (!v) photoCache.delete(key); });
  return promise;
}

/* ---------- Rangements (catégories) ---------- */

export function saveCategories(list) {
  return updateDoc(householdRef(), {
    categories: list.map(c => ({ id: c.id, name: c.name.slice(0, 40), icon: c.icon || "📦" })),
    updatedAt: serverTimestamp()
  });
}

export function deleteCategory(catId, moveTo) {
  const batch = writeBatch(db);
  state.products.filter(p => p.categoryId === catId).forEach(p => {
    batch.update(productRef(p.id), { categoryId: moveTo || "", ...stamp() });
  });
  batch.update(householdRef(), {
    categories: categories().filter(c => c.id !== catId),
    updatedAt: serverTimestamp()
  });
  return batch.commit();
}

/* ---------- Foyer ---------- */

export function renameHousehold(name) {
  return updateDoc(householdRef(), { name: name.slice(0, 60), updatedAt: serverTimestamp() });
}

export function setListmeLink(link) {
  return updateDoc(householdRef(), { listmeLink: link, updatedAt: serverTimestamp() });
}

export function inviteEmail(email) {
  return updateDoc(householdRef(), { invitedEmails: arrayUnion(email.toLowerCase()), updatedAt: serverTimestamp() });
}

export function cancelInvite(email) {
  return updateDoc(householdRef(), { invitedEmails: arrayRemove(email), updatedAt: serverTimestamp() });
}

export function removeMember(memberUid) {
  return updateDoc(householdRef(), {
    memberUids: arrayRemove(memberUid),
    [`members.${memberUid}`]: deleteField(),
    updatedAt: serverTimestamp()
  });
}

export function updateMyMemberInfo() {
  if (!state.household) return;
  const cur = state.household.members?.[uid()];
  if (cur?.name === myName() && cur?.email === myEmail()) return;
  updateDoc(householdRef(), { [`members.${uid()}`]: { email: myEmail(), name: myName() } }).catch(() => {});
}

// Quitte le foyer courant (sans créer de nouveau foyer).
async function leaveCurrent({ purgeIfAlone }) {
  const h = state.household;
  if (!h) return;
  const others = (h.memberUids || []).filter(u => u !== uid());
  if (!others.length) {
    if (!purgeIfAlone) return;
    // Seul dans ce foyer : on supprime ses produits, ses photos puis le foyer.
    const ids = state.products.map(p => ({ id: p.id, photo: p.hasPhoto }));
    for (let i = 0; i < ids.length; i += 200) {
      const batch = writeBatch(db);
      ids.slice(i, i + 200).forEach(({ id, photo }) => {
        batch.delete(productRef(id, h.id));
        if (photo) batch.delete(imageRef(id, h.id));
      });
      await batch.commit();
    }
    await deleteDoc(householdRef(h.id));
    return;
  }
  const data = {
    memberUids: arrayRemove(uid()),
    [`members.${uid()}`]: deleteField(),
    updatedAt: serverTimestamp()
  };
  if (h.ownerUid === uid()) data.ownerUid = others[0];
  await updateDoc(householdRef(h.id), data);
}

/** Rejoint le foyer « target » (invitation). copy = copier les produits du foyer actuel. */
export async function joinHousehold(target, { copy = false } = {}) {
  const oldProducts = state.products.slice();
  const oldHid = state.hid;
  stopWatch();

  await updateDoc(householdRef(target.id), {
    memberUids: arrayUnion(uid()),
    [`members.${uid()}`]: { email: myEmail(), name: myName() },
    invitedEmails: arrayRemove(myEmail()),
    updatedAt: serverTimestamp()
  });

  if (copy && oldHid && oldProducts.length) {
    const fresh = await getDoc(householdRef(target.id));
    const targetCats = (fresh.data().categories || []).slice();
    const oldCats = state.household?.categories || [];
    const map = {};
    for (const c of oldCats) {
      let t = targetCats.find(x => norm(x.name) === norm(c.name));
      if (!t) { t = { id: newId(), name: c.name, icon: c.icon }; targetCats.push(t); }
      map[c.id] = t.id;
    }
    await updateDoc(householdRef(target.id), { categories: targetCats, updatedAt: serverTimestamp() });
    for (let i = 0; i < oldProducts.length; i += 100) {
      const batch = writeBatch(db);
      for (const p of oldProducts.slice(i, i + 100)) {
        const { id, ...rest } = p;
        const nid = doc(productsCol(target.id)).id;
        batch.set(productRef(nid, target.id), {
          ...rest, categoryId: map[p.categoryId] || "", sentAt: null, boughtLevel: null,
          createdAt: serverTimestamp(), ...stamp()
        });
        if (p.hasPhoto) {
          const s = await getDoc(imageRef(id, oldHid)).catch(() => null);
          if (s?.exists()) batch.set(imageRef(nid, target.id), s.data());
        }
      }
      await batch.commit();
    }
  }

  if (oldHid) {
    state.hid = oldHid;
    await leaveCurrent({ purgeIfAlone: true }).catch(err => console.warn("Ancien foyer", err));
  }
  await setUserHousehold(target.id);
  return target.id;
}

/** Quitte le foyer partagé et repart avec un placard vide. */
export async function leaveHousehold() {
  await leaveCurrent({ purgeIfAlone: false });
  stopWatch();
  return createHousehold(`Chez ${myName()}`);
}
