const CACHE_NAME = "marginalia-v1";

// Shell files to precache (app skeleton)
const SHELL = [
    "./",
    "./index.html",
    "./app.js",
    "./style.css",
    "./marginalia.js",
    "./manifest.json",
];

self.addEventListener("install", (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
    );
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

    // Never cache API calls
    if (url.hostname !== location.hostname) return;

    // Network-first for HTML (get latest version), cache-first for assets
    if (e.request.destination === "document") {
        e.respondWith(
            fetch(e.request)
                .then((res) => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
                    return res;
                })
                .catch(() => caches.match(e.request))
        );
    } else {
        e.respondWith(
            caches.match(e.request).then((cached) => {
                if (cached) return cached;
                return fetch(e.request).then((res) => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
                    return res;
                });
            })
        );
    }
});
