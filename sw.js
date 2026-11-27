// Service worker : l'appli démarre sans réseau (cave, sous-sol, magasin mal couvert).
// À chaque mise en ligne, incrémenter VERSION pour que les téléphones récupèrent la nouvelle version.
const VERSION = "fdp-v4";

const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/ui.js",
  "./js/store.js",
  "./js/catalog.js",
  "./js/lookup.js",
  "./js/listme.js",
  "./js/scanner.js",
  "./js/inventory.js",
  "./js/dlc.js",
  "./js/notifications.js",
  "./js/products-ui.js",
  "./js/firebase-config.js",
  "./js/vendor/zxing.min.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Ressources tierces mises en cache au passage (modules Firebase, polices, icônes).
const CACHEABLE_HOSTS = ["www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Fichiers de l'appli : réseau d'abord (mises à jour immédiates), cache si hors ligne.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
          return hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error());
        })
    );
    return;
  }

  // Bibliothèques et polices : cache d'abord, rafraîchi en arrière-plan.
  if (CACHEABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(VERSION).then(async cache => {
        const hit = await cache.match(req);
        const net = fetch(req).then(res => {
          if (res.ok || res.type === "opaque") cache.put(req, res.clone());
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
  // Le reste (Firestore, authentification, Open Food Facts) passe directement par le réseau.
});
