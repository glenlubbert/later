// Keeps the app and every article you've loaded readable without a connection.
const SHELL = "later-shell-v1";
const DATA = "later-data-v1";
const FILES = ["/", "/style.css", "/app.js", "/manifest.webmanifest", "/icons/192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: cacheName === SHELL });
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) {
    if (/^\/api\/articles(\/[a-f0-9]+)?$/.test(url.pathname)) event.respondWith(networkFirst(request, DATA));
    return;
  }
  if (url.pathname.endsWith(".shortcut")) return;
  event.respondWith(networkFirst(request, SHELL));
});
