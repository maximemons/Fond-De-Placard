// Données de base : rangements par défaut, unités, et produits courants sans code-barres.

export const DEFAULT_CATEGORIES = [
  { name: "Placard", icon: "🥫" },
  { name: "Frigo", icon: "🧊" },
  { name: "Congélateur", icon: "❄️" },
  { name: "Fruits et légumes", icon: "🥕" },
  { name: "Cave", icon: "🍷" },
  { name: "Salle de bain", icon: "🧴" },
  { name: "Entretien", icon: "🧽" }
];

export const CATEGORY_ICONS = [
  "🥫", "🧊", "❄️", "🥕", "🍎", "🍷", "🍺", "🧃", "☕", "🍝", "🍚", "🥖",
  "🧀", "🥩", "🐟", "🥚", "🍫", "🍪", "🧂", "🫙", "🧴", "🧻", "🧽", "🧺",
  "💊", "🐾", "👶", "🧸", "🛁", "🚗", "🏚️", "📦", "🗄️", "🍼", "🌶️", "🥜"
];

// Unités : le pas du compteur −/+ suit l'unité choisie.
export const UNITS = [
  { id: "", label: "Pièce", short: "", step: 1 },
  { id: "kg", label: "Kilo (kg)", short: "kg", step: 0.25 },
  { id: "g", label: "Gramme (g)", short: "g", step: 100 },
  { id: "l", label: "Litre (l)", short: "l", step: 0.5 },
  { id: "cl", label: "Centilitre (cl)", short: "cl", step: 25 },
  { id: "botte", label: "Botte", short: "botte", step: 1 },
  { id: "paquet", label: "Paquet", short: "paquet", step: 1 },
  { id: "boite", label: "Boîte", short: "boîte", step: 1 },
  { id: "bouteille", label: "Bouteille", short: "bout.", step: 1 },
  { id: "pot", label: "Pot", short: "pot", step: 1 },
  { id: "sachet", label: "Sachet", short: "sachet", step: 1 },
  { id: "rouleau", label: "Rouleau", short: "rouleau", step: 1 }
];

export const unitOf = id => UNITS.find(u => u.id === (id || "")) || UNITS[0];
export const stepOf = p => unitOf(p?.unit).step;

// Quantité lisible : "3", "1,5 kg", "2 bout."
export function qtyLabel(qty, unit) {
  const u = unitOf(unit);
  const n = Math.max(0, Number(qty) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return u.short ? `${n} ${u.short}` : n;
}

// Produits frais courants (sans code-barres). cat = nom de rangement suggéré.
const FL = "Fruits et légumes";
export const FRESH = [
  ["Pommes", "🍎", ""], ["Poires", "🍐", ""], ["Bananes", "🍌", ""], ["Oranges", "🍊", ""],
  ["Clémentines", "🍊", ""], ["Citrons", "🍋", ""], ["Citrons verts", "🍋", ""], ["Kiwis", "🥝", ""],
  ["Raisin", "🍇", "kg"], ["Fraises", "🍓", "g"], ["Cerises", "🍒", "g"], ["Pêches", "🍑", ""],
  ["Abricots", "🍑", ""], ["Melon", "🍈", ""], ["Pastèque", "🍉", ""], ["Ananas", "🍍", ""],
  ["Mangue", "🥭", ""], ["Avocats", "🥑", ""], ["Tomates", "🍅", ""], ["Tomates cerises", "🍅", "g"],
  ["Concombre", "🥒", ""], ["Courgettes", "🥒", ""], ["Aubergines", "🍆", ""], ["Poivrons", "🫑", ""],
  ["Carottes", "🥕", "kg"], ["Pommes de terre", "🥔", "kg"], ["Patates douces", "🍠", ""], ["Oignons", "🧅", ""],
  ["Oignons rouges", "🧅", ""], ["Échalotes", "🧅", ""], ["Ail", "🧄", ""], ["Poireaux", "🥬", ""],
  ["Salade", "🥬", ""], ["Épinards", "🥬", "g"], ["Chou", "🥬", ""], ["Chou-fleur", "🥦", ""],
  ["Brocoli", "🥦", ""], ["Champignons", "🍄", "g"], ["Haricots verts", "🫛", "g"], ["Petits pois", "🫛", "g"],
  ["Maïs", "🌽", ""], ["Radis", "🌶️", "botte"], ["Betteraves", "🟣", ""], ["Céleri", "🥬", ""],
  ["Fenouil", "🌿", ""], ["Navets", "🥔", ""], ["Potiron", "🎃", ""], ["Butternut", "🎃", ""],
  ["Persil", "🌿", "botte"], ["Coriandre", "🌿", "botte"], ["Basilic", "🌿", ""], ["Menthe", "🌿", "botte"],
  ["Ciboulette", "🌿", "botte"], ["Gingembre", "🫚", ""], ["Piment", "🌶️", ""],
  ["Œufs", "🥚", ""], ["Pain", "🥖", ""], ["Baguette", "🥖", ""]
].map(([name, emoji, unit]) => ({ name, emoji, unit, cat: ["Œufs", "Pain", "Baguette"].includes(name) ? (name === "Œufs" ? "Frigo" : "Placard") : FL }));
