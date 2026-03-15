importScripts("db.js");

const CACHE_NAME = "marginalia-v" + MARGINALIA_VERSION;

// Shell files to precache (app skeleton)
const SHELL = [
    "./",
    "./index.html",
    "./db.js",
    "./app.js",
    "./tools.js",
    "./agent.js",
    "./marginalia.js",
    "./style.css",
    "./chat.css",
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

    // Network-first, bypassing browser HTTP cache
    e.respondWith(
        fetch(e.request, { cache: "no-cache" })
            .then((res) => {
                const clone = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});
