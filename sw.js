// Service worker du Terminal Boursier — coquille en cache, /api/* toujours réseau.
// Best-effort : toute erreur ici ne doit pas empêcher l'app de fonctionner en ligne.

const CACHE = "terminal-shell-v1";
const SHELL = [
  "/terminal-tout-en-un.html",
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
      fetch(req).catch(() => caches.match("/terminal-tout-en-un.html").then((r) => r || Response.error()))
    );
    return;
  }

  // Autres GET même origine + le CDN Chart.js : cache-first, sinon réseau (et on met en cache).
  if (url.origin === self.location.origin || url.href.startsWith("https://cdn.jsdelivr.net/")) {
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
