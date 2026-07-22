// Service worker: makes the app installable and usable offline.
//
// Strategy is network-first everywhere — the frontend is embedded in the
// server binary and redeploys on every push, so a cache-first shell would go
// stale. The cache is only a fallback for when the network is down.
//
// Never intercepted:
//   - non-GET (state sync PUTs, file uploads)
//   - API paths — auth redirects and freshness belong to the network
//   - map tiles — unbounded storage; Leaflet degrades gracefully on its own
const CACHE = "trips-v1";

const API_PATHS = ["/state", "/files", "/expand", "/whoami", "/login", "/health"];
const TILE_HOST = /\.cartocdn\.com$/;

const PRECACHE = ["/", "/styles.css", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && API_PATHS.some((p) => url.pathname === p)) return;
  if (TILE_HOST.test(url.hostname)) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
        if (hit) return hit;
        // Offline navigation with nothing cached for that URL: fall back to
        // the shell (trip pages are the same document behind ?trip=).
        if (req.mode === "navigate") {
          const shell = await caches.match("/");
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
