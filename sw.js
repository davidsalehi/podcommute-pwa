const CACHE_NAME = "podcommute-shell-v1";
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
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // App shell: cache-first
  if (req.mode === "navigate" || SHELL.some(p => req.url.endsWith(p.replace("./","")))) {
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req))
    );
    return;
  }
  // Default: network-first (helps keep RSS fresh)
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
