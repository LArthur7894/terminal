// Service worker du Terminal Boursier — coquille en cache, /api/* toujours réseau.
// Best-effort : toute erreur ici ne doit pas empêcher l'app de fonctionner en ligne.

// À incrémenter dès que la coquille change : l'activation supprime les anciens caches,
// ce qui évite de servir une version périmée du terminal après un déploiement.
const CACHE = "terminal-shell-v6";
const SHELL = [
  "/",
  "/index.html",
  "/app/style.css",
  "/app/01-base.js",
  "/app/02-indicateurs.js",
  "/app/03-fondamentaux.js",
  "/app/04-etat.js",
  "/app/05-bot.js",
  "/app/06-revue.js",
  "/app/07-donnees.js",
  "/app/08-ui-dashboard.js",
  "/app/09-ui-positions.js",
  "/app/10-ui-analyse.js",
  "/app/11-ui-marche.js",
  "/app/12-ui-allocation-monde.js",
  "/app/13-ui-alertes-bot.js",
  "/app/14-ui-comparer.js",
  "/app/15-backtest.js",
  "/app/99-init.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})           // un asset injoignable ne bloque pas l'installation
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Ne jamais mettre en cache les données : /api/* passe directement au réseau.
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;

  // Navigation (ouverture de page) : network-first, repli sur la coquille en cache (hors-ligne).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html").then((r) => r || Response.error()))
    );
    return;
  }

  // Fichiers de l'app (JS, CSS, icône) : RÉSEAU D'ABORD, cache en repli hors-ligne.
  //
  // Le cache-first serait plus rapide mais sert une version périmée dès qu'on oublie
  // d'incrémenter CACHE — et le symptôme (du code source à jour sur le disque, mais
  // un comportement d'avant dans le navigateur) coûte cher à diagnostiquer. En ligne,
  // on veut toujours la version déployée ; le cache n'existe que pour le hors-ligne.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match(req).then((r) => r || Response.error()))
    );
    return;
  }

  // CDN Chart.js : l'URL porte la version (4.4.1), son contenu ne changera jamais.
  // Cache-first est ici sans risque et évite un aller-retour réseau à chaque ouverture.
  if (url.href.startsWith("https://cdn.jsdelivr.net/")) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return resp;
        }).catch(() => cached || Response.error())
      )
    );
  }
});
