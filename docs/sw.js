// No-op service worker. Exists only so old versions can update to this and stop.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.registration.unregister());
