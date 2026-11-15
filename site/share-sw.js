// Offline support for shared itineraries only (scope /s/). The admin page is never cached.
// Network first, so people always see the latest plan when they have signal;
// the last copy that loaded is shown when they do not.
const CACHE = "trip-share-v1";
// Give JSDoc the service-worker global type without mixing DOM and worker declarations.
const worker = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (globalThis));

worker.addEventListener("install", () => worker.skipWaiting());
worker.addEventListener("activate", (event) => event.waitUntil(worker.clients.claim()));

worker.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== worker.location.origin) return;
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
