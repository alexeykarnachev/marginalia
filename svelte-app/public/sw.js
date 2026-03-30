const MARGINALIA_VERSION = 175;
const CACHE_NAME = "marginalia";

self.addEventListener("install", (e) => {
    self.skipWaiting();
});

self.addEventListener("activate", (e) => {
    // Clean up old versioned caches from previous SW versions
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
});

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);

    // Skip external requests (CDN, API)
    if (url.hostname !== location.hostname) return;

    // Hashed assets are immutable — cache-first
    if (url.pathname.includes("/assets/")) {
        e.respondWith(
            caches.match(e.request).then((cached) =>
                cached || fetch(e.request).then((res) => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
                    return res;
                })
            )
        );
        return;
    }

    // Everything else — network-first
    e.respondWith(
        fetch(e.request, { cache: "no-cache" })
            .then((res) => {
                const clone = res.clone();
                caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});
