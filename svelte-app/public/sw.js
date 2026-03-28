const MARGINALIA_VERSION = 121;
const CACHE_NAME = "marginalia-v" + MARGINALIA_VERSION;

self.addEventListener("install", (e) => {
    self.skipWaiting();
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);

    // Skip external requests (CDN, API)
    if (url.hostname !== location.hostname) return;

    // Hashed assets are immutable — cache-first (instant loads)
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

    // Everything else (HTML, sw.js, pdfjs) — network-first for freshness
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
