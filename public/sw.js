// public/sw.js
const CACHE = "lp-rezept-app-v1";
const ASSETS = [
  "/", 
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/assets/styles.css",
  "/assets/router.js",
  "/assets/app.js",
  "/assets/modal.js",
  "/assets/epos.js",
  "/assets/epos-device.js",
  "/assets/views/create.js",
  "/assets/views/search.js",
  "/assets/views/settings.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache-first for same-origin GET requests (static files).
// Network-first for Netlify Functions (so you don't cache API responses unexpectedly).
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  // Netlify Functions: network-first
  if (url.pathname.startsWith("/.netlify/functions/")) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // Everything else: cache-first
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((resp) => {
      // Optionally cache new files
      const copy = resp.clone();
      caches.open(CACHE).then((cache) => cache.put(req, copy));
      return resp;
    }))
  );
});
