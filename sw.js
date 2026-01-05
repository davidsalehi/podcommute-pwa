// sw.js
// PodCommute app shell service worker

// Bump this version anytime you want clients to pick up new app.js/styles immediately.
const CACHE_NAME = "podcommute-shell-v2";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
  );
  // Activate updated SW as soon as it's installed
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    // Take control of open pages immediately
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests (avoid interfering with your proxy, feeds, etc.)
  const isSameOrigin = url.origin === self.location.origin;

  // App shell routing / navigations: serve index.html cache-first
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then((cached) => cached || fetch("./index.html"))
    );
    return;
  }

  // Cache-first for app shell assets (same-origin only)
  const isShellAsset =
    isSameOrigin &&
    (SHELL.some(p => url.pathname.endsWith(p.replace("./", ""))) ||
     url.pathname === "/" ||
     url.pathname.endsWith("/index.html"));

  if (isShellAsset) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
    return;
  }

  // Everything else: network-first fallback to cache (good for resilience)
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
