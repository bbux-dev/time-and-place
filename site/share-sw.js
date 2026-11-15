// Offline support for shared itineraries only (scope /s/). The admin page is never cached.
// Network first, so people always see the latest plan when they have signal;
// the last copy that loaded is shown when they do not.
const CACHE = "trip-share-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        // A link that was turned off must not live on in the cache.
        else if (response.status === 404) await cache.delete(request);
        return response;
      } catch (err) {
        const saved = await cache.match(request);
        if (saved) return saved;
        throw err;
      }
    })(),
  );
});
