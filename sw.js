// Service worker Hutang Lu: app tetap bisa dibuka tanpa sinyal.
// File app (halaman & script) diambil dari internet dulu supaya selalu versi terbaru; cache hanya cadangan saat offline.
// Font dari cache dulu. Panggilan Google API (Sheets, Drive, login, Gemini) tidak pernah di-cache.
// Naikkan VERSION setiap rilis.
const VERSION = '2.1.0';
const CACHE = 'hutang-lu-' + VERSION;
const SHELL = ['./', './index.html', './config.js', './google.js', './data.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const sameApp = url.origin === location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameApp && !isFont) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    if (sameApp) {
      const key = req.mode === 'navigate' ? './index.html' : req;
      try {
        const r = await fetch(req.url, { cache: 'no-cache' });
        if (r.ok) { c.put(key, r.clone()); return r; }
      } catch (err) {}
      return (await c.match(key, { ignoreSearch: true })) || Response.error();
    }
    const hit = await c.match(req);
    const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
