// Service worker Hutang Lu: tampilan app disimpan di HP supaya cepat dibuka.
// Strategi: tampilkan dari cache dulu, sambil ambil versi terbaru di belakang (berlaku di pembukaan berikutnya).
// Panggilan API (script.google.com) tidak pernah di-cache.
const CACHE = 'hutang-lu-b2b48ccd30';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;
  const sameApp = url.origin === location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameApp && !isFont) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const key = sameApp && req.mode === 'navigate' ? './index.html' : req;
    const hit = await c.match(key, { ignoreSearch: sameApp });
    const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(key, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
