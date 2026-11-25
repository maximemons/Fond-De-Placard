// Envoi des produits à racheter vers ListMe, comme le fait Aux fourneaux :
// les articles passent par les paramètres de l'adresse
// (?list=ID ou ?name=Titre, puis un paramètre par produit : produit=quantité).

// Adresse de ListMe utilisée quand aucun lien de liste n'est enregistré dans le foyer.
export const LISTME_URL = "https://maximemons.github.io/ListMe/";

const LISTME_RESERVED = new Set(["list", "name", "items", "add", "space", "store", "fbclid", "gclid"]);

/** Valide un lien de partage ListMe et renvoie { base, listId } (ou { error }). */
export function parseListMeLink(link) {
  const t = (link || "").trim();
  if (!t) return null;
  let url;
  try {
    url = new URL(t);
  } catch {
    return { error: "Lien invalide. Copie le lien depuis le bouton « Partager » de ListMe." };
  }
  if (url.protocol !== "https:") return { error: "Le lien doit commencer par https://" };
  const listId = url.searchParams.get("list");
  if (!listId || !/^[A-Za-z0-9_-]{8,64}$/.test(listId)) {
    return { error: "Ce lien ne contient pas d’identifiant de liste ListMe (paramètre « list »)." };
  }
  return { base: `${url.origin}${url.pathname}`, listId };
}

/** items : [{ name, qty }] — qty peut être un nombre ou un texte ("500 g"). */
export function buildListMeUrl({ items, listLink, title = "Fond de placard" }) {
  const params = new URLSearchParams();
  let base = LISTME_URL;
  if (listLink && !listLink.error) {
    base = listLink.base;
    params.set("list", listLink.listId);
  } else {
    params.set("name", title.slice(0, 60));
  }
  for (const it of items) {
    let name = String(it.name).trim().slice(0, 60);
    if (!name) continue;
    if (LISTME_RESERVED.has(name.toLowerCase()) || name.toLowerCase().startsWith("utm_")) name = `${name} `;
    params.append(name, String(it.qty).slice(0, 20));
  }
  return `${base}?${params.toString()}`;
}
