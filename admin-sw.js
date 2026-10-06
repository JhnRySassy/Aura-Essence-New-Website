/* Aura & Essence admin — service worker (makes the admin installable).
   Only the admin's own files are cached, so the panel opens fast.
   Data (orders, products…) always comes live from Supabase — never cached. */
const CACHE = "ae-admin-v1";
const FILES = [
  "admin.html",
  "assets/css/admin.css",
  "assets/css/admin-ui.css",
  "assets/js/admin.js",
  "assets/js/supabase-api.js",
  "assets/js/supabase-config.js",
  "assets/images/admin-icon-192.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates show right away), cached copy only when offline.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && FILES.some((f) => url.pathname.endsWith("/" + f) || url.pathname === "/" + f)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
