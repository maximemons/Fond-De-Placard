// Recherche d'un code-barres dans les bases ouvertes Open Food Facts (alimentaire),
// Open Beauty Facts (hygiène), Open Pet Food Facts (animaux) et Open Products Facts (le reste).
// Seul le code-barres est envoyé : aucune donnée du compte ne quitte l'appli.

const SOURCES = [
  { name: "Open Food Facts", host: "https://world.openfoodfacts.org", hint: "Placard" },
  { name: "Open Beauty Facts", host: "https://world.openbeautyfacts.org", hint: "Salle de bain" },
  { name: "Open Pet Food Facts", host: "https://world.openpetfoodfacts.org", hint: "Placard" },
  { name: "Open Products Facts", host: "https://world.openproductsfacts.org", hint: "Entretien" }
];

const FIELDS = [
  "product_name_fr", "product_name", "generic_name_fr", "brands", "quantity",
  "image_front_small_url", "image_front_url", "image_url", "categories_tags"
].join(",");

const CACHE_KEY = "fdp:lookup";
const cache = (() => { try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; } })();

export function isValidCode(code) {
  return /^\d{6,14}$/.test(code) || /^[A-Za-z0-9\-.]{4,32}$/.test(code);
}

async function fetchWithTimeout(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
  } finally {
    clearTimeout(t);
  }
}

// Devine un rangement à partir des catégories Open Food Facts.
function guessCategory(tags = [], fallback) {
  const t = tags.join(" ");
  if (/frozen|surgel/.test(t)) return "Congélateur";
  if (/wines|beers|alcoholic|spirits|ciders|champagnes/.test(t)) return "Cave";
  if (/dairies|cheeses|yogurts|fresh-meats|hams|chilled|fresh-desserts|butters|creams/.test(t)) return "Frigo";
  if (/fruits|vegetables/.test(t) && /fresh/.test(t)) return "Fruits et légumes";
  return fallback;
}

/**
 * Renvoie { name, brand, quantity, imageUrl, source, sourceUrl, categoryHint } ou null.
 * Ne lève pas d'erreur : hors ligne ou introuvable → null (avec offline = true si le réseau manque).
 */
export async function lookupBarcode(code) {
  if (cache[code] !== undefined) return cache[code];
  if (!navigator.onLine) return { offline: true };
  let networkFailed = 0;
  for (const src of SOURCES) {
    try {
      const res = await fetchWithTimeout(`${src.host}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
      if (!res.ok) { if (res.status !== 404) networkFailed++; continue; }
      const data = await res.json();
      if (data.status !== 1 || !data.product) continue;
      const p = data.product;
      const name = (p.product_name_fr || p.product_name || p.generic_name_fr || "").trim();
      if (!name && !p.brands) continue;
      const result = {
        name: name || p.brands.split(",")[0].trim(),
        brand: (p.brands || "").split(",")[0].trim(),
        quantity: (p.quantity || "").trim(),
        imageUrl: p.image_front_small_url || p.image_front_url || p.image_url || "",
        source: src.name,
        sourceUrl: `${src.host}/product/${encodeURIComponent(code)}`,
        categoryHint: guessCategory(p.categories_tags, src.hint)
      };
      cache[code] = result;
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* rien */ }
      return result;
    } catch {
      networkFailed++;
    }
  }
  if (networkFailed === SOURCES.length) return { offline: true };
  cache[code] = null;
  return null;
}
