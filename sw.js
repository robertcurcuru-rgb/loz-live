/* LOZ Live service worker. Bump VERSION on every deploy that changes the app shell. */
const VERSION = "v15-2026-10-23";
const SHELL = "loz-shell-" + VERSION;
const TILES = "loz-tiles-v1";          // runtime map-tile cache (survives shell bumps)
const TILE_MAX = 400;                  // size cap (entries); oldest evicted first
const TILE_HOSTS = ["server.arcgisonline.com", "basemaps.cartocdn.com"];
const SHELL_FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
  "./icon-maskable-512.png", "./apple-touch-icon.png", "./favicon-32.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(k => (k.startsWith("loz-shell-") && k !== SHELL) || (k.startsWith("loz-tiles-") && k !== TILES))
    .map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES), keys = await c.keys();
  for (let i = 0; i < keys.length - TILE_MAX; i++) await c.delete(keys[i]);
}
async function networkFirst(req) {
  const c = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res && res.ok) c.put("./index.html", res.clone());
    return res;
  } catch (_) {
    return (await c.match("./index.html")) || (await c.match("./")) || Response.error();
  }
}
async function staleWhileRevalidate(req, event) {
  const c = await caches.open(TILES), hit = await c.match(req);
  const net = fetch(req).then(res => {
    if (res && res.ok && res.type !== "opaque") return c.put(req, res.clone()).then(trimTiles).then(() => res);
    return res;
  }).catch(() => hit);
  if (hit) { event.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === "navigate" || url.pathname.endsWith("/index.html")) { e.respondWith(networkFirst(req)); return; }
    if (url.pathname.endsWith("/sw.js")) return;
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
    return;
  }
  if (TILE_HOSTS.some(h => url.hostname === h || url.hostname.endsWith("." + h))) { e.respondWith(staleWhileRevalidate(req, e)); return; }
  // everything else cross-origin (Spyder cams, venue sites, etc.) goes straight to the network, never cached
});
